import assert from 'node:assert/strict'
import test from 'node:test'

import type { ModCatalog, ModCatalogEntry } from '../shared/types'
import { buildModCenterSnapshot } from './mod-center-model'

const entry = (value: Partial<ModCatalogEntry> & Pick<ModCatalogEntry, 'catalogId' | 'name' | 'modId'>): ModCatalogEntry => ({
  catalogId: value.catalogId,
  key: value.catalogId,
  name: value.name,
  modId: value.modId,
  workshopId: value.workshopId ?? null,
  source: value.source ?? 'Local',
  rootPath: value.rootPath ?? `C:\\mods\\${value.catalogId}`,
  active: value.active ?? false,
  version: value.version ?? { target: '42.21.0', selected: '42.21', variants: ['42.21'], layers: ['common', '42.21'], minimum: null, maximum: null, resolutionIssue: null },
  dependencies: value.dependencies ?? { require: [], incompatible: [], loadAfter: [], loadBefore: [] },
  metadata: value.metadata ?? { path: null, sha256: null, readError: null },
  content: value.content ?? {
    files: [], totalFiles: 0, totalBytes: 0, contentDigest: 'C'.repeat(64), layerOverrides: [], skippedLinks: [], unreadable: [], jars: [], classes: [], nativeBinaries: []
  },
  evidence: value.evidence ?? []
})

test('MOD 中心投影保留依赖、重复 ID、文件类型和证据边界', () => {
  const mods = [
    entry({
      catalogId: 'a', name: 'Core A', modId: 'Fixture.A', active: true,
      dependencies: { require: ['Missing.Mod'], incompatible: ['Fixture.B'], loadAfter: [], loadBefore: [] },
      content: {
        files: [{ relativePath: 'media/lua/a.lua', sourcePath: 'C:\\a.lua', layerPath: 'C:\\mods\\a', bytes: 10, modifiedAt: '2026-11-27T00:00:00.000Z', sha256: 'A'.repeat(64), kind: 'lua' }, { relativePath: 'lib/a.jar', sourcePath: 'C:\\a.jar', layerPath: 'C:\\mods\\a', bytes: 20, modifiedAt: '2026-11-27T00:00:00.000Z', sha256: 'B'.repeat(64), kind: 'java-archive' }],
        totalFiles: 2, totalBytes: 30, contentDigest: 'C'.repeat(64), layerOverrides: [], skippedLinks: [], unreadable: [], jars: ['lib/a.jar'], classes: [], nativeBinaries: []
      }
    }),
    entry({ catalogId: 'a-copy', name: 'Core A duplicate', modId: 'Fixture.A' }),
    entry({ catalogId: 'b', name: 'Dependent B', modId: 'Fixture.B', active: true, dependencies: { require: ['Fixture.A'], incompatible: [], loadAfter: ['Fixture.A'], loadBefore: [] } })
  ]
  const catalog: ModCatalog = {
    schemaVersion: 1, generatedAt: '2026-11-27T00:00:00.000Z', source: 'Frozen', sourceLabel: 'Fixture', catalogPath: 'C:\\catalog.json',
    game: { version: '42.21.0', revision: 'rev', buildId: 'build', jarSha256: 'D'.repeat(64), status: 'verified', source: 'binary', cachedVersion: '42.21.0', cachedRevision: 'rev', evidence: [] },
    digestAlgorithm: 'SHA-256', catalogDigest: 'E'.repeat(64), completeness: 'complete',
    summary: { discoveredMods: 3, resolvedMods: 3, unresolvedMods: 0, activeMods: 1, uniqueModIds: 2, workshopProjects: 0, duplicateModIds: 1, files: 2, bytes: 30, jars: 1, classes: 0, nativeBinaries: 0, unreadable: 0, skippedLinks: 0 },
    indexes: { byModId: { 'Fixture.A': ['a', 'a-copy'], 'Fixture.B': ['b'] }, byWorkshopId: {}, requiredBy: { 'Fixture.A': ['b'], 'Missing.Mod': ['a'] } },
    methodology: ['fixture'], limitations: [], mods
  }
  const snapshot = buildModCenterSnapshot(catalog)
  const core = snapshot.mods.find((mod) => mod.catalogId === 'a')!
  assert.equal(core.flags.duplicateModId, true)
  assert.equal(core.flags.hasBinaryCode, true)
  assert.deepEqual(core.dependencies.missingRequired, ['Missing.Mod'])
  assert.deepEqual(core.dependencies.activeIncompatible, ['Fixture.B'])
  assert.deepEqual(core.dependencies.requiredBy.map((mod) => mod.modId), ['Fixture.B'])
  assert.equal(core.content.kindCounts.lua, 1)
  assert.equal(core.content.kindCounts['java-archive'], 1)
  assert.equal(snapshot.summary.missingDependencies, 1)
  assert.equal(snapshot.summary.activeIncompatibilities, 1)
  assert.equal(snapshot.summary.modsWithBinaryCode, 1)
})
