import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { readGameIdentity } from '../src/main/game-identity'
import { createShareEnvelope, parseSharePackage, serializeSharePackage } from '../src/main/share-package-format'
import { createSharePackageAt, inspectSharePackageAt, installSharePackageAt } from '../src/main/share-package-service'
import { listVersions } from '../src/main/vault-service'
import type { FreezeConfig } from '../src/shared/types'

const testRoot = process.env.PZ_SHARE_E2E_ROOT
const sourceJar = process.env.PZ_SHARE_E2E_JAR
if (!testRoot || !sourceJar) throw new Error('PZ_SHARE_E2E_ROOT and PZ_SHARE_E2E_JAR are required.')
if (existsSync(testRoot)) throw new Error(`Refusing to reuse an existing share-package fixture root: ${testRoot}`)
if (!existsSync(sourceJar)) throw new Error(`Real game JAR is missing: ${sourceJar}`)

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

const createBase = async (managerRoot: string, directoryName: string, displayName: string): Promise<{ root: string; modFile: string; config: FreezeConfig }> => {
  const root = path.join(managerRoot, 'frozen', directoryName)
  const gamePath = path.join(root, 'game')
  const cachePath = path.join(root, 'cache')
  const modRoot = path.join(cachePath, 'mods', 'Round4Reference')
  const modFile = path.join(modRoot, 'media', 'lua', 'shared', 'round4.lua')
  await fs.mkdir(gamePath, { recursive: true })
  await fs.copyFile(sourceJar, path.join(gamePath, 'projectzomboid.jar'))
  const binaryIdentity = await readGameIdentity(gamePath, '25485521', null)
  assert.notEqual(binaryIdentity.version, 'unknown', 'The real game JAR did not yield a binary version.')
  await write(path.join(cachePath, 'version.txt'), binaryIdentity.version)
  await write(path.join(modRoot, 'mod.info'), 'name=Round 4 Reference\nid=Round4.Mod\n')
  await write(modFile, 'return "round4-reference"\n')
  await write(path.join(cachePath, 'Saves', 'Sandbox', 'Round4Share', 'mods.txt'), 'VERSION = 1,\nmods\n{\n    mod = Round4.Mod,\n}\n')
  const identity = await readGameIdentity(gamePath, '25485521', cachePath)
  assert(['verified', 'binary-only'].includes(identity.status), `Unexpected fixture identity status: ${identity.status}`)
  const config: FreezeConfig = {
    ManagerRoot: managerRoot,
    FreezeRoot: root,
    GamePath: gamePath,
    CachePath: cachePath,
    ManifestPath: path.join(root, 'manifests'),
    ReportPath: path.join(root, 'reports'),
    BackupPath: path.join(root, 'backups'),
    Version: identity.version,
    FullVersion: [identity.version, identity.revision].filter(Boolean).join(' '),
    BuildID: identity.buildId,
    Revision: identity.revision ?? undefined,
    GameJarSHA256: identity.jarSha256 ?? undefined,
    IdentityStatus: identity.status,
    DisplayName: displayName,
    Created: new Date().toISOString(),
    StorageMode: 'FullCopy'
  }
  await write(path.join(root, 'metadata', 'freeze.json'), `${JSON.stringify(config, null, 2)}\n`)
  await writeManifest(gamePath, path.join(root, 'manifests', 'game.sha256.csv'))
  await writeManifest(path.join(cachePath, 'mods'), path.join(root, 'manifests', 'mods.sha256.csv'))
  return { root, modFile, config }
}

const setActive = async (userData: string, managerRoot: string, activeVersionRoot: string): Promise<void> => {
  await write(path.join(userData, 'launcher-settings.json'), `${JSON.stringify({ managerRoot, activeSource: 'Frozen', activeVersionRoot }, null, 2)}\n`)
}

const main = async (): Promise<void> => {
  const senderManager = path.join(testRoot, 'sender-library')
  const receiverManager = path.join(testRoot, 'receiver-library')
  const transport = path.join(testRoot, 'transport')
  const userData = path.join(testRoot, '.launcher-user-data')
  const sender = await createBase(senderManager, 'sender-base', 'Round 4 Sender')
  const receiver = await createBase(receiverManager, 'receiver-base', 'Round 4 Receiver')
  await setActive(userData, senderManager, sender.root)
  app.setPath('userData', userData)
  await app.whenReady()

  const packagePath = path.join(transport, 'round4-reference.pzshare')
  const created = await createSharePackageAt(packagePath)
  assert.equal(created.ok, true, created.message)
  const raw = await fs.readFile(packagePath, 'utf8')
  const lowerRaw = raw.toLowerCase()
  assert(!lowerRaw.includes(senderManager.toLowerCase()), 'Package leaked the sender manager path.')
  assert(!lowerRaw.includes(sender.root.toLowerCase()), 'Package leaked the sender version path.')
  assert(!raw.includes('round4-reference"\n'), 'Package embedded MOD file contents.')
  assert(!raw.includes('projectzomboid.jar"'), 'Package embedded a game file name as payload.')
  const transported = parseSharePackage(raw)
  assert.equal(transported.manifest.rights.embeddedFiles, 0)
  assert.equal(transported.manifest.rights.policy, 'reference-only-v1')

  await setActive(userData, receiverManager, receiver.root)
  const receiverInspection = await inspectSharePackageAt(packagePath)
  assert.equal(receiverInspection.valid, true, receiverInspection.message)
  assert.equal(receiverInspection.canInstall, true, receiverInspection.findings.map((finding) => `${finding.title}: ${finding.detail}`).join('\n'))

  const tamperedPath = path.join(transport, 'tampered.pzshare')
  const tampered = JSON.parse(raw) as { manifest: { title: string } }
  tampered.manifest.title = '被修改的标题'
  await write(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`)
  const tamperedInspection = await inspectSharePackageAt(tamperedPath)
  assert.equal(tamperedInspection.valid, false)
  assert(tamperedInspection.findings.some((finding) => finding.detail.includes('摘要不匹配')))

  const offlineRoot = path.join(receiver.config.CachePath, 'mods', 'Round4Reference')
  const offlineRenamed = path.join(receiver.config.CachePath, 'Round4Reference.offline')
  await fs.rename(offlineRoot, offlineRenamed)
  const missingInspection = await inspectSharePackageAt(packagePath)
  assert.equal(missingInspection.canInstall, false)
  assert(missingInspection.findings.some((finding) => finding.title.includes('缺少 1 个共享清单 MOD')))
  await fs.rename(offlineRenamed, offlineRoot)

  const originalModContents = await fs.readFile(receiver.modFile, 'utf8')
  await fs.writeFile(receiver.modFile, 'return "receiver-drift"\n', 'utf8')
  const driftInspection = await inspectSharePackageAt(packagePath)
  assert.equal(driftInspection.canInstall, false)
  assert(driftInspection.findings.some((finding) => finding.title.includes('版本漂移')))
  await fs.writeFile(receiver.modFile, originalModContents, 'utf8')

  const receiverJar = path.join(receiver.config.GamePath, 'projectzomboid.jar')
  const offlineJar = `${receiverJar}.offline`
  await fs.rename(receiverJar, offlineJar)
  const weakIdentityInspection = await inspectSharePackageAt(packagePath)
  assert.equal(weakIdentityInspection.canInstall, false)
  assert(weakIdentityInspection.findings.some((finding) => finding.title.includes('游戏身份') || finding.title.includes('完整性')))
  await fs.rename(offlineJar, receiverJar)

  const readyAgain = await inspectSharePackageAt(packagePath)
  assert.equal(readyAgain.canInstall, true, readyAgain.findings.map((finding) => finding.title).join('、'))
  const installed = await installSharePackageAt(packagePath)
  assert.equal(installed.ok, true, installed.output)
  assert(installed.installedRoot)
  const installedConfig = JSON.parse(await fs.readFile(path.join(installed.installedRoot, 'metadata', 'freeze.json'), 'utf8')) as FreezeConfig
  const installedReceipt = JSON.parse(await fs.readFile(path.join(installed.installedRoot, 'metadata', 'share-install.json'), 'utf8')) as { status: string; packageId: string }
  assert.equal(installedConfig.ShareInstallStatus, 'Verified')
  assert.equal(installedConfig.SharePackageID, created.packageId)
  assert.equal(installedReceipt.status, 'Verified')
  assert.equal(installedReceipt.packageId, created.packageId)
  assert(existsSync(path.join(installed.installedRoot, 'metadata', 'shared-loadout.json')))
  const installedVersion = (await listVersions()).find((version) => path.resolve(version.freezeRoot) === path.resolve(installed.installedRoot!))
  assert.equal(installedVersion?.shareInstallStatus, 'Verified')
  assert.equal(installedVersion?.isHealthy, true)

  const repeated = await inspectSharePackageAt(packagePath)
  assert.equal(repeated.canInstall, false)
  assert(repeated.findings.some((finding) => finding.title === '这个共享包已经安装'))

  const quarantineEnvelope = createShareEnvelope({
    ...transported.manifest,
    packageId: randomUUID(),
    createdAt: new Date().toISOString(),
    title: 'Round 4 Quarantine Probe'
  })
  const quarantinePath = path.join(transport, 'round4-quarantine-probe.pzshare')
  await write(quarantinePath, serializeSharePackage(quarantineEnvelope))
  const quarantined = await installSharePackageAt(quarantinePath, {
    afterMigration: async (installedRoot) => {
      await fs.writeFile(path.join(installedRoot, 'cache', 'mods', 'Round4Reference', 'media', 'lua', 'shared', 'round4.lua'), 'return "tampered-after-copy"\n', 'utf8')
    }
  })
  assert.equal(quarantined.ok, false)
  assert(quarantined.installedRoot)
  const quarantineConfig = JSON.parse(await fs.readFile(path.join(quarantined.installedRoot, 'metadata', 'freeze.json'), 'utf8')) as FreezeConfig
  const quarantineReceipt = JSON.parse(await fs.readFile(path.join(quarantined.installedRoot, 'metadata', 'share-install.json'), 'utf8')) as { status: string; blockers: unknown[] }
  assert.equal(quarantineConfig.ShareInstallStatus, 'Quarantined')
  assert.equal(quarantineReceipt.status, 'Quarantined')
  assert(quarantineReceipt.blockers.length > 0)
  const quarantinedVersion = (await listVersions()).find((version) => path.resolve(version.freezeRoot) === path.resolve(quarantined.installedRoot!))
  assert.equal(quarantinedVersion?.isHealthy, false)

  console.log(`SHARE_PACKAGE_E2E=${JSON.stringify({
    root: testRoot,
    packagePath,
    packageId: created.packageId,
    digest: created.digest,
    modCount: transported.manifest.mods.length,
    zeroEmbeddedFiles: transported.manifest.rights.embeddedFiles,
    receiverMatched: receiverInspection.canInstall,
    tamperBlocked: !tamperedInspection.valid,
    missingModBlocked: !missingInspection.canInstall,
    driftBlocked: !driftInspection.canInstall,
    weakIdentityBlocked: !weakIdentityInspection.canInstall,
    installedStatus: installedConfig.ShareInstallStatus,
    repeatedInstallBlocked: !repeated.canInstall,
    quarantineStatus: quarantineConfig.ShareInstallStatus,
    quarantineBlockers: quarantineReceipt.blockers.length
  })}`)
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`SHARE_PACKAGE_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
