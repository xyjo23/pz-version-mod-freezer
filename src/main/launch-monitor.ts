import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { atomicWriteFileIfChanged } from './safe-write'

export type ConsoleSnapshot = {
  path: string
  size: number
  modifiedAt: string | null
}

export type LaunchMonitorOptions = {
  source: 'Steam' | 'Frozen'
  executable: string
  args: string[]
  cachePath: string
  reportRoot: string
  expectedVersion: string
  expectedBuildId: string
  survivalMs?: number
  pollMs?: number
}

export type LaunchMonitorResult = {
  ok: boolean
  status: 'running' | 'early-exit' | 'not-detected' | 'already-running'
  pid: number | null
  exitCode: number | null
  message: string
  output: string
  receiptPath: string
}

type Receipt = {
  schemaVersion: 1
  source: LaunchMonitorOptions['source']
  status: LaunchMonitorResult['status']
  startedAt: string
  observedAt: string
  executable: string
  args: string[]
  pid: number | null
  exitCode: number | null
  expected: { version: string; buildId: string }
  cachePath: string
  console: { path: string; changed: boolean; evidence: string[] }
  limitations: string[]
}

const MAX_LOG_READ_BYTES = 512 * 1024
const DEFAULT_SURVIVAL_MS = 12_000

export const parseTasklistCsv = (output: string, imageName: string): number[] => {
  const expected = imageName.toLowerCase()
  const pids: number[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)"/)
    if (!match || match[1].toLowerCase() !== expected) continue
    pids.push(Number(match[2]))
  }
  return pids
}

export const listProcessIds = (imageName: string): Promise<number[]> => new Promise((resolve, reject) => {
  const child = spawn('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], { windowsHide: true })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
  child.once('error', reject)
  child.once('close', (code) => {
    if (code !== 0) reject(new Error(`tasklist.exe exited with code ${code}: ${output.trim()}`))
    else resolve(parseTasklistCsv(output, imageName))
  })
})

export const snapshotConsole = async (cachePath: string): Promise<ConsoleSnapshot> => {
  const consolePath = path.join(cachePath, 'console.txt')
  if (!existsSync(consolePath)) return { path: consolePath, size: 0, modifiedAt: null }
  const stats = await fs.stat(consolePath)
  return { path: consolePath, size: stats.size, modifiedAt: stats.mtime.toISOString() }
}

const consoleEvidence = async (before: ConsoleSnapshot): Promise<{ changed: boolean; evidence: string[] }> => {
  if (!existsSync(before.path)) return { changed: false, evidence: [] }
  const stats = await fs.stat(before.path)
  const changed = stats.size !== before.size || stats.mtime.toISOString() !== before.modifiedAt
  if (!changed) return { changed, evidence: [] }
  const wasRewritten = stats.size <= before.size && stats.mtime.toISOString() !== before.modifiedAt
  const start = wasRewritten ? Math.max(0, stats.size - MAX_LOG_READ_BYTES) : Math.min(stats.size, Math.max(before.size, stats.size - MAX_LOG_READ_BYTES))
  const length = Math.min(MAX_LOG_READ_BYTES, Math.max(0, stats.size - start))
  if (!length) return { changed, evidence: [] }
  const handle = await fs.open(before.path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    const evidence = buffer.toString('utf8').split(/\r?\n/)
      .filter((line) => /\b(?:ERROR|FATAL|Exception|OutOfMemory|EXCEPTION_ACCESS_VIOLATION)\b/i.test(line))
      .slice(-40)
    return { changed, evidence }
  } finally {
    await handle.close()
  }
}

const persistReceipt = async (options: LaunchMonitorOptions, result: Omit<LaunchMonitorResult, 'output' | 'receiptPath'>, startedAt: string, before: ConsoleSnapshot): Promise<LaunchMonitorResult> => {
  const consoleResult = await consoleEvidence(before)
  const receipt: Receipt = {
    schemaVersion: 1,
    source: options.source,
    status: result.status,
    startedAt,
    observedAt: new Date().toISOString(),
    executable: options.executable,
    args: options.args,
    pid: result.pid,
    exitCode: result.exitCode,
    expected: { version: options.expectedVersion, buildId: options.expectedBuildId },
    cachePath: options.cachePath,
    console: { path: before.path, changed: consoleResult.changed, evidence: consoleResult.evidence },
    limitations: [
      '进程存活检查只能确认启动阶段没有立即退出，不能证明已经成功进入主菜单。',
      'console.txt 中的新错误行是诊断证据，不自动等同于本次退出的唯一原因。'
    ]
  }
  await fs.mkdir(options.reportRoot, { recursive: true })
  const fileName = `${startedAt.replace(/[-:TZ.]/g, '')}-${options.source.toLowerCase()}.json`
  const receiptPath = path.join(options.reportRoot, fileName)
  const contents = JSON.stringify(receipt, null, 2)
  await atomicWriteFileIfChanged(receiptPath, contents)
  await atomicWriteFileIfChanged(path.join(options.reportRoot, 'latest.json'), contents)
  const evidenceText = consoleResult.evidence.length
    ? `本次新增的高严重度日志证据：\n${consoleResult.evidence.join('\n')}`
    : '本次启动观察窗口内没有捕获到新的高严重度 console.txt 行。'
  return {
    ...result,
    receiptPath,
    output: [
      `来源：${options.source}`,
      `PID：${result.pid ?? '未检测到'}`,
      `预期版本：${options.expectedVersion} / Build ${options.expectedBuildId}`,
      `启动参数：${options.args.join(' ') || '无'}`,
      `启动报告：${receiptPath}`,
      '能力边界：进程持续存活不能证明已经进入主菜单、成功加载存档或具备联机条件。',
      evidenceText
    ].join('\n')
  }
}

export const monitorSpawnedLaunch = async (child: ChildProcess, options: LaunchMonitorOptions, before: ConsoleSnapshot): Promise<LaunchMonitorResult> => {
  const startedAt = new Date().toISOString()
  const survivalMs = options.survivalMs ?? DEFAULT_SURVIVAL_MS
  const outcome = await new Promise<{ status: 'running' | 'early-exit'; exitCode: number | null }>((resolve, reject) => {
    const timer = setTimeout(() => resolve({ status: 'running', exitCode: null }), survivalMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolve({ status: 'early-exit', exitCode: code ?? -1 }) })
  })
  const ok = outcome.status === 'running'
  return persistReceipt(options, {
    ok,
    status: outcome.status,
    pid: child.pid ?? null,
    exitCode: outcome.exitCode,
    message: ok ? `游戏进程已连续存活 ${Math.round(survivalMs / 1000)} 秒。` : `游戏进程在 ${Math.round(survivalMs / 1000)} 秒启动观察期内退出。`
  }, startedAt, before)
}

export const monitorExternalLaunch = async (
  start: () => Promise<void>,
  options: LaunchMonitorOptions & { imageName: string; detectionMs?: number; listPids?: (imageName: string) => Promise<number[]> }
): Promise<LaunchMonitorResult> => {
  const startedAt = new Date().toISOString()
  const before = await snapshotConsole(options.cachePath)
  const listPids = options.listPids ?? listProcessIds
  const baseline = await listPids(options.imageName)
  if (baseline.length) {
    return persistReceipt(options, {
      ok: false,
      status: 'already-running',
      pid: baseline[0],
      exitCode: null,
      message: '检测到 Project Zomboid 已经在运行，本次没有重复启动。'
    }, startedAt, before)
  }
  await start()
  const detectionMs = options.detectionMs ?? 30_000
  const survivalMs = options.survivalMs ?? DEFAULT_SURVIVAL_MS
  const pollMs = Math.max(10, options.pollMs ?? 500)
  const detectionStarted = Date.now()
  let pid: number | null = null
  while (Date.now() - detectionStarted < detectionMs) {
    const current = await listPids(options.imageName)
    pid = current.find((candidate) => !baseline.includes(candidate)) ?? null
    if (pid !== null) break
    await delay(pollMs)
  }
  if (pid === null) {
    return persistReceipt(options, {
      ok: false,
      status: 'not-detected',
      pid: null,
      exitCode: null,
      message: `已向 Steam 提交启动请求，但 ${Math.round(detectionMs / 1000)} 秒内没有检测到游戏进程。请检查 Steam 是否仍停在“选择启动选项”窗口。`
    }, startedAt, before)
  }
  const survivalStarted = Date.now()
  while (Date.now() - survivalStarted < survivalMs) {
    if (!(await listPids(options.imageName)).includes(pid)) {
      return persistReceipt(options, {
        ok: false,
        status: 'early-exit',
        pid,
        exitCode: null,
        message: `Steam 游戏进程在 ${Math.round(survivalMs / 1000)} 秒启动观察期内退出。`
      }, startedAt, before)
    }
    await delay(pollMs)
  }
  return persistReceipt(options, {
    ok: true,
    status: 'running',
    pid,
    exitCode: null,
    message: `Steam 游戏进程已连续存活 ${Math.round(survivalMs / 1000)} 秒。`
  }, startedAt, before)
}
