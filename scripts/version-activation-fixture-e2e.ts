import assert from 'node:assert/strict'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { activateVersion, getSnapshot, listVersions } from '../src/main/vault-service'
import type { FreezeConfig } from '../src/shared/types'

const testRoot = process.env.PZ_ACTIVATION_E2E_ROOT
if (!testRoot) throw new Error('PZ_ACTIVATION_E2E_ROOT is required.')
if (existsSync(testRoot)) throw new Error(`Refusing to reuse an existing activation fixture root: ${testRoot}`)

const write = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

const makeVersion = async (managerRoot: string, name: string, buildId: string): Promise<FreezeConfig> => {
  const freezeRoot = path.join(managerRoot, 'frozen', name)
  const gamePath = path.join(freezeRoot, 'game')
  const cachePath = path.join(freezeRoot, 'cache')
  await write(path.join(gamePath, 'ProjectZomboid64.exe'), 'fixture executable')
  await write(path.join(cachePath, 'version.txt'), '42.22.2')
  const config: FreezeConfig = {
    ManagerRoot: managerRoot,
    FreezeRoot: freezeRoot,
    GamePath: gamePath,
    CachePath: cachePath,
    ManifestPath: path.join(freezeRoot, 'manifests'),
    ReportPath: path.join(freezeRoot, 'reports'),
    BackupPath: path.join(freezeRoot, 'backups'),
    Version: '42.22.2',
    BuildID: buildId,
    DisplayName: name,
    Created: new Date().toISOString(),
    StorageMode: 'FullCopy',
    LaunchArguments: ['-nosteam', `-cachedir=${cachePath}`]
  }
  await write(path.join(freezeRoot, 'metadata', 'freeze.json'), JSON.stringify(config, null, 2))
  await write(path.join(managerRoot, 'current-freeze.json'), JSON.stringify(config, null, 2))
  return config
}

const main = async (): Promise<void> => {
  const userData = path.join(testRoot, '.launcher-user-data')
  const managerA = path.join(testRoot, 'manager-a')
  const managerB = path.join(testRoot, 'manager-b')
  const configA = await makeVersion(managerA, 'version-a', 'build-a')
  const configB = await makeVersion(managerB, 'version-b', 'build-b')
  const externalRoot = path.join(testRoot, 'external-version')
  const externalGame = path.join(externalRoot, 'game')
  const externalCache = path.join(externalRoot, 'cache')
  const externalConfig: FreezeConfig = {
    ...configA,
    ManagerRoot: path.join(testRoot, 'former-owner'),
    FreezeRoot: externalRoot,
    GamePath: externalGame,
    CachePath: externalCache,
    ManifestPath: path.join(externalRoot, 'manifests'),
    ReportPath: path.join(externalRoot, 'reports'),
    BackupPath: path.join(externalRoot, 'backups'),
    BuildID: 'build-external',
    DisplayName: 'external-version'
  }
  await write(path.join(externalGame, 'ProjectZomboid64.exe'), 'external fixture executable')
  await write(path.join(externalCache, 'version.txt'), '42.22.2')
  const externalMetadata = path.join(externalRoot, 'metadata', 'freeze.json')
  await write(externalMetadata, JSON.stringify(externalConfig, null, 2))
  const pointerA = path.join(managerA, 'current-freeze.json')
  const pointerB = path.join(managerB, 'current-freeze.json')
  const originalA = await fs.readFile(pointerA, 'utf8')

  await write(path.join(userData, 'launcher-settings.json'), JSON.stringify({
    managerRoot: managerA,
    activeSource: 'Frozen',
    activeVersionRoot: configA.FreezeRoot
  }, null, 2))
  await write(path.join(userData, 'version-registry.json'), JSON.stringify({
    schemaVersion: 1,
    managerRoots: [managerA, managerB],
    versions: [
      { id: 'managed-a', freezeRoot: configA.FreezeRoot, origin: 'Managed', managerRoot: managerA, registeredAt: new Date().toISOString() },
      { id: 'managed-b', freezeRoot: configB.FreezeRoot, origin: 'Managed', managerRoot: managerB, registeredAt: new Date().toISOString() },
      { id: 'external', freezeRoot: externalRoot, origin: 'External', registeredAt: new Date().toISOString() }
    ]
  }, null, 2))

  app.setPath('userData', userData)
  await app.whenReady()

  const versions = await listVersions()
  const versionA = versions.find((version) => version.buildId === 'build-a')
  const versionB = versions.find((version) => version.buildId === 'build-b')
  const externalVersion = versions.find((version) => version.buildId === 'build-external')
  assert(versionA && versionB && externalVersion, 'Managed and external fixtures must be registered.')

  const activatedB = await activateVersion(versionB.id)
  assert.equal(path.resolve(activatedB.managerRoot!), path.resolve(managerB))
  assert.equal(path.resolve(activatedB.config!.FreezeRoot), path.resolve(configB.FreezeRoot))
  assert.equal(await fs.readFile(pointerA, 'utf8'), originalA, 'Activating manager B must not rewrite manager A.')
  assert.equal(existsSync(`${pointerA}.launcher-backup`), false, 'Manager A must not receive a cross-library backup.')
  const savedAfterB = JSON.parse(await fs.readFile(path.join(userData, 'launcher-settings.json'), 'utf8')) as { managerRoot: string; activeVersionRoot: string }
  assert.equal(path.resolve(savedAfterB.managerRoot), path.resolve(managerB))
  assert.equal(path.resolve(savedAfterB.activeVersionRoot), path.resolve(configB.FreezeRoot))
  const pointerBAfterActivation = await fs.readFile(pointerB, 'utf8')
  assert.equal(path.resolve((JSON.parse(pointerBAfterActivation) as FreezeConfig).FreezeRoot), path.resolve(configB.FreezeRoot))

  const activatedA = await activateVersion(versionA.id)
  assert.equal(path.resolve(activatedA.managerRoot!), path.resolve(managerA))
  assert.equal(path.resolve(activatedA.config!.FreezeRoot), path.resolve(configA.FreezeRoot))
  assert.equal(await fs.readFile(pointerB, 'utf8'), pointerBAfterActivation, 'Switching back must not rewrite manager B.')
  assert.equal(path.resolve((JSON.parse(await fs.readFile(pointerA, 'utf8')) as FreezeConfig).FreezeRoot), path.resolve(configA.FreezeRoot))

  const metadataA = path.join(configA.FreezeRoot, 'metadata', 'freeze.json')
  const metadataTime = (await fs.stat(metadataA)).mtimeMs
  await new Promise((resolve) => setTimeout(resolve, 25))
  await activateVersion(versionA.id)
  assert.equal((await fs.stat(metadataA)).mtimeMs, metadataTime, 'Repeated activation must not rewrite unchanged metadata.')

  const externalBefore = await fs.readFile(externalMetadata, 'utf8')
  const externalTime = (await fs.stat(externalMetadata)).mtimeMs
  const pointerABeforeExternal = await fs.readFile(pointerA, 'utf8')
  await new Promise((resolve) => setTimeout(resolve, 25))
  const activatedExternal = await activateVersion(externalVersion.id)
  assert.equal(path.resolve(activatedExternal.config!.FreezeRoot), path.resolve(externalRoot))
  assert.equal(path.resolve(activatedExternal.managerRoot!), path.resolve(managerA), 'External activation must preserve the selected manager library.')
  assert.equal(activatedExternal.enginePath, null, 'External activation must not reuse a managed library PowerShell engine.')
  assert.equal(await fs.readFile(externalMetadata, 'utf8'), externalBefore, 'External activation must not rewrite external metadata.')
  assert.equal((await fs.stat(externalMetadata)).mtimeMs, externalTime, 'External metadata mtime must remain unchanged.')
  assert.equal(await fs.readFile(pointerA, 'utf8'), pointerABeforeExternal, 'External activation must not rewrite the manager pointer.')
  await activateVersion(versionA.id)

  const snapshot = await getSnapshot()
  assert.equal(path.resolve(snapshot.managerRoot!), path.resolve(managerA))
  assert.equal(path.resolve(snapshot.config!.FreezeRoot), path.resolve(configA.FreezeRoot))

  console.log(`VERSION_ACTIVATION_E2E=${JSON.stringify({
    managerA,
    managerB,
    activeManager: snapshot.managerRoot,
    activeVersion: snapshot.config?.FreezeRoot,
    crossLibraryPointerPreserved: true,
    idempotentMetadataWrite: true,
    externalMetadataPreserved: true
  })}`)
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`VERSION_ACTIVATION_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
