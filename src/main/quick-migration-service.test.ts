import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { FreezeConfig } from '../shared/types.ts'
import { analyzeQuickMigration, materializeQuickMigration } from './quick-migration-service.ts'

const write = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

test('快速迁移仅复制可变数据，并递归保留启用 MOD 的依赖', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-quick-migration-'))
  try {
    const sourceRoot = path.join(root, 'source')
    const gamePath = path.join(sourceRoot, 'game')
    const cachePath = path.join(sourceRoot, 'cache')
    const targetCache = path.join(root, 'target-cache')
    await write(path.join(gamePath, 'core.bin'), 'immutable game')
    await write(path.join(cachePath, 'options.ini'), 'fullscreen=true')
    await write(path.join(cachePath, 'Saves', 'Sandbox', 'Round2', 'mods.txt'), 'VERSION = 1,\nmods\n{\n mod = Mod.A,\n}')
    await write(path.join(cachePath, 'logs', 'debug.log'), 'generated')
    await write(path.join(cachePath, 'mods', 'A', 'mod.info'), 'name=A\nid=Mod.A\nrequire=Mod.B')
    await write(path.join(cachePath, 'mods', 'A', 'media', 'a.lua'), 'return "a"')
    await write(path.join(cachePath, 'mods', 'B', 'mod.info'), 'name=B\nid=Mod.B')
    await write(path.join(cachePath, 'mods', 'B', 'media', 'b.lua'), 'return "b"')
    await write(path.join(cachePath, 'mods', 'C', 'mod.info'), 'name=C\nid=Mod.C')
    await write(path.join(cachePath, 'mods', 'C', 'media', 'c.lua'), 'return "c"')

    const config: FreezeConfig = {
      ManagerRoot: root,
      FreezeRoot: sourceRoot,
      GamePath: gamePath,
      CachePath: cachePath,
      ReportPath: path.join(sourceRoot, 'reports'),
      BackupPath: path.join(sourceRoot, 'backups'),
      Version: '42.22.2'
    }
    const plan = await analyzeQuickMigration(sourceRoot, config)
    assert.equal(plan.analysis.fallbackToAllMods, false)
    assert.deepEqual(plan.analysis.activeModIds, ['Mod.A', 'Mod.B'])
    assert.deepEqual(plan.analysis.missingModIds, [])
    assert.equal(plan.analysis.referencedModRoots, 2)
    assert(plan.mutableFiles.some((file) => file.relativePath === 'options.ini'))
    assert(plan.mutableFiles.some((file) => file.relativePath.endsWith(path.join('Round2', 'mods.txt'))))
    assert(!plan.mutableFiles.some((file) => file.relativePath.toLowerCase().startsWith(`mods${path.sep}`)))
    assert(!plan.mutableFiles.some((file) => file.relativePath.toLowerCase().startsWith(`logs${path.sep}`)))

    const references = await materializeQuickMigration(plan, targetCache)
    assert.equal(references.length, 2)
    assert.equal(await fs.readFile(path.join(targetCache, 'options.ini'), 'utf8'), 'fullscreen=true')
    assert.equal(await fs.readFile(path.join(targetCache, 'Saves', 'Sandbox', 'Round2', 'mods.txt'), 'utf8'), 'VERSION = 1,\nmods\n{\n mod = Mod.A,\n}')
    await assert.rejects(fs.access(path.join(targetCache, 'logs', 'debug.log')))
    assert.equal(await fs.readFile(path.join(targetCache, 'mods', 'A', 'media', 'a.lua'), 'utf8'), 'return "a"')
    assert.equal(await fs.readFile(path.join(targetCache, 'mods', 'B', 'media', 'b.lua'), 'utf8'), 'return "b"')
    await assert.rejects(fs.access(path.join(targetCache, 'mods', 'C')))

    await fs.writeFile(path.join(targetCache, 'options.ini'), 'fullscreen=false', 'utf8')
    assert.equal(await fs.readFile(path.join(cachePath, 'options.ini'), 'utf8'), 'fullscreen=true')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('启用列表缺少 MOD 时保留缺失证据并挂接所有现存 MOD', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-quick-missing-'))
  try {
    const sourceRoot = path.join(root, 'source')
    const cachePath = path.join(sourceRoot, 'cache')
    await write(path.join(sourceRoot, 'game', 'core.bin'), 'game')
    await write(path.join(cachePath, 'Saves', 'Sandbox', 'Round2', 'mods.txt'), 'mod = Missing.Mod,')
    await write(path.join(cachePath, 'mods', 'Available', 'mod.info'), 'name=Available\nid=Available.Mod')
    const plan = await analyzeQuickMigration(sourceRoot, { ManagerRoot: root, FreezeRoot: sourceRoot, GamePath: path.join(sourceRoot, 'game'), CachePath: cachePath, ReportPath: path.join(sourceRoot, 'reports'), BackupPath: path.join(sourceRoot, 'backups'), Version: '42.22.2' })
    assert.deepEqual(plan.analysis.missingModIds, ['Missing.Mod'])
    assert.equal(plan.analysis.referencedModRoots, 1)
    assert.equal(plan.referencedMods[0]?.modIds[0], 'Available.Mod')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
