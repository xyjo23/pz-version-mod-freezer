import assert from 'node:assert/strict'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { assertPathWithin, atomicWriteFileIfChanged, atomicWriteJsonIfChanged, isPathWithin } from './safe-write'

const fixtureRoot = (): string => path.join(os.tmpdir(), `pz-vault-safe-write-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)

test('path ownership rejects sibling prefixes and accepts descendants', async () => {
  const root = fixtureRoot()
  const parent = path.join(root, 'manager', 'frozen')
  const child = path.join(parent, 'version-a')
  const siblingPrefix = path.join(root, 'manager', 'frozen-elsewhere', 'version-b')
  await fs.mkdir(child, { recursive: true })
  await fs.mkdir(siblingPrefix, { recursive: true })
  try {
    assert.equal(isPathWithin(parent, child), true)
    assert.equal(isPathWithin(parent, parent), false)
    assert.equal(isPathWithin(parent, siblingPrefix), false)
    await assert.doesNotReject(assertPathWithin(parent, child, 'fixture ownership'))
    await assert.rejects(assertPathWithin(parent, siblingPrefix, 'fixture ownership'), /不属于/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('real-path ownership rejects a link that escapes the library', async (context) => {
  const root = fixtureRoot()
  const parent = path.join(root, 'manager', 'frozen')
  const outside = path.join(root, 'outside', 'version')
  const linkedVersion = path.join(parent, 'linked-version')
  await fs.mkdir(parent, { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  try {
    try {
      await fs.symlink(outside, linkedVersion, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      context.skip(`当前环境不能创建测试目录联接：${(error as NodeJS.ErrnoException).code ?? 'unknown'}`)
      return
    }
    assert.equal(isPathWithin(parent, linkedVersion), true, 'Lexical containment alone should demonstrate why the real-path check is required.')
    await assert.rejects(assertPathWithin(parent, linkedVersion, 'fixture ownership'), /不属于/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('atomic writes preserve unchanged mtimes and back up changed contents', async () => {
  const root = fixtureRoot()
  const target = path.join(root, 'settings.json')
  const backup = `${target}.backup`
  try {
    assert.equal(await atomicWriteJsonIfChanged(target, { value: 1 }), true)
    const firstContents = await fs.readFile(target, 'utf8')
    const firstTime = (await fs.stat(target)).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(await atomicWriteJsonIfChanged(target, { value: 1 }), false)
    assert.equal((await fs.stat(target)).mtimeMs, firstTime)

    assert.equal(await atomicWriteJsonIfChanged(target, { value: 2 }, { backupPath: backup }), true)
    assert.equal(await fs.readFile(backup, 'utf8'), firstContents)
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { value: 2 })
    assert.equal(existsSync(`${target}.pzvault-rollback`), false)
    assert.equal((await fs.readdir(root)).some((name) => name.endsWith('.tmp')), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('concurrent writes to one file are serialized without partial output', async () => {
  const root = fixtureRoot()
  const target = path.join(root, 'state.json')
  try {
    await Promise.all(Array.from({ length: 24 }, (_, index) => atomicWriteFileIfChanged(target, JSON.stringify({ index, payload: 'x'.repeat(2048) }))))
    const saved = JSON.parse(await fs.readFile(target, 'utf8')) as { index: number; payload: string }
    assert.equal(saved.index, 23)
    assert.equal(saved.payload.length, 2048)
    assert.equal((await fs.readdir(root)).some((name) => name.endsWith('.tmp') || name.endsWith('.pzvault-rollback')), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a stale rollback file is recovered before the next write', async () => {
  const root = fixtureRoot()
  const target = path.join(root, 'state.json')
  const rollback = `${target}.pzvault-rollback`
  try {
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(rollback, JSON.stringify({ value: 'recoverable' }, null, 2), 'utf8')
    assert.equal(await atomicWriteJsonIfChanged(target, { value: 'recoverable' }), false)
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { value: 'recoverable' })
    assert.equal(existsSync(rollback), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
