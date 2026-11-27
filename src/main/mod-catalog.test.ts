import assert from 'node:assert/strict'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import test from 'node:test'

import { ZipFile } from 'yazl'

import type { GameIdentity } from '../shared/types'
import { buildModCatalog, persistModCatalog } from './mod-catalog'
import { discoverLocalMods } from './mod-resolver'

const write = async (filePath: string, contents: string | Buffer): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents)
}

const writeJar = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from('Manifest-Version: 1.0\r\n\r\n'), 'META-INF/MANIFEST.MF')
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(filePath))
}

const identity: GameIdentity = {
  version: '42.22.2', revision: 'fixture-revision', buildId: 'fixture-build', jarSha256: 'GAME-JAR', status: 'verified',
  source: 'binary', cachedVersion: '42.22.2', cachedRevision: 'fixture-revision', evidence: ['fixture']
}

test('统一数据库记录 B42 生效层、文件哈希、二进制和依赖索引', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-mod-catalog-'))
  try {
    const modsRoot = path.join(root, 'mods')
    const versioned = path.join(modsRoot, 'WS111__Versioned')
    await write(path.join(versioned, 'common', 'media', 'lua', 'shared.lua'), 'return "common"')
    await write(path.join(versioned, '42.22', 'media', 'lua', 'shared.lua'), 'return "selected"')
    await writeJar(path.join(versioned, '42.22', 'lib', 'example.jar'))
    await write(path.join(versioned, '42.22', 'classes', 'Example.class'), Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
    await write(path.join(versioned, '42.22', 'native', 'helper.dll'), Buffer.from([0x4d, 0x5a]))
    await write(path.join(versioned, '42.22', 'mod.info'), [
      'name=Versioned Catalog Fixture',
      'id=Catalog.Example',
      'require=Catalog.Base',
      'loadModAfter=Catalog.Base'
    ].join('\n'))
    await write(path.join(modsRoot, 'Base', 'mod.info'), 'name=Base\nid=Catalog.Base')
    await write(path.join(modsRoot, 'Base', 'media', 'scripts', 'items.txt'), 'module Base {}')

    const mods = await discoverLocalMods(modsRoot, identity.version)
    for (const mod of mods) mod.record.active = true
    const catalogPath = path.join(root, 'reports', 'mod-catalog.json')
    const first = await buildModCatalog({ source: 'Frozen', sourceLabel: 'fixture', catalogPath, game: identity, mods })
    const versionedEntry = first.mods.find((mod) => mod.modId === 'Catalog.Example')
    assert(versionedEntry)
    assert.equal(first.completeness, 'complete')
    assert.equal(versionedEntry.version.selected, '42.22')
    assert.equal(versionedEntry.content.layerOverrides.some((entry) => entry.relativePath === 'media/lua/shared.lua'), true)
    assert.deepEqual(versionedEntry.content.jars, ['lib/example.jar'])
    assert.deepEqual(versionedEntry.content.classes, ['classes/Example.class'])
    assert.deepEqual(versionedEntry.content.nativeBinaries, ['native/helper.dll'])
    assert.equal(versionedEntry.content.files.find((file) => file.relativePath === 'media/lua/shared.lua')?.sourcePath, path.join(versioned, '42.22', 'media', 'lua', 'shared.lua'))
    assert.equal(versionedEntry.content.files.every((file) => /^[A-F0-9]{64}$/.test(file.sha256)), true)
    assert.deepEqual(first.indexes.byModId['Catalog.Example'], [versionedEntry.catalogId])
    assert.deepEqual(first.indexes.requiredBy['Catalog.Base'], [versionedEntry.catalogId])
    assert.equal(first.summary.jars, 1)
    assert.equal(first.summary.javaArchivesAnalyzed, 1)
    assert.equal(first.summary.javaArchiveErrors, 0)
    assert.equal(first.summary.classes, 1)
    assert.equal(first.summary.nativeBinaries, 1)

    await persistModCatalog(first)
    const persisted = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as typeof first
    assert.equal(persisted.catalogDigest, first.catalogDigest)
    const second = await buildModCatalog({ source: 'Frozen', sourceLabel: 'fixture', catalogPath, game: identity, mods })
    assert.equal(second.catalogDigest, first.catalogDigest, 'Unchanged content must produce a stable logical digest.')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('相同大小和修改时间不能掩盖内容变化', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-mod-catalog-content-'))
  try {
    const modsRoot = path.join(root, 'mods')
    const contentPath = path.join(modsRoot, 'Example', 'media', 'lua', 'value.lua')
    await write(path.join(modsRoot, 'Example', 'mod.info'), 'name=Example\nid=Catalog.SameMetadata')
    await write(contentPath, 'alpha')
    const original = await fs.stat(contentPath)
    const mods = await discoverLocalMods(modsRoot, identity.version)
    const first = await buildModCatalog({ source: 'Frozen', sourceLabel: 'fixture', catalogPath: path.join(root, 'catalog.json'), game: identity, mods })
    await write(contentPath, 'bravo')
    await fs.utimes(contentPath, original.atime, original.mtime)
    const second = await buildModCatalog({ source: 'Frozen', sourceLabel: 'fixture', catalogPath: path.join(root, 'catalog.json'), game: identity, mods })
    assert.notEqual(second.catalogDigest, first.catalogDigest)
    assert.notEqual(second.mods[0].content.contentDigest, first.mods[0].content.contentDigest)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('重复 Mod ID 在索引中保留全部来源而不是覆盖', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-mod-catalog-duplicate-'))
  try {
    const modsRoot = path.join(root, 'mods')
    await write(path.join(modsRoot, 'A', 'mod.info'), 'name=A\nid=Catalog.Duplicate')
    await write(path.join(modsRoot, 'B', 'mod.info'), 'name=B\nid=Catalog.Duplicate')
    const mods = await discoverLocalMods(modsRoot, identity.version)
    const catalog = await buildModCatalog({ source: 'Frozen', sourceLabel: 'fixture', catalogPath: path.join(root, 'catalog.json'), game: identity, mods })
    assert.equal(catalog.indexes.byModId['Catalog.Duplicate'].length, 2)
    assert.equal(catalog.summary.duplicateModIds, 1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('MOD 根目录联接不会把文件扫描带到目录外', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-mod-catalog-link-'))
  try {
    const modsRoot = path.join(root, 'mods')
    const outside = path.join(root, 'outside-mod')
    await write(path.join(outside, 'mod.info'), 'name=Linked\nid=Catalog.Linked')
    await write(path.join(outside, 'media', 'lua', 'outside.lua'), 'return true')
    await fs.mkdir(modsRoot, { recursive: true })
    try {
      await fs.symlink(outside, path.join(modsRoot, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      context.skip(`当前环境不能创建测试目录联接：${(error as NodeJS.ErrnoException).code ?? 'unknown'}`)
      return
    }
    const mods = await discoverLocalMods(modsRoot, identity.version)
    const catalog = await buildModCatalog({ source: 'Frozen', sourceLabel: 'fixture', catalogPath: path.join(root, 'catalog.json'), game: identity, mods })
    assert.equal(catalog.completeness, 'partial')
    assert.equal(catalog.summary.skippedLinks, 1)
    assert.equal(catalog.mods[0].content.files.length, 0)
    assert.equal(catalog.mods[0].content.skippedLinks[0], path.join(modsRoot, 'Linked'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
