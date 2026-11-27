import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'

import { buildModCenterSnapshot } from '../src/main/mod-center-model'
import type { ModCatalog } from '../src/shared/types'

const catalogPath = process.env.PZ_MOD_CENTER_CATALOG
if (!catalogPath) throw new Error('PZ_MOD_CENTER_CATALOG is required.')

const main = async (): Promise<void> => {
  const before = await fs.stat(catalogPath)
  const started = Date.now()
  const catalog = JSON.parse((await fs.readFile(catalogPath, 'utf8')).replace(/^\uFEFF/, '')) as ModCatalog
  const snapshot = buildModCenterSnapshot(catalog)
  const after = await fs.stat(catalogPath)
  assert.equal(after.size, before.size, 'Source catalog size changed during read-only projection.')
  assert.equal(after.mtimeMs, before.mtimeMs, 'Source catalog timestamp changed during read-only projection.')
  assert.equal(snapshot.mods.length, catalog.summary.discoveredMods)
  assert.equal(snapshot.mods.reduce((sum, mod) => sum + mod.content.totalFiles, 0), catalog.summary.files)
  assert.equal(snapshot.mods.filter((mod) => mod.flags.hasBinaryCode).length, snapshot.summary.modsWithBinaryCode)
  console.log(`MOD_CENTER_READONLY_E2E=${JSON.stringify({
    catalog: catalogPath,
    elapsedMs: Date.now() - started,
    mods: snapshot.mods.length,
    active: snapshot.summary.activeMods,
    files: snapshot.summary.files,
    missingDependencies: snapshot.summary.missingDependencies,
    activeIncompatibilities: snapshot.summary.activeIncompatibilities,
    binaryMods: snapshot.summary.modsWithBinaryCode,
    completeness: snapshot.completeness
  })}`)
}

void main().catch((error) => {
  console.error(`MOD_CENTER_READONLY_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
