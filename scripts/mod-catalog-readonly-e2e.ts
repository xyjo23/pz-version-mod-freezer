import { promises as fs } from 'node:fs'
import path from 'node:path'

import { buildModCatalog, persistModCatalog } from '../src/main/mod-catalog'
import { discoverLocalMods } from '../src/main/mod-resolver'
import { isPathWithin, normalizeRoot } from '../src/main/safe-write'
import type { FreezeConfig, GameIdentity } from '../src/shared/types'

const configPath = process.env.PZ_MOD_CATALOG_CONFIG
const outputPath = process.env.PZ_MOD_CATALOG_OUTPUT
if (!configPath || !outputPath) throw new Error('PZ_MOD_CATALOG_CONFIG and PZ_MOD_CATALOG_OUTPUT are required.')

const main = async (): Promise<void> => {
  const config = JSON.parse((await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')) as FreezeConfig
  const freezeRoot = normalizeRoot(config.FreezeRoot)
  const normalizedOutput = normalizeRoot(outputPath)
  if (normalizedOutput === freezeRoot || isPathWithin(freezeRoot, normalizedOutput)) {
    throw new Error(`Read-only real scan refuses to write inside the source version: ${normalizedOutput}`)
  }
  const metadataPath = path.join(freezeRoot, 'metadata', 'freeze.json')
  const metadataBefore = await fs.stat(metadataPath)
  const started = Date.now()
  const mods = await discoverLocalMods(path.join(config.CachePath, 'mods'), config.Version ?? 'unknown')
  const identity: GameIdentity = {
    version: config.Version ?? 'unknown',
    revision: config.Revision ?? null,
    buildId: config.BuildID ?? 'unknown',
    jarSha256: config.GameJarSHA256 ?? null,
    status: config.IdentityStatus ?? 'unknown',
    source: config.GameJarSHA256 ? 'metadata' : 'unknown',
    cachedVersion: null,
    cachedRevision: null,
    evidence: [`只读来源：${metadataPath}`]
  }
  const catalog = await persistModCatalog(await buildModCatalog({
    source: 'Frozen',
    sourceLabel: config.DisplayName?.trim() || path.basename(freezeRoot),
    catalogPath: normalizedOutput,
    game: identity,
    gamePath: config.GamePath,
    mods
  }))
  const metadataAfter = await fs.stat(metadataPath)
  if (metadataAfter.size !== metadataBefore.size || metadataAfter.mtimeMs !== metadataBefore.mtimeMs) {
    throw new Error('Source metadata changed during the read-only catalog scan.')
  }
  console.log(`MOD_CATALOG_READONLY_E2E=${JSON.stringify({
    source: freezeRoot,
    output: normalizedOutput,
    elapsedMs: Date.now() - started,
    completeness: catalog.completeness,
    digest: catalog.catalogDigest,
    summary: catalog.summary
  })}`)
}

void main().catch((error) => {
  console.error(`MOD_CATALOG_READONLY_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
