import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { analyzeCompatibility } from '../src/main/compatibility-service'
import { analyzeIntegrity } from '../src/main/integrity-service'
import type { CompatibilitySeverity, FreezeConfig } from '../src/shared/types'
import { holdExclusiveFileLock, holdReadDenied } from './file-lock'

const testRoot = process.env.PZ_ANALYSIS_FIXTURE_ROOT
if (!testRoot) throw new Error('PZ_ANALYSIS_FIXTURE_ROOT is required.')
if (existsSync(testRoot)) throw new Error(`Refusing to reuse an existing analysis fixture root: ${testRoot}`)

const write = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

const collectFiles = async (root: string): Promise<string[]> => {
  const files: string[] = []
  const pending = ['']
  while (pending.length) {
    const relativeDirectory = pending.pop()!
    for (const entry of await fs.readdir(path.join(root, relativeDirectory), { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) pending.push(relativePath)
      else if (entry.isFile()) files.push(relativePath)
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'))
}

const writeManifest = async (root: string, destination: string): Promise<void> => {
  const rows = ['"RelativePath","Length","SHA256"']
  for (const relativePath of await collectFiles(root)) {
    const contents = await fs.readFile(path.join(root, relativePath))
    rows.push(`"${relativePath.replace(/"/g, '""')}","${contents.length}","${createHash('sha256').update(contents).digest('hex').toUpperCase()}"`)
  }
  await write(destination, `\uFEFF${rows.join('\r\n')}\r\n`)
}

const createMod = async (modsRoot: string, directory: string, info: string, files: Record<string, string> = {}): Promise<void> => {
  await write(path.join(modsRoot, directory, 'mod.info'), info)
  for (const [relativePath, contents] of Object.entries(files)) await write(path.join(modsRoot, directory, relativePath), contents)
}

const main = async (): Promise<void> => {
  const freezeRoot = path.join(testRoot, 'frozen', 'analysis-oracle')
  const gamePath = path.join(freezeRoot, 'game')
  const cachePath = path.join(freezeRoot, 'cache')
  const modsRoot = path.join(cachePath, 'mods')
  const manifests = path.join(freezeRoot, 'manifests')
  const userData = path.join(testRoot, '.launcher-user-data')

  const gameBasePath = path.join(gamePath, 'media', 'base.txt')
  await write(gameBasePath, 'baseline game file')
  await write(path.join(gamePath, 'media', 'lua', 'shared', 'collision.lua'), 'return "base"')
  await write(path.join(cachePath, 'version.txt'), '42.22.2')

  await createMod(modsRoot, 'A', 'name=A\nid=Mod.A\nrequire=Mod.B\nloadModAfter=Mod.B')
  await createMod(modsRoot, 'B', 'name=B\nid=Mod.B\nrequire=Mod.A')
  await createMod(modsRoot, 'C', 'name=C\nid=Mod.C\nincompatible=Mod.D\nloadModBefore=Mod.D')
  await createMod(modsRoot, 'D', 'name=D\nid=Mod.D')
  await createMod(modsRoot, 'DuplicateOne', 'name=Duplicate one\nid=Mod.Duplicate')
  await createMod(modsRoot, 'DuplicateTwo', 'name=Duplicate two\nid=Mod.Duplicate')
  await createMod(modsRoot, 'TileOne', 'name=Tile one\nid=Mod.TileOne\ntiledef=tiles_one 5000')
  await createMod(modsRoot, 'TileTwo', 'name=Tile two\nid=Mod.TileTwo\ntiledef=tiles_two 5000')
  await createMod(modsRoot, 'OldVersion', 'name=Old version\nid=Mod.Old\nversionMax=42.20')
  await createMod(modsRoot, 'MissingDependency', 'name=Missing dependency\nid=Mod.NeedsMissing\nrequire=Mod.NotInstalled')
  const overlapFilesOne = {
    [path.join('media', 'lua', 'shared', 'collision.lua')]: 'return "one"',
    [path.join('media', 'scripts', 'items.txt')]: 'module One {}',
    [path.join('media', 'lua', 'shared', 'Translate', 'EN', 'shared.txt')]: 'Shared = Same',
    [path.join('media', 'lua', 'shared', 'Translate', 'EN', 'different.txt')]: 'Label = One',
    [path.join('media', 'lua', 'shared', 'Translate', 'EN', 'disjoint.json')]: '{"OnlyOne":"One"}',
    [path.join('media', 'lua', 'shared', 'Translate', 'EN', 'unparsed.txt')]: 'not a supported translation table'
  }
  const overlapFilesTwo = {
    [path.join('media', 'lua', 'shared', 'collision.lua')]: 'return "two"',
    [path.join('media', 'scripts', 'items.txt')]: 'module Two {}',
    [path.join('media', 'lua', 'shared', 'Translate', 'EN', 'shared.txt')]: 'Shared = Same',
    [path.join('media', 'lua', 'shared', 'Translate', 'EN', 'different.txt')]: 'Label = Two',
    [path.join('media', 'lua', 'shared', 'Translate', 'EN', 'disjoint.json')]: '{"OnlyTwo":"Two"}',
    [path.join('media', 'lua', 'shared', 'Translate', 'EN', 'unparsed.txt')]: 'another unsupported translation table'
  }
  await createMod(modsRoot, 'OverlapOne', 'name=Overlap one\nid=Mod.OverlapOne', overlapFilesOne)
  await createMod(modsRoot, 'OverlapTwo', 'name=Overlap two\nid=Mod.OverlapTwo', overlapFilesTwo)
  await createMod(modsRoot, 'FutureOnly', '', { [path.join('42.23', 'mod.info')]: 'name=Future only\nid=Mod.Future' })

  const activeIds = ['Mod.A', 'Mod.B', 'Mod.D', 'Mod.C', 'Mod.Duplicate', 'Mod.TileOne', 'Mod.TileTwo', 'Mod.Old', 'Mod.NeedsMissing', 'Mod.OverlapOne', 'Mod.OverlapTwo']
  await write(path.join(cachePath, 'Saves', 'Sandbox', 'AnalysisOracle', 'mods.txt'), `VERSION = 1,\nmods\n{\n${activeIds.map((id) => `    mod = ${id},`).join('\n')}\n}`)
  await writeManifest(gamePath, path.join(manifests, 'game.sha256.csv'))
  await writeManifest(modsRoot, path.join(manifests, 'mods.sha256.csv'))

  const config: FreezeConfig = {
    ManagerRoot: testRoot,
    FreezeRoot: freezeRoot,
    GamePath: gamePath,
    CachePath: cachePath,
    ManifestPath: manifests,
    ReportPath: path.join(freezeRoot, 'reports'),
    BackupPath: path.join(freezeRoot, 'backups'),
    Version: '42.22.2',
    BuildID: 'fixture-26486631',
    DisplayName: 'Analysis oracle',
    Created: new Date().toISOString(),
    StorageMode: 'FullCopy'
  }
  await write(path.join(freezeRoot, 'metadata', 'freeze.json'), JSON.stringify(config, null, 2))
  await write(path.join(userData, 'launcher-settings.json'), JSON.stringify({ managerRoot: testRoot, activeSource: 'Frozen', activeVersionRoot: freezeRoot }, null, 2))
  app.setPath('userData', userData)
  await app.whenReady()

  const baseline = await analyzeIntegrity()
  assert.equal(baseline.verdict, 'pass', baseline.plainSummary)
  assert.equal(baseline.summary.missingFiles, 0)
  assert.equal(baseline.summary.changedFiles, 0)
  assert.equal(baseline.summary.addedFiles, 0)

  const changedPath = path.join(modsRoot, 'OverlapOne', 'media', 'lua', 'shared', 'collision.lua')
  const changedOriginal = await fs.readFile(changedPath, 'utf8')
  const missingOriginal = await fs.readFile(gameBasePath, 'utf8')
  const addedPath = path.join(modsRoot, 'OverlapOne', 'media', 'unexpected.txt')
  await fs.unlink(gameBasePath)
  await fs.writeFile(changedPath, 'return "tampered"', 'utf8')
  await write(addedPath, 'new untracked file')
  const damaged = await analyzeIntegrity()
  assert.equal(damaged.verdict, 'blocker')
  assert.equal(damaged.summary.missingFiles, 1)
  assert.equal(damaged.summary.changedFiles, 1)
  assert.equal(damaged.summary.addedFiles, 1)
  assert(damaged.findings.some((finding) => finding.id === 'game-missing' && finding.severity === 'blocker'))
  assert(damaged.findings.some((finding) => finding.id === 'mods-changed' && finding.severity === 'blocker'))
  assert(damaged.findings.some((finding) => finding.id === 'mods-added' && finding.severity === 'warning'))

  await write(gameBasePath, missingOriginal)
  await fs.writeFile(changedPath, changedOriginal, 'utf8')
  await fs.unlink(addedPath)
  const restored = await analyzeIntegrity()
  assert.equal(restored.verdict, 'pass', restored.plainSummary)

  const exclusiveLock = await holdExclusiveFileLock(changedPath)
  let lockedFileDetected = false
  try {
    const locked = await analyzeIntegrity()
    assert.equal(locked.verdict, 'blocker')
    assert.equal(locked.summary.unreadableFiles, 1)
    assert(locked.findings.some((finding) => finding.rule === 'FULL-FILE-READABLE' && finding.severity === 'blocker'))
    lockedFileDetected = true
  } finally {
    await exclusiveLock.release()
  }
  const unlocked = await analyzeIntegrity()
  assert.equal(unlocked.verdict, 'pass', unlocked.plainSummary)

  const deniedRead = await holdReadDenied(changedPath)
  let deniedReadDetected = false
  try {
    const denied = await analyzeIntegrity()
    assert.equal(denied.verdict, 'blocker')
    assert.equal(denied.summary.unreadableFiles, 1)
    assert(denied.findings.some((finding) => finding.rule === 'FULL-FILE-READABLE' && finding.severity === 'blocker'))
    deniedReadDetected = true
  } finally {
    await deniedRead.release()
  }
  const permissionRestored = await analyzeIntegrity()
  assert.equal(permissionRestored.verdict, 'pass', permissionRestored.plainSummary)

  const gameBackupPath = `${gamePath}.round3-backup`
  const gameManifestPath = path.join(manifests, 'game.sha256.csv')
  const gameManifestOriginal = await fs.readFile(gameManifestPath, 'utf8')
  await fs.rename(gamePath, gameBackupPath)
  await fs.mkdir(gamePath, { recursive: true })
  await write(gameManifestPath, '\uFEFF"RelativePath","Length","SHA256"\r\n')
  const emptyGameBaseline = await analyzeIntegrity()
  assert.notEqual(emptyGameBaseline.verdict, 'pass')
  assert(emptyGameBaseline.findings.some((finding) => finding.rule === 'FULL-GAME-BASELINE-NONEMPTY' && finding.severity === 'unknown'))
  await fs.rm(gamePath, { recursive: true, force: true })
  await fs.rename(gameBackupPath, gamePath)
  await fs.writeFile(gameManifestPath, gameManifestOriginal, 'utf8')

  const compatibility = await analyzeCompatibility()
  const requireRule = (rule: string, severity?: CompatibilitySeverity): void => {
    const matched = compatibility.issues.find((issue) => issue.rule === rule && (severity === undefined || issue.severity === severity))
    assert(matched, `Expected compatibility rule ${rule}${severity ? ` (${severity})` : ''}.`)
  }
  requireRule('MOD-ID-UNIQUE', 'blocker')
  requireRule('MOD-DEPENDENCY-ACYCLIC', 'blocker')
  requireRule('MOD-REQUIRE-SATISFIED', 'blocker')
  requireRule('MOD-INCOMPATIBLE', 'blocker')
  requireRule('MOD-LOAD-AFTER', 'warning')
  requireRule('MOD-LOAD-BEFORE', 'warning')
  requireRule('MOD-VERSION-RANGE', 'blocker')
  requireRule('TILEDEF-NUMBER-UNIQUE', 'blocker')
  requireRule('FILE-OVERLAP-LUA', 'unknown')
  requireRule('FILE-OVERLAP-SCRIPTS', 'warning')
  requireRule('FILE-OVERLAP-TRANSLATION', 'warning')
  requireRule('FILE-OVERLAP-TRANSLATION', 'unknown')
  requireRule('FILE-OVERLAP-HASH-EQUALITY', 'pass')
  requireRule('FILE-TRANSLATION-KEYS-DISJOINT', 'pass')
  requireRule('BASE-PATH-OVERRIDE', 'unknown')
  requireRule('B42-COMPATIBLE-LAYER', 'warning')
  assert.equal(compatibility.analysisContext?.missingModIds.length, 0)
  assert.equal(compatibility.verdict, 'blocker')
  assert(compatibility.summary.identicalOverlapPaths >= 1)
  assert(compatibility.summary.baseGameOverrides >= 1)
  assert(existsSync(compatibility.modCatalog.path), 'Compatibility analysis must persist the unified MOD catalog.')
  const catalog = JSON.parse(await fs.readFile(compatibility.modCatalog.path, 'utf8')) as { catalogDigest: string; summary: { discoveredMods: number; files: number } }
  assert.equal(catalog.catalogDigest, compatibility.modCatalog.digest)
  assert.equal(catalog.summary.discoveredMods, compatibility.summary.installedMods)
  assert(catalog.summary.files > 0)

  console.log(`ANALYSIS_FIXTURE_E2E=${JSON.stringify({
    root: testRoot,
    baselineIntegrity: baseline.verdict,
    damagedIntegrity: damaged.summary,
    restoredIntegrity: restored.verdict,
    lockedFileDetected,
    unlockedIntegrity: unlocked.verdict,
    deniedReadDetected,
    permissionRestoredIntegrity: permissionRestored.verdict,
    emptyGameBaseline: emptyGameBaseline.verdict,
    compatibilityVerdict: compatibility.verdict,
    blockers: compatibility.summary.blockers,
    warnings: compatibility.summary.warnings,
    unknowns: compatibility.summary.unknowns,
    overlapPaths: compatibility.summary.overlapPaths,
    identicalOverlapPaths: compatibility.summary.identicalOverlapPaths,
    modCatalogDigest: compatibility.modCatalog.digest,
    modCatalogFiles: compatibility.modCatalog.files,
    checkedRules: ['MOD-ID-UNIQUE', 'MOD-DEPENDENCY-ACYCLIC', 'MOD-REQUIRE-SATISFIED', 'MOD-INCOMPATIBLE', 'MOD-LOAD-AFTER', 'MOD-LOAD-BEFORE', 'MOD-VERSION-RANGE', 'TILEDEF-NUMBER-UNIQUE', 'FILE-OVERLAP-LUA', 'FILE-OVERLAP-SCRIPTS', 'FILE-OVERLAP-TRANSLATION', 'FILE-OVERLAP-HASH-EQUALITY', 'FILE-TRANSLATION-KEYS-DISJOINT', 'BASE-PATH-OVERRIDE', 'B42-COMPATIBLE-LAYER']
  })}`)
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`ANALYSIS_FIXTURE_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
