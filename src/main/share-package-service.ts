import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { app, dialog } from 'electron'

import type {
  CompatibilityModRecord,
  SharePackageCreateResult,
  SharePackageEnvelopeV1,
  SharePackageFinding,
  SharePackageInspection,
  SharePackageInstallResult,
  SharePackageManifestV1,
  SharePackageMod
} from '../shared/types'
import { analyzeCompatibility } from './compatibility-service'
import { analyzeIntegrity } from './integrity-service'
import { executeMigration } from './migration-service'
import { fingerprintDirectory, type DirectoryFingerprint } from './share-package-fingerprint'
import { createShareEnvelope, parseSharePackage, serializeSharePackage, SHARE_PACKAGE_MAX_BYTES } from './share-package-format'
import { evaluateReconstruction, isTrustedShareIdentity, type LocalShareModEvidence } from './share-package-match'
import { activateSteam, activateVersion, getSnapshot, listVersions } from './vault-service'

const safeFileName = (value: string): string => (
  value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'PZ-共享清单'
)

const loadEnvelope = async (filePath: string): Promise<SharePackageEnvelopeV1> => {
  const stats = await fs.stat(filePath)
  if (!stats.isFile() || stats.size <= 0 || stats.size > SHARE_PACKAGE_MAX_BYTES) throw new Error('共享包为空或超过 8 MiB 的 v1 上限。')
  return parseSharePackage(await fs.readFile(filePath))
}

const alreadyInstalledFinding = async (envelope: SharePackageEnvelopeV1): Promise<SharePackageFinding | null> => {
  for (const version of await listVersions()) {
    try {
      const config = JSON.parse(await fs.readFile(path.join(version.freezeRoot, 'metadata', 'freeze.json'), 'utf8')) as {
        ShareInstallStatus?: string
        SharePackageID?: string
        SharePackageDigest?: string
      }
      if (config.ShareInstallStatus !== 'Verified' || config.SharePackageID !== envelope.manifest.packageId) continue
      return {
        severity: 'blocker',
        title: '这个共享包已经安装',
        detail: config.SharePackageDigest === envelope.integrity.digest
          ? `受管版本“${version.name}”已经通过同一 Package ID 和摘要的安装复核，不会重复复制。`
          : `受管版本“${version.name}”使用了相同 Package ID，但摘要不同；请让制作者重新生成具有新 Package ID 的共享包。`
      }
    } catch {
      // Damaged registrations are reported by normal version/integrity checks and are not proof of a completed install.
    }
  }
  return null
}

const toShareMod = async (record: CompatibilityModRecord, fingerprints: Map<string, Promise<DirectoryFingerprint>>): Promise<SharePackageMod> => {
  const normalizedRoot = path.resolve(record.rootPath).toLowerCase()
  let fingerprint = fingerprints.get(normalizedRoot)
  if (!fingerprint) {
    fingerprint = fingerprintDirectory(record.rootPath)
    fingerprints.set(normalizedRoot, fingerprint)
  }
  const content = await fingerprint
  return {
    name: record.name,
    modId: record.modId!,
    workshopId: record.workshopId,
    source: record.source,
    selectedVersion: record.selectedVersion,
    variants: record.variants,
    require: record.require,
    incompatible: record.incompatible,
    loadAfter: record.loadAfter,
    loadBefore: record.loadBefore,
    contentFingerprint: content.digest,
    files: content.files,
    bytes: content.bytes,
    delivery: record.source === 'Workshop' ? 'steam-workshop-reference' : 'local-reference',
    embedded: false
  }
}

const buildSharePackage = async (): Promise<{ envelope: SharePackageEnvelopeV1; modCount: number; title: string }> => {
  const integrity = await analyzeIntegrity({ submitSteamValidation: false })
  if (integrity.verdict === 'blocker') throw new Error(`完整性分析存在阻断项：${integrity.plainSummary}`)
  const compatibility = await analyzeCompatibility()
  if (compatibility.verdict === 'blocker') throw new Error(`兼容性分析存在阻断项：${compatibility.plainSummary}`)
  if (!isTrustedShareIdentity(compatibility.identity)) throw new Error('游戏二进制身份、Build ID 或 projectzomboid.jar SHA-256 不完整，不能制作“精确可重建”的共享清单。')
  const context = compatibility.analysisContext
  if (!context) throw new Error('没有唯一的存档或服务器启用上下文，无法制作可复现的共享清单。')
  if (context.missingModIds.length || context.missingWorkshopIds.length) throw new Error('启用上下文仍引用缺失内容，不能制作共享清单。')

  const activeRecords = context.modIds.map((modId) => {
    const matches = compatibility.mods.filter((mod) => mod.modId === modId)
    if (matches.length !== 1) throw new Error(`Mod ID “${modId}”对应 ${matches.length} 个内容根，无法唯一复现。`)
    return matches[0]
  })
  const fingerprints = new Map<string, Promise<DirectoryFingerprint>>()
  const mods = await Promise.all(activeRecords.map((record) => toShareMod(record, fingerprints)))
  const snapshot = await getSnapshot()
  const title = safeFileName(compatibility.sourceLabel)
  const warnings = [
    ...integrity.findings.filter((finding) => finding.severity === 'warning' || finding.severity === 'unknown').map((finding) => finding.title),
    ...compatibility.issues.filter((issue) => issue.appliesToScope && (issue.severity === 'warning' || issue.severity === 'unknown')).map((issue) => issue.title)
  ]
  const manifest: SharePackageManifestV1 = {
    packageId: randomUUID(),
    createdAt: new Date().toISOString(),
    producer: { name: 'Project Zomboid Vault', version: app.getVersion() },
    title,
    source: compatibility.source,
    game: {
      appId: '108600',
      version: compatibility.identity.version,
      fullVersion: [compatibility.identity.version, compatibility.identity.revision].filter(Boolean).join(' '),
      buildId: compatibility.identity.buildId,
      revision: compatibility.identity.revision,
      jarSha256: compatibility.identity.jarSha256,
      identityStatus: compatibility.identity.status
    },
    loadout: {
      contextKind: context.kind,
      contextName: context.kind === 'save' ? '共享存档配置' : '共享服务器配置',
      modIds: [...context.modIds],
      workshopIds: [...new Set([...context.workshopIds, ...mods.flatMap((mod) => mod.workshopId ? [mod.workshopId] : [])])]
    },
    mods,
    analysis: {
      integrityVerdict: integrity.verdict,
      compatibilityVerdict: compatibility.verdict,
      integritySummary: integrity.plainSummary,
      compatibilitySummary: `兼容性规则结果：阻断 ${compatibility.summary.blockers}，警告 ${compatibility.summary.warnings}，待验证 ${compatibility.summary.unknowns}，通过 ${compatibility.summary.passes}。`,
      warnings
    },
    rights: {
      policy: 'reference-only-v1',
      embeddedFiles: 0,
      statement: '本包不嵌入游戏文件、Workshop MOD、本地 MOD、存档、账号信息或运行时缓存；仅传递重建清单与内容指纹。'
    },
    exclusions: ['game-binaries', 'workshop-files', 'local-mod-files', 'saves', 'databases', 'credentials', 'logs', 'runtime-cache', 'absolute-paths']
  }
  if (!snapshot.managerRoot) warnings.push('制作端没有设置版本管理目录；这不影响清单本身，但接收端安装前必须设置。')
  const envelope = createShareEnvelope(manifest)
  return { envelope, modCount: mods.length, title }
}

export const createSharePackageAt = async (filePath: string): Promise<SharePackageCreateResult> => {
  const { envelope, modCount } = await buildSharePackage()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, serializeSharePackage(envelope), 'utf8')
  return {
    canceled: false,
    ok: true,
    filePath,
    packageId: envelope.manifest.packageId,
    digest: envelope.integrity.digest,
    message: `共享清单已生成：${modCount} 个启用 MOD，零嵌入文件。`
  }
}

export const createSharePackage = async (): Promise<SharePackageCreateResult> => {
  const { envelope, modCount, title } = await buildSharePackage()
  const result = await dialog.showSaveDialog({
    title: '制作 PZ 共享清单包',
    defaultPath: `${title}.pzshare`,
    buttonLabel: '导出共享清单',
    filters: [{ name: 'PZ Vault 共享清单', extensions: ['pzshare'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true, ok: false, filePath: null, packageId: null, digest: null, message: '已取消制作共享包。' }
  await fs.writeFile(result.filePath, serializeSharePackage(envelope), 'utf8')
  return {
    canceled: false,
    ok: true,
    filePath: result.filePath,
    packageId: envelope.manifest.packageId,
    digest: envelope.integrity.digest,
    message: `共享清单已生成：${modCount} 个启用 MOD，零嵌入文件。`
  }
}

export const inspectSharePackageAt = async (filePath: string): Promise<SharePackageInspection> => {
  let envelope: SharePackageEnvelopeV1
  try {
    envelope = await loadEnvelope(filePath)
  } catch (error) {
    return {
      canceled: false, valid: false, canInstall: false, filePath, packageId: null, title: null, createdAt: null, source: null,
      gameVersion: null, buildId: null, modCount: 0, workshopCount: 0, digest: null, trust: 'invalid', rights: 'unknown',
      findings: [{ severity: 'blocker', title: '共享包验证失败', detail: error instanceof Error ? error.message : String(error) }],
      message: '共享包格式或内容摘要无效。'
    }
  }
  const manifest = envelope.manifest
  const findings: SharePackageFinding[] = [
    { severity: 'pass', title: '内容摘要一致', detail: `SHA-256 ${envelope.integrity.digest}` },
    { severity: 'pass', title: '零嵌入引用包', detail: '未携带游戏、MOD、存档或运行时缓存文件。' },
    { severity: 'warning', title: '制作者身份未签名', detail: 'v1 能发现文件被修改，但不能证明最初由谁制作。请通过可信渠道核对摘要。' },
    { severity: 'warning', title: 'v1 不改写存档和服务器配置', detail: '启用顺序会保存为 metadata\\shared-loadout.json；接收方需要在目标存档或服务器中明确应用，避免管理器擅自修改个人数据。' }
  ]

  try {
    const snapshot = await getSnapshot()
    const installedFinding = await alreadyInstalledFinding(envelope)
    if (installedFinding) findings.push(installedFinding)
    const integrity = await analyzeIntegrity({ submitSteamValidation: false })
    const compatibility = await analyzeCompatibility()
    const fingerprintCache = new Map<string, Promise<DirectoryFingerprint>>()
    const localMods: LocalShareModEvidence[] = []
    const fingerprintFailures: string[] = []
    const expectedIds = new Set(manifest.mods.map((mod) => mod.modId))
    for (const candidate of compatibility.mods.filter((mod) => Boolean(mod.modId && expectedIds.has(mod.modId)))) {
      try {
        const root = path.resolve(candidate.rootPath).toLowerCase()
        let current = fingerprintCache.get(root)
        if (!current) {
          current = fingerprintDirectory(candidate.rootPath)
          fingerprintCache.set(root, current)
        }
        localMods.push({ modId: candidate.modId!, workshopId: candidate.workshopId, selectedVersion: candidate.selectedVersion, contentFingerprint: (await current).digest })
      } catch (error) {
        fingerprintFailures.push(`${candidate.modId ?? candidate.name}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (fingerprintFailures.length) findings.push({ severity: 'blocker', title: `${fingerprintFailures.length} 个 MOD 无法稳定计算指纹`, detail: fingerprintFailures.slice(0, 10).join('；') })
    const reconstruction = evaluateReconstruction(manifest, {
      managerRootReady: Boolean(snapshot.managerRoot),
      integritySummary: integrity.plainSummary,
      integrityBlocked: integrity.verdict === 'blocker',
      identity: compatibility.identity,
      mods: localMods,
      workshopIds: [...new Set(compatibility.mods.flatMap((mod) => mod.workshopId ? [mod.workshopId] : []))]
    })
    findings.push(...reconstruction.findings)
  } catch (error) {
    findings.push({ severity: 'blocker', title: '本机重建条件检查失败', detail: error instanceof Error ? error.message : String(error) })
  }
  const blockers = findings.filter((finding) => finding.severity === 'blocker').length
  return {
    canceled: false,
    valid: true,
    canInstall: blockers === 0,
    filePath,
    packageId: manifest.packageId,
    title: manifest.title,
    createdAt: manifest.createdAt,
    source: manifest.source,
    gameVersion: manifest.game.fullVersion,
    buildId: manifest.game.buildId,
    modCount: manifest.mods.length,
    workshopCount: new Set(manifest.mods.flatMap((mod) => mod.workshopId ? [mod.workshopId] : [])).size,
    digest: envelope.integrity.digest,
    trust: 'unsigned',
    rights: 'reference-only',
    findings,
    message: blockers ? `共享包有效，但当前有 ${blockers} 个条件阻止安装。` : '共享包有效，本机内容满足精确重建条件。'
  }
}

export const inspectSharePackage = async (): Promise<SharePackageInspection> => {
  const result = await dialog.showOpenDialog({
    title: '接收并验证 PZ 共享清单',
    properties: ['openFile'],
    buttonLabel: '隔离验证',
    filters: [{ name: 'PZ Vault 共享清单', extensions: ['pzshare'] }]
  })
  if (result.canceled || !result.filePaths[0]) {
    return {
      canceled: true, valid: false, canInstall: false, filePath: null, packageId: null, title: null, createdAt: null, source: null,
      gameVersion: null, buildId: null, modCount: 0, workshopCount: 0, digest: null, trust: 'invalid', rights: 'unknown', findings: [], message: '已取消接收。'
    }
  }
  return inspectSharePackageAt(result.filePaths[0])
}

type ShareInstallHooks = { afterMigration?: (installedRoot: string) => Promise<void> }

export const installSharePackageAt = async (filePath: string, hooks: ShareInstallHooks = {}): Promise<SharePackageInstallResult> => {
  const inspection = await inspectSharePackageAt(filePath)
  if (!inspection.valid || !inspection.canInstall) return { ok: false, message: '共享包尚不满足安装条件。', output: inspection.findings.filter((finding) => finding.severity === 'blocker').map((finding) => `${finding.title}：${finding.detail}`).join('\n'), installedRoot: null }
  const envelope = await loadEnvelope(filePath)
  if (envelope.manifest.packageId !== inspection.packageId || envelope.integrity.digest !== inspection.digest) {
    return { ok: false, message: '共享包在验证后发生了变化。', output: '请重新选择文件并完成隔离验证。', installedRoot: null }
  }
  const snapshot = await getSnapshot()
  const sourceType = snapshot.activeSource
  const activeVersion = sourceType === 'Frozen' ? (await listVersions()).find((version) => version.isActive) : null
  if (sourceType === 'Frozen' && !activeVersion) return { ok: false, message: '找不到当前冻结版本登记。', output: '请重新登记或切换当前版本后再试。', installedRoot: null }
  const label = safeFileName(`共享_${envelope.manifest.title}`).slice(0, 80)
  const migration = await executeMigration({
    sourceType,
    sourceId: activeVersion?.id,
    mode: 'SafeCopy',
    label,
    protectSaves: false
  })
  if (!migration.ok) return { ok: false, message: migration.message, output: migration.output, installedRoot: null }

  const installed = await getSnapshot()
  const installedRoot = installed.config?.FreezeRoot ?? null
  if (!installedRoot) return { ok: false, message: '版本复制完成，但无法确认新版本目录。', output: migration.output, installedRoot: null }
  await fs.mkdir(path.join(installedRoot, 'metadata'), { recursive: true })
  await fs.writeFile(path.join(installedRoot, 'metadata', 'share-package.json'), `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(installedRoot, 'metadata', 'shared-loadout.json'), `${JSON.stringify(envelope.manifest.loadout, null, 2)}\n`, 'utf8')
  const receiptPath = path.join(installedRoot, 'metadata', 'share-install.json')
  const writeReceipt = async (status: 'PendingVerification' | 'Verified' | 'Quarantined', blockers: SharePackageFinding[] = []): Promise<void> => {
    await fs.writeFile(receiptPath, `${JSON.stringify({ schemaVersion: 1, packageId: envelope.manifest.packageId, packageDigest: envelope.integrity.digest, status, checkedAt: new Date().toISOString(), blockers }, null, 2)}\n`, 'utf8')
  }
  const writeInstallStatus = async (status: 'Verified' | 'Quarantined'): Promise<void> => {
    const current = await getSnapshot()
    if (!current.config || path.resolve(current.config.FreezeRoot).toLowerCase() !== path.resolve(installedRoot).toLowerCase()) {
      throw new Error('无法确认共享版本仍是当前版本，拒绝写入安装状态。')
    }
    const next = { ...current.config, ShareInstallStatus: status, SharePackageID: envelope.manifest.packageId, SharePackageDigest: envelope.integrity.digest }
    await fs.writeFile(path.join(installedRoot, 'metadata', 'freeze.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    if (current.managerRoot) await fs.writeFile(path.join(current.managerRoot, 'current-freeze.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  }
  await writeReceipt('PendingVerification')
  await writeInstallStatus('Quarantined')
  await hooks.afterMigration?.(installedRoot)
  const postInspection = await inspectSharePackageAt(filePath)
  const postBlockers = postInspection.findings.filter((finding) => finding.severity === 'blocker')
  if (postBlockers.length) {
    await writeReceipt('Quarantined', postBlockers)
    let restoreMessage = '未能切回原来源。'
    try {
      if (sourceType === 'Steam') await activateSteam()
      else if (activeVersion) await activateVersion(activeVersion.id)
      restoreMessage = '已切回安装前的来源。'
    } catch (error) {
      restoreMessage = `切回原来源失败：${error instanceof Error ? error.message : String(error)}`
    }
    return {
      ok: false,
      message: '共享版本已经创建，但安装后精确指纹复核失败，版本已隔离。',
      output: [migration.output, ...postBlockers.map((finding) => `${finding.title}：${finding.detail}`), restoreMessage].join('\n'),
      installedRoot
    }
  }
  await writeInstallStatus('Verified')
  await writeReceipt('Verified')
  return {
    ok: true,
    message: '共享清单已安装为新的受管版本，并通过安装后精确指纹复核。',
    output: [migration.output, postInspection.message, `共享加载清单：${path.join(installedRoot, 'metadata', 'shared-loadout.json')}`].join('\n'),
    installedRoot
  }
}

export const installSharePackage = async (filePath: string): Promise<SharePackageInstallResult> => installSharePackageAt(filePath)
