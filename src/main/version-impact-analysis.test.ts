import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import test from 'node:test'

import { ZipFile } from 'yazl'

import type { GameIdentity } from '../shared/types'
import { analyzeVersionImpact, discoverVersionBaseline } from './version-impact-analysis'

const u2 = (value: number): Buffer => { const result = Buffer.alloc(2); result.writeUInt16BE(value); return result }
const utf8 = (value: string): Buffer => { const bytes = Buffer.from(value); return Buffer.concat([Buffer.from([1]), u2(bytes.length), bytes]) }
const classRef = (index: number): Buffer => Buffer.concat([Buffer.from([7]), u2(index)])
const classFile = (name: string, major: number): Buffer => Buffer.concat([
  Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]), u2(0), u2(major), u2(5),
  utf8(name), classRef(1), utf8('java/lang/Object'), classRef(3),
  u2(1), u2(2), u2(4), u2(0), u2(0), u2(0), u2(0)
])

const writeGameJar = async (filePath: string, classes: Array<{ name: string; major: number }>): Promise<void> => {
  const zip = new ZipFile()
  for (const entry of classes) zip.addBuffer(classFile(entry.name, entry.major), `${entry.name}.class`)
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(filePath))
}

const identity: GameIdentity = { version: '42.22.2', revision: 'new', buildId: '200', jarSha256: null, status: 'verified', source: 'binary', cachedVersion: null, cachedRevision: null, evidence: [] }

test('选择最近的旧冻结版并输出三类更新影响交集', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-impact-'))
  try {
    const baselineRoot = path.join(root, 'frozen', 'old')
    const baselineGame = path.join(baselineRoot, 'game')
    const currentGame = path.join(root, 'current')
    await fs.mkdir(path.join(baselineRoot, 'metadata'), { recursive: true })
    await fs.mkdir(path.join(baselineGame, 'media', 'scripts'), { recursive: true })
    await fs.mkdir(path.join(currentGame, 'media', 'scripts'), { recursive: true })
    await fs.mkdir(path.join(baselineGame, 'media', 'lua', 'shared'), { recursive: true })
    await fs.mkdir(path.join(currentGame, 'media', 'lua', 'shared'), { recursive: true })
    await fs.writeFile(path.join(baselineRoot, 'metadata', 'freeze.json'), JSON.stringify({ Version: '42.21.0', BuildID: '100', GamePath: baselineGame, FullVersion: 'revision=old', Created: '2026-01-01' }))
    await fs.writeFile(path.join(baselineGame, 'media', 'scripts', 'items.txt'), 'module Base { item Thing { Type = Normal, Weight = 1, } item Removed { Type = Normal, } }')
    await fs.writeFile(path.join(currentGame, 'media', 'scripts', 'items.txt'), 'module Base { item Thing { Type = Normal, Weight = 2, } item Added { Type = Normal, } }')
    const oldOverride = 'return 1'
    await fs.writeFile(path.join(baselineGame, 'media', 'lua', 'shared', 'override.lua'), oldOverride)
    await fs.writeFile(path.join(currentGame, 'media', 'lua', 'shared', 'override.lua'), 'return 2')
    await writeGameJar(path.join(baselineGame, 'projectzomboid.jar'), [{ name: 'zombie/Test', major: 60 }, { name: 'zombie/Removed', major: 60 }])
    await writeGameJar(path.join(currentGame, 'projectzomboid.jar'), [{ name: 'zombie/Test', major: 61 }])

    const discovered = await discoverVersionBaseline(root, identity)
    assert.equal(discovered?.version, '42.21.0')
    const reportPath = path.join(root, 'reports', 'impact.json')
    const report = await analyzeVersionImpact({
      managerRoot: root, currentGamePath: currentGame, current: identity, reportPath,
      mods: [{ id: 'ExampleMod', files: [{ relativePath: 'media/lua/shared/override.lua', sha256: createHash('sha256').update(oldOverride).digest('hex').toUpperCase(), kind: 'lua' }], scriptDefinitionKeys: ['Base.item Thing'], projectZomboidClasses: ['zombie/Test', 'zombie/Removed'] }]
    })
    assert(report)
    assert.equal(report.completeness, 'complete')
    assert.equal(report.summary.scriptDefinitionsChanged, 1)
    assert.equal(report.summary.scriptDefinitionsRemoved, 1)
    assert.equal(report.summary.modScriptDefinitionsAffected, 1)
    assert.equal(report.summary.overriddenBaseFilesChanged, 1)
    assert.equal(report.summary.exactOldBaseCopies, 1)
    assert.deepEqual(report.overriddenBaseFiles.changed[0].staleCopyMods, ['ExampleMod'])
    assert.equal(report.summary.javaClassesChanged, 1)
    assert.equal(report.summary.javaClassesRemoved, 1)
    assert.equal(report.summary.javaClassesUnresolved, 0)
    assert.deepEqual(report.scriptDefinitions.affectedByMods.map((entry) => entry.key), ['Base.item Thing'])
    assert.match(report.reportDigest, /^[A-F0-9]{64}$/)
    assert.equal(JSON.parse(await fs.readFile(reportPath, 'utf8')).reportDigest, report.reportDigest)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('没有更低版本时明确返回 null 而不是伪造基线', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-impact-none-'))
  try {
    await fs.mkdir(path.join(root, 'frozen'), { recursive: true })
    assert.equal(await discoverVersionBaseline(root, identity), null)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('同版本号时选择更旧 Build 作为更新基线', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-impact-build-'))
  try {
    const candidate = path.join(root, 'frozen', 'same-version')
    const gamePath = path.join(candidate, 'game')
    await fs.mkdir(path.join(candidate, 'metadata'), { recursive: true })
    await fs.mkdir(gamePath, { recursive: true })
    await writeGameJar(path.join(gamePath, 'projectzomboid.jar'), [{ name: 'zombie/Test', major: 60 }])
    await fs.writeFile(path.join(candidate, 'metadata', 'freeze.json'), JSON.stringify({ Version: '42.22.2', BuildID: '199', GamePath: gamePath }))
    assert.equal((await discoverVersionBaseline(root, identity))?.buildId, '199')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
