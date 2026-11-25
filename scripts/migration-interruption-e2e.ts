import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import type { FreezeConfig } from '../src/shared/types'

const testRoot = process.env.PZ_MIGRATION_INTERRUPT_ROOT
if (!testRoot) throw new Error('PZ_MIGRATION_INTERRUPT_ROOT is required.')
if (existsSync(testRoot)) throw new Error(`Refusing to reuse an existing interruption test root: ${testRoot}`)

const require = createRequire(import.meta.url)
const electronPath = require('electron') as string
const workerPath = path.resolve('scripts', 'migration-interrupt-worker.ts')
const readyFile = path.join(testRoot, 'interrupt-ready.txt')

const write = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms.`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const spawnWorker = (pause: boolean): { child: ReturnType<typeof spawn>; output: () => string } => {
  let collected = ''
  const env = {
    ...process.env,
    NODE_OPTIONS: '--import tsx',
    PZ_MIGRATION_INTERRUPT_ROOT: testRoot,
    PZ_MIGRATION_TEST_READY_FILE: pause ? readyFile : '',
    PZ_MIGRATION_TEST_PAUSE_BEFORE_COMMIT_MS: pause ? '300000' : '0'
  }
  const child = spawn(electronPath, [workerPath], { cwd: path.resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk: Buffer) => { collected += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { collected += chunk.toString('utf8') })
  return { child, output: () => collected }
}

const waitForExit = (child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Worker did not exit within ${timeoutMs} ms.`)), timeoutMs)
  child.once('exit', (code) => { clearTimeout(timer); resolve(code) })
})

const main = async (): Promise<void> => {
  const baseRoot = path.join(testRoot, 'frozen', 'interrupt-base')
  const baseGame = path.join(baseRoot, 'game')
  const baseCache = path.join(baseRoot, 'cache')
  await write(path.join(baseGame, 'media', 'base.txt'), 'forced termination fixture')
  await write(path.join(baseCache, 'version.txt'), '42.22.2')
  await write(path.join(baseCache, 'options.ini'), 'fullscreen=true')
  const config: FreezeConfig = {
    ManagerRoot: testRoot,
    FreezeRoot: baseRoot,
    GamePath: baseGame,
    CachePath: baseCache,
    ManifestPath: path.join(baseRoot, 'manifests'),
    ReportPath: path.join(baseRoot, 'reports'),
    BackupPath: path.join(baseRoot, 'backups'),
    Version: '42.22.2',
    BuildID: 'interrupt-fixture',
    DisplayName: 'Interrupt fixture base',
    Created: new Date().toISOString(),
    StorageMode: 'FullCopy'
  }
  await write(path.join(baseRoot, 'metadata', 'freeze.json'), JSON.stringify(config, null, 2))
  await write(path.join(testRoot, '.launcher-user-data', 'launcher-settings.json'), JSON.stringify({ managerRoot: testRoot, activeSource: 'Frozen', activeVersionRoot: baseRoot }, null, 2))

  const interrupted = spawnWorker(true)
  await waitFor(() => existsSync(readyFile), 30_000)
  assert(interrupted.child.pid, 'Interrupt worker did not expose a process ID.')
  interrupted.child.kill('SIGKILL')
  await waitForExit(interrupted.child, 10_000)

  const stageRoot = path.join(testRoot, '.staging')
  const stages = await fs.readdir(stageRoot)
  assert.equal(stages.length, 1, 'Interrupted worker did not leave exactly one hidden staging directory.')
  const visibleVersionsAfterKill = (await fs.readdir(path.join(testRoot, 'frozen'))).filter((name) => name !== 'interrupt-base')
  assert.deepEqual(visibleVersionsAfterKill, [], 'Interrupted migration exposed a final version before atomic commit.')
  const currentBeforeRecovery = JSON.parse(await fs.readFile(path.join(testRoot, '.launcher-user-data', 'launcher-settings.json'), 'utf8')) as { activeVersionRoot?: string }
  assert.equal(path.resolve(currentBeforeRecovery.activeVersionRoot ?? ''), path.resolve(baseRoot))

  await fs.rm(readyFile, { force: true })
  const recovered = spawnWorker(false)
  const recoveredCode = await waitForExit(recovered.child, 30_000)
  assert.equal(recoveredCode, 0, recovered.output())
  assert.match(recovered.output(), /MIGRATION_INTERRUPT_WORKER=/)
  assert.match(recovered.output(), /上次中断的暂存数据移入诊断目录/)
  const incomplete = await fs.readdir(path.join(testRoot, 'incomplete'))
  assert.equal(incomplete.length, 1)
  const completed = (await fs.readdir(path.join(testRoot, 'frozen'))).filter((name) => name !== 'interrupt-base')
  assert.equal(completed.length, 1)
  assert(existsSync(path.join(testRoot, 'frozen', completed[0], 'metadata', 'freeze.json')))
  assert(!existsSync(path.join(testRoot, 'frozen', completed[0], '.pzvault-migration.json')))

  console.log(`MIGRATION_INTERRUPTION_E2E=${JSON.stringify({
    root: testRoot,
    killedBeforeCommit: true,
    partialVersionHidden: true,
    previousActivePreserved: true,
    interruptedStageArchived: incomplete[0],
    recoveredVersion: completed[0]
  })}`)
}

void main().catch((error) => {
  console.error(`MIGRATION_INTERRUPTION_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
