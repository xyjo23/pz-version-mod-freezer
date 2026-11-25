import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { discoverLocalMods } from './mod-resolver.ts'

const write = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

test('B42 目录选择 common 加不高于游戏版本的最高变体', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-mod-resolver-'))
  try {
    const modRoot = path.join(root, 'VersionedMod')
    await write(path.join(modRoot, 'common', 'media', 'lua', 'shared.lua'), 'return "common"')
    await write(path.join(modRoot, '42.19', 'mod.info'), 'name=Old\nid=Versioned.Old')
    await write(path.join(modRoot, '42.20.1', 'mod.info'), [
      'name=Selected',
      'id=\\+Versioned.Selected',
      'require=\\+Base.One; Base.Two',
      'incompatible=Bad.One,Bad.Two',
      'loadModAfter=Base.One',
      'loadModBefore=Patch.One',
      'versionMin=42.20.1',
      'tiledef=selected_tiles 2048'
    ].join('\n'))
    await write(path.join(modRoot, '42.23', 'mod.info'), 'name=Future\nid=Versioned.Future')
    await write(path.join(modRoot, '41.78', 'mod.info'), 'name=B41\nid=Versioned.B41')

    const [resolved] = await discoverLocalMods(root, '42.22.2')
    assert.equal(resolved.record.selectedVersion, '42.20.1')
    assert.deepEqual(resolved.layers, [path.join(modRoot, 'common'), path.join(modRoot, '42.20.1')])
    assert.deepEqual(resolved.record.variants, ['42.19', '42.20.1', '42.23'])
    assert.equal(resolved.record.modId, 'Versioned.Selected')
    assert.deepEqual(resolved.record.require, ['Base.One', 'Base.Two'])
    assert.deepEqual(resolved.record.incompatible, ['Bad.One', 'Bad.Two'])
    assert.deepEqual(resolved.record.loadAfter, ['Base.One'])
    assert.deepEqual(resolved.record.loadBefore, ['Patch.One'])
    assert.deepEqual(resolved.tileDefinitions, [{ name: 'selected_tiles', number: 2048 }])
    assert.equal(resolved.resolutionIssue, null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('只有未来版本目录时不会误选为当前 B42 内容', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-mod-future-'))
  try {
    await write(path.join(root, 'FutureOnly', '42.23', 'mod.info'), 'name=Future only\nid=Future.Only')
    const [resolved] = await discoverLocalMods(root, '42.22.2')
    assert.equal(resolved.record.selectedVersion, null)
    assert.deepEqual(resolved.layers, [])
    assert.match(resolved.resolutionIssue ?? '', /没有适用于游戏 42\.22\.2/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('本地化 Workshop 目录保留 Workshop ID', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-mod-workshop-'))
  try {
    await write(path.join(root, 'WS123456__Example', 'mod.info'), 'name=Example\nid=Example.Mod')
    const [resolved] = await discoverLocalMods(root, '42.22.2')
    assert.equal(resolved.record.workshopId, '123456')
    assert.equal(resolved.record.source, 'Workshop')
    assert.equal(resolved.record.modId, 'Example.Mod')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
