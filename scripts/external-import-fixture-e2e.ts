import assert from 'node:assert/strict'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { activateVersion, getSnapshot, importVersionPaths, listVersions } from '../src/main/vault-service'
import type { FreezeConfig } from '../src/shared/types'

const testRoot = process.env.PZ_IMPORT_E2E_ROOT
if (!testRoot) throw new Error('PZ_IMPORT_E2E_ROOT is required.')
if (existsSync(testRoot)) throw new Error(`Refusing to reuse an existing import fixture root: ${testRoot}`)

const write = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

const main = async (): Promise<void> => {
  const userData = path.join(testRoot, '.launcher-user-data')
  const externalRoot = path.join(testRoot, 'portable-external-version')
  const invalidRoot = path.join(testRoot, 'not-a-version')
  const malformedRoot = path.join(testRoot, 'malformed-version')
  const gamePath = path.join(externalRoot, 'game')
  const cachePath = path.join(externalRoot, 'cache')
  await write(path.join(gamePath, 'media', 'fixture.txt'), 'external game fixture')
  await write(path.join(cachePath, 'version.txt'), '42.22.2')
  await fs.mkdir(invalidRoot, { recursive: true })
  await write(path.join(malformedRoot, 'metadata', 'freeze.json'), '{}\n')
  const config: FreezeConfig = {
    ManagerRoot: path.join(testRoot, 'unrelated-original-manager'),
    FreezeRoot: path.join(testRoot, 'stale-location'),
    GamePath: path.join(testRoot, 'stale-location', 'game'),
    CachePath: path.join(testRoot, 'stale-location', 'cache'),
    ManifestPath: path.join(testRoot, 'stale-location', 'manifests'),
    ReportPath: path.join(testRoot, 'stale-location', 'reports'),
    BackupPath: path.join(testRoot, 'stale-location', 'backups'),
    Version: '42.22.2',
    BuildID: 'external-fixture-build',
    DisplayName: 'Round 5 External Fixture',
    Created: new Date().toISOString(),
    StorageMode: 'FullCopy',
    LaunchArguments: ['-cachedir=E:\\stale-cache', '-debug']
  }
  await write(path.join(externalRoot, 'metadata', 'freeze.json'), `${JSON.stringify(config, null, 2)}\n`)
  app.setPath('userData', userData)
  await app.whenReady()

  const firstImport = await importVersionPaths([externalRoot, invalidRoot, malformedRoot])
  assert.equal(firstImport.imported, 1)
  assert.equal(firstImport.skipped, 2)
  const versions = await listVersions()
  const imported = versions.find((version) => path.resolve(version.freezeRoot) === path.resolve(externalRoot))
  assert(imported, 'External fixture was not registered.')
  assert.equal(imported.origin, 'External')
  assert.equal(imported.isHealthy, true)
  assert.equal(imported.gamePath, gamePath)
  assert.equal(imported.cachePath, cachePath)

  const repeated = await importVersionPaths([externalRoot])
  assert.equal(repeated.imported, 0)
  assert.equal(repeated.skipped, 1)
  const externalMetadataPath = path.join(externalRoot, 'metadata', 'freeze.json')
  const externalMetadataBefore = await fs.readFile(externalMetadataPath, 'utf8')
  const externalMetadataTime = (await fs.stat(externalMetadataPath)).mtimeMs
  const activated = await activateVersion(imported.id)
  assert.equal(activated.activeSource, 'Frozen')
  assert.equal(path.resolve(activated.config!.FreezeRoot), path.resolve(externalRoot))
  assert.equal(path.resolve(activated.config!.GamePath), path.resolve(gamePath))
  assert.equal(path.resolve(activated.config!.CachePath), path.resolve(cachePath))
  assert.equal(path.resolve(activated.config!.ReportPath), path.resolve(path.join(externalRoot, 'reports')))
  assert.equal(path.resolve(activated.config!.BackupPath), path.resolve(path.join(externalRoot, 'backups')))
  assert.equal(path.resolve(activated.config!.ManifestPath!), path.resolve(path.join(externalRoot, 'manifests')))
  assert.equal(path.resolve(activated.config!.ManagerRoot), path.resolve(externalRoot))
  assert.equal(activated.enginePath, null)
  assert(activated.config!.LaunchArguments?.includes(`-cachedir=${cachePath}`))
  assert(!activated.config!.LaunchArguments?.includes('-cachedir=E:\\stale-cache'))
  assert.equal(await fs.readFile(externalMetadataPath, 'utf8'), externalMetadataBefore)
  assert.equal((await fs.stat(externalMetadataPath)).mtimeMs, externalMetadataTime)
  const persisted = await getSnapshot()
  assert.equal(persisted.isHealthy, true)
  assert.equal(path.resolve(persisted.config!.FreezeRoot), path.resolve(externalRoot))

  console.log(`EXTERNAL_IMPORT_E2E=${JSON.stringify({
    root: testRoot,
    externalRoot,
    imported: firstImport.imported,
    invalidSkipped: firstImport.skipped,
    duplicateSkipped: repeated.skipped,
    origin: imported.origin,
    activated: persisted.activeSource,
    normalizedGamePath: persisted.config?.GamePath,
    normalizedCachePath: persisted.config?.CachePath,
    externalMetadataPreserved: true
  })}`)
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`EXTERNAL_IMPORT_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
