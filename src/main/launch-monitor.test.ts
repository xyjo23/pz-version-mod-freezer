import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { monitorExternalLaunch, monitorSpawnedLaunch, parseTasklistCsv, snapshotConsole } from './launch-monitor.ts'
import { ensureSteamClientRunning } from './steam-client.ts'

const withTempRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-vault-launch-'))
  try {
    await run(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('parseTasklistCsv only returns exact image-name matches', () => {
  const output = [
    '"ProjectZomboid64.exe","10240","Console","1","1,024 K"',
    '"ProjectZomboid64.exe.bak","20480","Console","1","1,024 K"',
    '"projectzomboid64.EXE","40960","Console","1","1,024 K"'
  ].join('\r\n')
  assert.deepEqual(parseTasklistCsv(output, 'ProjectZomboid64.exe'), [10240, 40960])
})

test('monitorSpawnedLaunch reports a process that survives the observation window', async () => {
  await withTempRoot(async (root) => {
    const cachePath = path.join(root, 'cache')
    await fs.mkdir(cachePath)
    const before = await snapshotConsole(cachePath)
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 250)'])
    const result = await monitorSpawnedLaunch(child, {
      source: 'Frozen', executable: process.execPath, args: [], cachePath,
      reportRoot: path.join(root, 'reports'), expectedVersion: '42.21.0', expectedBuildId: '25485521', survivalMs: 40
    }, before)
    assert.equal(result.ok, true)
    assert.equal(result.status, 'running')
    assert.match(result.output, /不能证明|启动报告/u)
    assert.equal(JSON.parse(await fs.readFile(result.receiptPath, 'utf8')).status, 'running')
    child.kill()
  })
})

test('monitorSpawnedLaunch captures early exit and only new console evidence', async () => {
  await withTempRoot(async (root) => {
    const cachePath = path.join(root, 'cache')
    await fs.mkdir(cachePath)
    const consolePath = path.join(cachePath, 'console.txt')
    await fs.writeFile(consolePath, 'old ERROR: unrelated\n', 'utf8')
    const before = await snapshotConsole(cachePath)
    await fs.appendFile(consolePath, 'FMOD result: No errors.\nnew ERROR: launch failed\n', 'utf8')
    const child = spawn(process.execPath, ['-e', 'process.exit(7)'])
    const result = await monitorSpawnedLaunch(child, {
      source: 'Frozen', executable: process.execPath, args: [], cachePath,
      reportRoot: path.join(root, 'reports'), expectedVersion: '42.21.0', expectedBuildId: '25485521', survivalMs: 500
    }, before)
    assert.equal(result.ok, false)
    assert.equal(result.status, 'early-exit')
    assert.equal(result.exitCode, 7)
    assert.match(result.output, /new ERROR: launch failed/u)
    assert.doesNotMatch(result.output, /old ERROR: unrelated/u)
    assert.doesNotMatch(result.output, /No errors/u)
  })
})

test('monitorExternalLaunch distinguishes missing, running and early-exit processes', async () => {
  await withTempRoot(async (root) => {
    const common = {
      source: 'Steam' as const,
      executable: 'ProjectZomboid64.exe', args: [], cachePath: root,
      expectedVersion: '42.21.0', expectedBuildId: '25485521',
      detectionMs: 30, survivalMs: 30, pollMs: 10
    }
    const missing = await monitorExternalLaunch(async () => {}, {
      ...common, reportRoot: path.join(root, 'missing'), imageName: 'ProjectZomboid64.exe', listPids: async () => []
    })
    assert.equal(missing.status, 'not-detected')

    let runningCalls = 0
    const running = await monitorExternalLaunch(async () => {}, {
      ...common, reportRoot: path.join(root, 'running'), imageName: 'ProjectZomboid64.exe',
      listPids: async () => (++runningCalls === 1 ? [] : [10240])
    })
    assert.equal(running.status, 'running')
    assert.equal(running.pid, 10240)

    let exitCalls = 0
    const earlyExit = await monitorExternalLaunch(async () => {}, {
      ...common, reportRoot: path.join(root, 'early'), imageName: 'ProjectZomboid64.exe',
      listPids: async () => {
        exitCalls += 1
        if (exitCalls === 1) return []
        if (exitCalls <= 3) return [20480]
        return []
      }
    })
    assert.equal(earlyExit.status, 'early-exit')
    assert.equal(earlyExit.pid, 20480)
  })
})

test('ensureSteamClientRunning starts a cold client and waits for its helper process', async () => {
  let started = false
  let polls = 0
  const result = await ensureSteamClientRunning('E:\\Steam', {
    timeoutMs: 100,
    settleMs: 0,
    pollMs: 10,
    start: async (executable) => {
      assert.equal(executable, 'E:\\Steam\\steam.exe')
      started = true
    },
    getActiveUser: async () => polls >= 4 ? 12345 : 0,
    listPids: async (imageName) => {
      if (!started) return []
      polls += 1
      if (imageName === 'steam.exe') return [3000]
      return polls >= 4 ? [4000] : []
    }
  })
  assert.equal(result.started, true)
  assert.equal(result.steamPid, 3000)
  assert.equal(result.helperPid, 4000)
})

test('ensureSteamClientRunning leaves a ready Steam client untouched', async () => {
  let startCalls = 0
  const result = await ensureSteamClientRunning('E:\\Steam', {
    settleMs: 0,
    start: async () => { startCalls += 1 },
    getActiveUser: async () => 12345,
    listPids: async (imageName) => imageName === 'steam.exe' ? [1024] : [2048]
  })
  assert.equal(result.started, false)
  assert.equal(startCalls, 0)
})

test('ensureSteamClientRunning does not treat the Steam login window as ready', async () => {
  await assert.rejects(
    ensureSteamClientRunning('E:\\Steam', {
      timeoutMs: 25,
      settleMs: 0,
      pollMs: 10,
      start: async () => {},
      getActiveUser: async () => 0,
      listPids: async (imageName) => imageName === 'steam.exe' ? [1024] : [2048]
    }),
    /已登录状态/u
  )
})
