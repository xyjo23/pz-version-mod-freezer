import assert from 'node:assert/strict'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { executeMigration, previewMigration } from '../src/main/migration-service'
import { activateVersion, getSnapshot, listVersions, runAction } from '../src/main/vault-service'
import type { FreezeConfig, MigrationRequest } from '../src/shared/types'
import { holdExclusiveFileLock } from './file-lock'

const testRoot = process.env.PZ_MIGRATION_E2E_ROOT
if (!testRoot) throw new Error('PZ_MIGRATION_E2E_ROOT is required.')
if (existsSync(testRoot)) throw new Error(`Refusing to reuse an existing migration test root: ${testRoot}`)

const write = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

const main = async (): Promise<void> => {
  const baseRoot = path.join(testRoot, 'frozen', 'round2-base')
  const baseGame = path.join(baseRoot, 'game')
  const baseCache = path.join(baseRoot, 'cache')
  const userData = path.join(testRoot, '.launcher-user-data')
  await write(path.join(baseGame, 'media', 'base.txt'), 'immutable game fixture')
  await write(path.join(baseCache, 'version.txt'), '42.22.2')
  await write(path.join(baseCache, 'options.ini'), 'fullscreen=true')
  await write(path.join(baseCache, 'Saves', 'Sandbox', 'Round2', 'mods.txt'), 'mod = Mod.A,')
  await write(path.join(baseCache, 'mods', 'A', 'mod.info'), 'name=A\nid=Mod.A\nrequire=Mod.B')
  await write(path.join(baseCache, 'mods', 'A', 'media', 'a.lua'), 'return "a"')
  await write(path.join(baseCache, 'mods', 'B', 'mod.info'), 'name=B\nid=Mod.B')
  await write(path.join(baseCache, 'mods', 'B', 'media', 'b.lua'), 'return "b"')

  const baseConfig: FreezeConfig = {
    ManagerRoot: testRoot,
    FreezeRoot: baseRoot,
    GamePath: baseGame,
    CachePath: baseCache,
    ManifestPath: path.join(baseRoot, 'manifests'),
    ReportPath: path.join(baseRoot, 'reports'),
    BackupPath: path.join(baseRoot, 'backups'),
    Version: '42.22.2',
    BuildID: 'fixture-26486631',
    DisplayName: 'Round 2 fixture base',
    Created: new Date().toISOString(),
    StorageMode: 'FullCopy',
    ShareInstallStatus: 'Verified',
    SharePackageID: '00000000-0000-4000-8000-000000000099',
    SharePackageDigest: 'A'.repeat(64),
    LaunchArguments: ['-nosteam', '-cachedir=E:\\obsolete-cache']
  }
  await write(path.join(baseRoot, 'metadata', 'freeze.json'), JSON.stringify(baseConfig, null, 2))
  await write(path.join(userData, 'launcher-settings.json'), JSON.stringify({ managerRoot: testRoot, activeSource: 'Frozen', activeVersionRoot: baseRoot }, null, 2))

  app.setPath('userData', userData)
  await app.whenReady()

  const baseVersion = (await listVersions()).find((version) => path.resolve(version.freezeRoot) === path.resolve(baseRoot))
  assert(baseVersion, 'Fixture base was not registered.')
  process.env.PZ_MIGRATION_TEST_AVAILABLE_BYTES = '1'
  const diskFullRequest: MigrationRequest = { sourceType: 'Frozen', sourceId: baseVersion.id, mode: 'SafeCopy', label: 'Round6 Disk Full', protectSaves: false }
  const diskFullPreview = await previewMigration(diskFullRequest)
  delete process.env.PZ_MIGRATION_TEST_AVAILABLE_BYTES
  assert.equal(diskFullPreview.canRun, false)
  assert.equal(diskFullPreview.space?.sufficient, false)
  assert(diskFullPreview.warnings.some((warning) => warning.includes('空间不足')))
  assert(diskFullPreview.targetPath && !existsSync(diskFullPreview.targetPath))

  const lockedRequest: MigrationRequest = { sourceType: 'Frozen', sourceId: baseVersion.id, mode: 'SafeCopy', label: 'Round5 Locked Source', protectSaves: false }
  const lockedPreview = await previewMigration(lockedRequest)
  assert.equal(lockedPreview.canRun, true, lockedPreview.warnings.join(' | '))
  const exclusiveLock = await holdExclusiveFileLock(path.join(baseGame, 'media', 'base.txt'))
  let lockedSourceBlocked = false
  try {
    const lockedResult = await executeMigration(lockedRequest)
    assert.equal(lockedResult.ok, false)
    assert.match(lockedResult.output, /Robocopy failed|未完成数据已移入诊断目录/)
    assert(lockedPreview.targetPath && !existsSync(lockedPreview.targetPath), 'Failed migration exposed a partial final version.')
    assert((await fs.readdir(path.join(testRoot, 'incomplete'))).length > 0, 'Failed migration did not preserve its partial data for diagnosis.')
    lockedSourceBlocked = true
  } finally {
    await exclusiveLock.release()
  }
  const safeRequest: MigrationRequest = { sourceType: 'Frozen', sourceId: baseVersion.id, mode: 'SafeCopy', label: 'Round2 Full', protectSaves: true }
  const safePreview = await previewMigration(safeRequest)
  assert.equal(safePreview.canRun, true, safePreview.warnings.join(' | '))
  const interruptedStage = path.join(testRoot, '.staging', `${path.basename(safePreview.targetPath!)}.pzvault-stage`)
  await write(path.join(interruptedStage, '.pzvault-migration.json'), JSON.stringify({ schemaVersion: 1, phase: 'ready', targetRoot: safePreview.targetPath }))
  await write(path.join(interruptedStage, 'partial.txt'), 'simulated interrupted process')
  const safeResult = await executeMigration(safeRequest)
  assert.equal(safeResult.ok, true, safeResult.output)
  assert.match(safeResult.output, /上次中断的暂存数据移入诊断目录/)
  const duplicatePreview = await previewMigration(safeRequest)
  assert.equal(duplicatePreview.canRun, false)
  assert(duplicatePreview.warnings.some((warning) => warning.includes('已经存在')))
  const fullSnapshot = await getSnapshot()
  assert.equal(fullSnapshot.config?.StorageMode, 'FullCopy')
  assert.equal(fullSnapshot.config?.ShareInstallStatus, undefined)
  assert.equal(fullSnapshot.config?.SharePackageID, undefined)
  assert.equal(fullSnapshot.config?.SharePackageDigest, undefined)
  assert.equal(path.resolve(fullSnapshot.config!.FreezeRoot), path.resolve(safePreview.targetPath!))
  assert(!fullSnapshot.config!.FreezeRoot.includes(`${path.sep}.staging${path.sep}`))
  assert(!fullSnapshot.config?.LaunchArguments?.some((argument) => argument.toLowerCase() === '-nosteam'))
  assert(fullSnapshot.config?.LaunchArguments?.some((argument) => argument === `-cachedir=${fullSnapshot.config?.CachePath}`))
  await fs.writeFile(path.join(fullSnapshot.config!.CachePath, 'options.ini'), 'fullscreen=false', 'utf8')
  assert.equal(await fs.readFile(path.join(baseCache, 'options.ini'), 'utf8'), 'fullscreen=true')

  const fullVersion = (await listVersions()).find((version) => path.resolve(version.freezeRoot) === path.resolve(fullSnapshot.config!.FreezeRoot))
  assert(fullVersion, 'Full-copy fixture was not registered.')
  await activateVersion(fullVersion.id)
  const fastRequest: MigrationRequest = { sourceType: 'Frozen', sourceId: fullVersion.id, mode: 'FastLink', label: 'Round2 Thin', protectSaves: false }
  const fastPreview = await previewMigration(fastRequest)
  assert.equal(fastPreview.canRun, true, fastPreview.warnings.join(' | '))
  assert.equal(fastPreview.analysis?.referencedModRoots, 2)
  const fastResult = await executeMigration(fastRequest)
  assert.equal(fastResult.ok, true, fastResult.output)
  const thinSnapshot = await getSnapshot()
  assert.equal(thinSnapshot.config?.StorageMode, 'ThinReference')
  assert.equal(thinSnapshot.config?.BaseFreezeRoot, fullSnapshot.config?.FreezeRoot)
  assert(thinSnapshot.config?.ReferencedMods?.every((mod) => mod.targetPath.startsWith(thinSnapshot.config!.CachePath)))
  assert(!thinSnapshot.config?.LaunchArguments?.some((argument) => argument.toLowerCase() === '-nosteam'))
  assert(thinSnapshot.config?.LaunchArguments?.some((argument) => argument === `-cachedir=${thinSnapshot.config?.CachePath}`))
  const verify = await runAction('Verify')
  assert.equal(verify.ok, true, verify.output)
  const thinVersion = (await listVersions()).find((version) => path.resolve(version.freezeRoot) === path.resolve(thinSnapshot.config!.FreezeRoot))
  assert(thinVersion, 'Thin fixture was not registered.')
  const chainedPreview = await previewMigration({ sourceType: 'Frozen', sourceId: thinVersion.id, mode: 'FastLink', label: 'Invalid chain', protectSaves: false })
  assert.equal(chainedPreview.canRun, false)
  assert(chainedPreview.warnings.some((warning) => warning.includes('薄版本')))

  const reference = thinSnapshot.config?.ReferencedMods?.[0]
  assert(reference, 'Thin fixture did not contain a MOD reference.')
  const offlinePath = `${reference.targetPath}.round2-offline`
  await fs.rename(reference.targetPath, offlinePath)
  let missingReferenceDetected = false
  try {
    await runAction('Verify')
    assert.fail('Missing MOD reference was not detected.')
  } catch (error) {
    assert.match(error instanceof Error ? error.message : String(error), /薄版本 MOD 引用不存在/)
    missingReferenceDetected = true
  } finally {
    await fs.rename(offlinePath, reference.targetPath)
  }
  const restoredVerify = await runAction('Verify')
  assert.equal(restoredVerify.ok, true, restoredVerify.output)

  console.log(`MIGRATION_E2E=${JSON.stringify({
    root: testRoot,
    fullRoot: fullSnapshot.config?.FreezeRoot,
    thinRoot: thinSnapshot.config?.FreezeRoot,
    fullLaunchArguments: fullSnapshot.config?.LaunchArguments,
    thinLaunchArguments: thinSnapshot.config?.LaunchArguments,
    referencedMods: thinSnapshot.config?.ReferencedMods?.length,
    duplicateTargetBlocked: true,
    diskFullPreflightBlocked: true,
    lockedSourceBlocked,
    interruptedStageRecovered: true,
    thinChainBlocked: true,
    missingReferenceDetected,
    verify: restoredVerify.message
  })}`)
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`MIGRATION_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
