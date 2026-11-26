import assert from 'node:assert/strict'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { readGameIdentity } from '../src/main/game-identity'
import {
  applyModProfile,
  compareModProfile,
  createModProfile,
  exportModProfileAt,
  importModProfileAt,
  listModProfiles,
  undoModProfile
} from '../src/main/mod-profile-service'
import type { FreezeConfig, ModProfile } from '../src/shared/types'

const testRoot = process.env.PZ_PROFILE_E2E_ROOT
const sourceJar = process.env.PZ_PROFILE_E2E_JAR
if (!testRoot || !sourceJar) throw new Error('PZ_PROFILE_E2E_ROOT and PZ_PROFILE_E2E_JAR are required.')
if (existsSync(testRoot)) throw new Error(`Refusing to reuse an existing profile fixture root: ${testRoot}`)
if (!existsSync(sourceJar)) throw new Error(`Real game JAR is missing: ${sourceJar}`)

const write = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

const saveText = (ids: string[], suffix = ''): string => `VERSION = 1,\n\nmods\n{\n${ids.map((id) => `    mod = ${id},`).join('\n')}\n}\n\nmaps\n{\n}\n${suffix}`

const main = async (): Promise<void> => {
  const userData = path.join(testRoot, '.launcher-user-data')
  const freezeRoot = path.join(testRoot, 'frozen', 'profile-fixture')
  const gamePath = path.join(freezeRoot, 'game')
  const cachePath = path.join(freezeRoot, 'cache')
  const savePath = path.join(cachePath, 'Saves', 'Sandbox', 'ProfileFixture', 'mods.txt')
  await fs.mkdir(gamePath, { recursive: true })
  await fs.copyFile(sourceJar, path.join(gamePath, 'projectzomboid.jar'))
  await write(path.join(cachePath, 'version.txt'), '42.21.0 4a0e9546ec\nrevision=4a0e9546ec pzbullet=1.0.0.28\n')
  await write(path.join(cachePath, 'mods', 'A', 'mod.info'), 'name=A\nid=Profile.A')
  await write(path.join(cachePath, 'mods', 'A', 'media', 'lua', 'a.lua'), 'return "a"')
  await write(path.join(cachePath, 'mods', 'B', 'mod.info'), 'name=B\nid=Profile.B\nrequire=Profile.A')
  await write(path.join(cachePath, 'mods', 'B', 'media', 'lua', 'b.lua'), 'return "b"')
  await write(savePath, saveText(['Profile.A', 'Profile.B']))
  const identity = await readGameIdentity(gamePath, 'profile-build', cachePath)
  assert(identity.jarSha256, 'Fixture game JAR identity must be available.')
  const config: FreezeConfig = {
    ManagerRoot: testRoot,
    FreezeRoot: freezeRoot,
    GamePath: gamePath,
    CachePath: cachePath,
    ManifestPath: path.join(freezeRoot, 'manifests'),
    ReportPath: path.join(freezeRoot, 'reports'),
    BackupPath: path.join(freezeRoot, 'backups'),
    Version: identity.version,
    BuildID: identity.buildId,
    Revision: identity.revision ?? undefined,
    GameJarSHA256: identity.jarSha256,
    IdentityStatus: identity.status,
    DisplayName: 'Profile fixture',
    StorageMode: 'FullCopy'
  }
  await write(path.join(freezeRoot, 'metadata', 'freeze.json'), JSON.stringify(config, null, 2))
  await write(path.join(testRoot, 'current-freeze.json'), JSON.stringify(config, null, 2))
  await write(path.join(userData, 'launcher-settings.json'), JSON.stringify({ managerRoot: testRoot, activeSource: 'Frozen', activeVersionRoot: freezeRoot }, null, 2))
  await write(path.join(userData, 'version-registry.json'), JSON.stringify({
    schemaVersion: 1,
    managerRoots: [testRoot],
    versions: [{ id: 'profile-fixture', freezeRoot, origin: 'Managed', managerRoot: testRoot, registeredAt: new Date().toISOString() }]
  }, null, 2))
  app.setPath('userData', userData)
  await app.whenReady()

  const profile = await createModProfile('Fixture profile', savePath)
  assert.deepEqual(profile.loadout.modIds, ['Profile.A', 'Profile.B'])
  assert.equal(profile.binding.kind, 'save')
  assert.equal(profile.game.jarSha256, identity.jarSha256)
  assert.equal((await listModProfiles()).profiles.length, 1)

  const exportPath = path.join(testRoot, 'transport', 'fixture.pzprofile')
  const exported = await exportModProfileAt(profile.id, exportPath)
  assert.equal(exported.profile?.binding.sourcePath, null)
  const imported = await importModProfileAt(exportPath)
  assert(imported.profile && imported.profile.id !== profile.id, 'Duplicate import must receive a new ID.')
  assert.equal((await listModProfiles()).profiles.length, 2)
  const tampered = JSON.parse(await fs.readFile(exportPath, 'utf8')) as ModProfile
  tampered.name = 'Tampered'
  const tamperedPath = path.join(testRoot, 'transport', 'tampered.pzprofile')
  await write(tamperedPath, JSON.stringify(tampered, null, 2))
  await assert.rejects(importModProfileAt(tamperedPath), /摘要校验失败/)

  const changedBeforeApply = saveText(['Profile.B'], '# user change before apply\n')
  await write(savePath, changedBeforeApply)
  const preview = await compareModProfile(profile.id, savePath)
  assert.equal(preview.status, 'different')
  assert.equal(preview.canApply, true)
  assert.deepEqual(preview.differences.enableModIds, ['Profile.A'])
  assert(preview.previewToken)
  const applied = await applyModProfile(profile.id, preview.previewToken!, savePath)
  assert.equal(applied.ok, true)
  assert(applied.operationId && applied.backupPath)
  const appliedRaw = await fs.readFile(savePath, 'utf8')
  assert.match(appliedRaw, /mod = Profile\.A,[\s\S]*mod = Profile\.B,/)
  assert.match(appliedRaw, /# user change before apply/)

  const undone = await undoModProfile()
  assert.equal(undone.ok, true)
  assert.equal(await fs.readFile(savePath, 'utf8'), changedBeforeApply)

  const stalePreview = await compareModProfile(profile.id, savePath)
  await fs.appendFile(savePath, '# changed after preview\n', 'utf8')
  await assert.rejects(applyModProfile(profile.id, stalePreview.previewToken!, savePath), /预览后发生变化/)

  await write(savePath, saveText(['Profile.B'], '# receipt tamper fixture\n'))
  const receiptPreview = await compareModProfile(profile.id, savePath)
  const receiptApplied = await applyModProfile(profile.id, receiptPreview.previewToken!, savePath)
  assert(receiptApplied.operationId)
  const receiptPath = path.join(userData, 'mod-profile-operations', receiptApplied.operationId, 'receipt.json')
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')) as { backupPath: string }
  receipt.backupPath = sourceJar
  await write(receiptPath, JSON.stringify(receipt, null, 2))
  const unsafeUndo = await undoModProfile()
  assert.equal(unsafeUndo.ok, false, 'A receipt pointing outside its operation directory must be ignored.')

  console.log(`MOD_PROFILE_E2E=${JSON.stringify({
    root: testRoot,
    profileId: profile.id,
    mods: profile.loadout.modIds.length,
    exportedPathRedacted: exported.profile?.binding.sourcePath === null,
    duplicateImportedAsCopy: imported.profile.id !== profile.id,
    tamperBlocked: true,
    previewApplyUndo: true,
    stalePreviewBlocked: true,
    unsafeReceiptIgnored: true
  })}`)
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`MOD_PROFILE_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
