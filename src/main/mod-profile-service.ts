import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app, dialog } from 'electron'

import type {
  CompatibilityContext,
  CompatibilityReport,
  ModProfile,
  ModProfileComparison,
  ModProfileListResult,
  ModProfileMutationResult,
  ModProfileTransferResult
} from '../shared/types'
import { analyzeCompatibility } from './compatibility-service'
import { canonicalizeShareValue } from './share-package-format'
import { digestModProfile, MOD_PROFILE_ID, MOD_PROFILE_SHA256, rewriteSaveMods, rewriteServerLoadout, validateModProfile, validateModProfileName } from './mod-profile-format'
import { assertPathWithin, atomicWriteFileIfChanged, atomicWriteJsonIfChanged, isPathWithin, normalizeRoot } from './safe-write'
import { detectSteamInstallation } from './steam-service'
import { getSnapshot } from './vault-service'

const PROFILE_MAX_BYTES = 1024 * 1024

type ProfileOperationReceipt = {
  schemaVersion: 1
  operationId: string
  profileId: string
  targetPath: string
  cacheRoot: string
  contextKind: 'save' | 'server'
  contextName: string
  backupPath: string
  beforeSha256: string
  afterSha256: string
  appliedAt: string
  status: 'Prepared' | 'Applied' | 'Undone'
  undoneAt?: string
}

const profileRoot = (): string => path.join(app.getPath('userData'), 'mod-profiles')
const operationRoot = (): string => path.join(app.getPath('userData'), 'mod-profile-operations')
const profilePath = (id: string): string => path.join(profileRoot(), `${id}.json`)

const hashFile = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
})

const hashContents = (contents: string | Buffer): string => createHash('sha256').update(contents).digest('hex').toUpperCase()

const validateReceipt = (value: unknown, receiptPath: string, operationId: string): ProfileOperationReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('恢复收据不是对象。')
  const receipt = value as ProfileOperationReceipt
  if (
    receipt.schemaVersion !== 1 || receipt.operationId !== operationId || !MOD_PROFILE_ID.test(receipt.operationId) ||
    !MOD_PROFILE_ID.test(receipt.profileId) ||
    (receipt.contextKind !== 'save' && receipt.contextKind !== 'server') ||
    typeof receipt.contextName !== 'string' || !receipt.contextName || /[\u0000-\u001f]/.test(receipt.contextName) ||
    typeof receipt.targetPath !== 'string' || !path.isAbsolute(receipt.targetPath) ||
    typeof receipt.cacheRoot !== 'string' || !path.isAbsolute(receipt.cacheRoot) ||
    typeof receipt.backupPath !== 'string' || !path.isAbsolute(receipt.backupPath) ||
    !MOD_PROFILE_SHA256.test(receipt.beforeSha256) || !MOD_PROFILE_SHA256.test(receipt.afterSha256) ||
    !Number.isFinite(Date.parse(receipt.appliedAt)) ||
    (receipt.status !== 'Prepared' && receipt.status !== 'Applied' && receipt.status !== 'Undone')
  ) throw new Error('恢复收据字段无效。')
  const receiptDirectory = path.dirname(receiptPath)
  if (!isPathWithin(receiptDirectory, receipt.backupPath)) throw new Error('恢复备份不属于收据目录。')
  if (!isPathWithin(receipt.cacheRoot, receipt.targetPath)) throw new Error('恢复目标不属于记录的缓存目录。')
  return receipt
}

const readProfile = async (id: string): Promise<ModProfile> => {
  if (!MOD_PROFILE_ID.test(id)) throw new Error('配置档案 ID 无效。')
  return validateModProfile(JSON.parse((await fs.readFile(profilePath(id), 'utf8')).replace(/^\uFEFF/, '')))
}

const saveProfile = async (profile: ModProfile): Promise<void> => {
  await atomicWriteJsonIfChanged(profilePath(profile.id), profile, { trailingNewline: true })
}

export const listModProfiles = async (): Promise<ModProfileListResult> => {
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fs.readdir(profileRoot(), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: [], invalid: [] }
    throw error
  }
  const profiles: ModProfile[] = []
  const invalid: ModProfileListResult['invalid'] = []
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.toLowerCase().endsWith('.json'))) {
    const filePath = path.join(profileRoot(), entry.name)
    try {
      profiles.push(validateModProfile(JSON.parse((await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''))))
    } catch (error) {
      invalid.push({ file: filePath, error: error instanceof Error ? error.message : String(error) })
    }
  }
  profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return { profiles, invalid }
}

const allContexts = (report: CompatibilityReport): CompatibilityContext[] => {
  const result = [report.activeContext, ...report.serverContexts].filter((context): context is CompatibilityContext => context !== null)
  const seen = new Set<string>()
  return result.filter((context) => {
    const key = normalizeRoot(context.path).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const selectContext = (report: CompatibilityReport, requestedPath?: string): CompatibilityContext | null => {
  const contexts = allContexts(report)
  if (requestedPath) return contexts.find((context) => normalizeRoot(context.path).toLowerCase() === normalizeRoot(requestedPath).toLowerCase()) ?? null
  return report.analysisContext
}

const currentCacheRoot = async (): Promise<string> => {
  const snapshot = await getSnapshot()
  if (snapshot.activeSource === 'Frozen') {
    if (!snapshot.config?.CachePath) throw new Error('当前冻结版本没有可用缓存目录。')
    return snapshot.config.CachePath
  }
  const steam = await detectSteamInstallation()
  if (!steam.detected || !steam.cachePath) throw new Error(steam.issue ?? 'Steam 缓存目录不可用。')
  return steam.cachePath
}

const assertWritableContext = async (context: CompatibilityContext): Promise<string> => {
  const cacheRoot = await currentCacheRoot()
  await assertPathWithin(cacheRoot, context.path, '上下文文件不属于当前版本缓存，拒绝写入')
  const stats = await fs.lstat(context.path)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('上下文目标不是普通文件，拒绝写入。')
  return cacheRoot
}

const deriveWorkshopIds = (report: CompatibilityReport, context: CompatibilityContext): string[] => {
  if (context.kind === 'server' && context.workshopIds.length) return [...context.workshopIds]
  const byId = new Map(report.mods.flatMap((mod) => mod.modId && mod.workshopId ? [[mod.modId, mod.workshopId] as const] : []))
  return [...new Set(context.modIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []))]
}

export const createModProfile = async (name: string, contextPath?: string): Promise<ModProfile> => {
  const normalizedName = validateModProfileName(name)
  const report = await analyzeCompatibility()
  const context = selectContext(report, contextPath)
  if (!context) throw new Error(contextPath ? '重新分析后没有找到所选存档或服务器配置。' : '没有唯一的存档或服务器上下文，无法建立配置档案。')
  const now = new Date().toISOString()
  const base: Omit<ModProfile, 'profileDigest'> = {
    format: 'pz-vault-mod-profile',
    schemaVersion: 1,
    id: randomUUID(),
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
    game: {
      source: report.source,
      sourceLabel: report.sourceLabel,
      version: report.identity.version,
      buildId: report.identity.buildId,
      revision: report.identity.revision,
      jarSha256: report.identity.jarSha256
    },
    binding: { kind: context.kind, name: context.name, sourcePath: context.path },
    loadout: { modIds: [...context.modIds], workshopIds: deriveWorkshopIds(report, context) },
    catalog: { digest: report.modCatalog.digest, completeness: report.modCatalog.completeness },
    digestAlgorithm: 'SHA-256'
  }
  const profile: ModProfile = { ...base, profileDigest: digestModProfile(base) }
  await saveProfile(profile)
  return profile
}

const sequenceEqual = (left: string[], right: string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index])
const difference = (left: string[], right: Set<string>): string[] => left.filter((value) => !right.has(value))

const buildComparison = async (profile: ModProfile, report: CompatibilityReport, contextPath?: string): Promise<ModProfileComparison> => {
  const context = selectContext(report, contextPath)
  const installedIds = new Set(report.mods.flatMap((mod) => mod.modId ? [mod.modId] : []))
  const installedWorkshopIds = new Set(report.mods.flatMap((mod) => mod.workshopId ? [mod.workshopId] : []))
  const currentIds = new Set(context?.modIds ?? [])
  const profileIds = new Set(profile.loadout.modIds)
  const gameIdentityMatches = Boolean(
    profile.game.jarSha256 && report.identity.jarSha256 &&
    profile.game.jarSha256.toUpperCase() === report.identity.jarSha256.toUpperCase() &&
    profile.game.version === report.identity.version &&
    profile.game.buildId === report.identity.buildId &&
    profile.game.revision === report.identity.revision
  )
  const missingInstalledModIds = difference(profile.loadout.modIds, installedIds)
  const missingWorkshopIds = difference(profile.loadout.workshopIds, installedWorkshopIds)
  const enableModIds = difference(profile.loadout.modIds, currentIds)
  const disableModIds = context ? difference(context.modIds, profileIds) : []
  const orderChanged = context ? !sequenceEqual(profile.loadout.modIds, context.modIds) : false
  const workshopOrderChanged = context?.kind === 'server' ? !sequenceEqual(profile.loadout.workshopIds, context.workshopIds) : false
  const blockers: string[] = []
  const warnings: string[] = []
  if (!context) blockers.push(contextPath ? '重新分析后找不到指定上下文。' : '当前没有唯一的存档或服务器上下文。')
  if (!gameIdentityMatches) blockers.push('配置档案与当前游戏二进制身份不完全一致。')
  if (context && context.kind !== profile.binding.kind) blockers.push(`配置档案绑定的是${profile.binding.kind === 'save' ? '存档' : '服务器'}，不能写入${context.kind === 'save' ? '存档' : '服务器'}格式。`)
  if (missingInstalledModIds.length) blockers.push(`${missingInstalledModIds.length} 个 Mod ID 当前未安装。`)
  if (missingWorkshopIds.length) blockers.push(`${missingWorkshopIds.length} 个 Workshop 项目当前不可用。`)
  if (profile.catalog.completeness === 'partial') warnings.push('配置档案创建时的 MOD 数据库证据不完整。')
  if (profile.catalog.digest !== report.modCatalog.digest) warnings.push('当前统一 MOD 数据库摘要与捕获时不同；可能存在新增、移除或内容变化，应用只会改启用清单。')
  if (context && context.name !== profile.binding.name) warnings.push(`将把“${profile.binding.name}”的清单应用到“${context.name}”。`)
  let sourceFileSha256: string | null = null
  let previewToken: string | null = null
  if (context && !blockers.length) {
    await assertWritableContext(context)
    sourceFileSha256 = await hashFile(context.path)
    previewToken = createHash('sha256').update(canonicalizeShareValue({
      profileDigest: profile.profileDigest,
      targetPath: normalizeRoot(context.path).toLowerCase(),
      sourceFileSha256,
      game: report.identity,
      modIds: profile.loadout.modIds,
      workshopIds: profile.loadout.workshopIds
    }), 'utf8').digest('hex').toUpperCase()
  }
  const exact = Boolean(context && gameIdentityMatches && !missingInstalledModIds.length && !missingWorkshopIds.length && !orderChanged && !workshopOrderChanged)
  const orderSummary = [orderChanged ? 'Mod ID' : '', workshopOrderChanged ? 'Workshop' : ''].filter(Boolean).join(' 与 ')
  return {
    profileId: profile.id,
    comparedAt: new Date().toISOString(),
    status: blockers.length ? 'blocked' : exact ? 'exact' : 'different',
    canApply: !blockers.length,
    target: context,
    previewToken,
    summary: blockers.length ? `存在 ${blockers.length} 个阻断条件，未允许写入。` : exact ? '当前上下文已经与配置档案一致。' : `将启用 ${enableModIds.length} 个、停用 ${disableModIds.length} 个 Mod ID${orderSummary ? `，并调整 ${orderSummary} 顺序` : ''}。`,
    gameIdentityMatches,
    sourceFileSha256,
    differences: { missingInstalledModIds, missingWorkshopIds, enableModIds, disableModIds, orderChanged, workshopOrderChanged },
    blockers,
    warnings
  }
}

export const compareModProfile = async (profileId: string, contextPath?: string): Promise<ModProfileComparison> => (
  buildComparison(await readProfile(profileId), await analyzeCompatibility(), contextPath)
)

export const applyModProfile = async (profileId: string, previewToken: string, contextPath?: string): Promise<ModProfileMutationResult> => {
  if (!MOD_PROFILE_SHA256.test(previewToken)) throw new Error('预览令牌无效，请重新比较。')
  const profile = await readProfile(profileId)
  const report = await analyzeCompatibility()
  const comparison = await buildComparison(profile, report, contextPath)
  if (!comparison.canApply || !comparison.target || !comparison.previewToken) return { ok: false, message: comparison.summary, operationId: null, backupPath: null, comparison }
  if (comparison.previewToken !== previewToken.toUpperCase()) throw new Error('上下文或游戏状态在预览后发生变化，请重新比较。')
  if (comparison.status === 'exact') return { ok: true, message: '当前上下文已经与配置档案一致，没有写入文件。', operationId: null, backupPath: null, comparison }

  const context = comparison.target
  const cacheRoot = await assertWritableContext(context)
  const currentRaw = await fs.readFile(context.path, 'utf8')
  const currentHash = await hashFile(context.path)
  if (currentHash !== comparison.sourceFileSha256) throw new Error('上下文文件在预览后发生变化，请重新比较。')
  const nextRaw = context.kind === 'save'
    ? rewriteSaveMods(currentRaw, profile.loadout.modIds)
    : rewriteServerLoadout(currentRaw, profile.loadout.modIds, profile.loadout.workshopIds)
  const operationId = randomUUID()
  const receiptRoot = path.join(operationRoot(), operationId)
  const backupPath = path.join(receiptRoot, path.basename(context.path))
  await fs.mkdir(receiptRoot, { recursive: true })
  await fs.copyFile(context.path, backupPath)
  const afterSha256 = hashContents(nextRaw)
  const receiptPath = path.join(receiptRoot, 'receipt.json')
  const prepared: ProfileOperationReceipt = {
    schemaVersion: 1,
    operationId,
    profileId: profile.id,
    targetPath: context.path,
    cacheRoot,
    contextKind: context.kind,
    contextName: context.name,
    backupPath,
    beforeSha256: currentHash,
    afterSha256,
    appliedAt: new Date().toISOString(),
    status: 'Prepared'
  }
  await atomicWriteJsonIfChanged(receiptPath, prepared, { trailingNewline: true })
  await atomicWriteFileIfChanged(context.path, nextRaw)
  if (await hashFile(context.path) !== afterSha256) throw new Error('写入后的上下文摘要与预期不一致；备份和恢复收据已保留。')
  await atomicWriteJsonIfChanged(receiptPath, { ...prepared, status: 'Applied' }, { trailingNewline: true })
  return { ok: true, message: `已应用“${profile.name}”，原文件已备份，可随时撤销。`, operationId, backupPath, comparison }
}

const readReceipts = async (): Promise<Array<{ path: string; receipt: ProfileOperationReceipt }>> => {
  if (!existsSync(operationRoot())) return []
  const entries = await fs.readdir(operationRoot(), { withFileTypes: true })
  const result: Array<{ path: string; receipt: ProfileOperationReceipt }> = []
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const receiptPath = path.join(operationRoot(), entry.name, 'receipt.json')
    try {
      const receipt = validateReceipt(JSON.parse(await fs.readFile(receiptPath, 'utf8')), receiptPath, entry.name)
      if (receipt.schemaVersion === 1 && receipt.operationId === entry.name && (receipt.status === 'Prepared' || receipt.status === 'Applied')) result.push({ path: receiptPath, receipt })
    } catch {
      // Invalid receipts are never used for automatic restoration.
    }
  }
  return result.sort((left, right) => right.receipt.appliedAt.localeCompare(left.receipt.appliedAt))
}

export const undoModProfile = async (): Promise<ModProfileMutationResult> => {
  const latest = (await readReceipts())[0]
  if (!latest) return { ok: false, message: '没有可撤销的配置档案操作。', operationId: null, backupPath: null }
  const { receipt } = latest
  await assertPathWithin(receipt.cacheRoot, receipt.targetPath, '撤销目标不属于原缓存目录，拒绝恢复')
  if (!existsSync(receipt.backupPath) || await hashFile(receipt.backupPath) !== receipt.beforeSha256) throw new Error('撤销备份缺失或摘要不一致。')
  if (!existsSync(receipt.targetPath)) throw new Error('撤销目标文件已经不存在。')
  const currentHash = await hashFile(receipt.targetPath)
  if (receipt.status === 'Prepared' && currentHash === receipt.beforeSha256) {
    await atomicWriteJsonIfChanged(latest.path, { ...receipt, status: 'Undone', undoneAt: new Date().toISOString() }, { trailingNewline: true })
    return { ok: true, message: '检测到上次操作在实际写入前中断；目标文件原本未变化，已关闭恢复记录。', operationId: receipt.operationId, backupPath: receipt.backupPath }
  }
  if (currentHash !== receipt.afterSha256) throw new Error('目标文件在应用后又被修改，拒绝覆盖；请先手工备份并核对。')
  await atomicWriteFileIfChanged(receipt.targetPath, await fs.readFile(receipt.backupPath))
  const restored = await hashFile(receipt.targetPath)
  if (restored !== receipt.beforeSha256) throw new Error('撤销后的文件摘要不一致。')
  await atomicWriteJsonIfChanged(latest.path, { ...receipt, status: 'Undone', undoneAt: new Date().toISOString() }, { trailingNewline: true })
  return { ok: true, message: `已撤销对“${receipt.contextName}”的配置档案操作。`, operationId: receipt.operationId, backupPath: receipt.backupPath }
}

export const exportModProfileAt = async (profileId: string, filePath: string): Promise<ModProfileTransferResult> => {
  const profile = await readProfile(profileId)
  const portableBase = { ...profile, binding: { ...profile.binding, sourcePath: null } }
  const portable: ModProfile = { ...portableBase, profileDigest: digestModProfile(portableBase) }
  await atomicWriteJsonIfChanged(filePath, portable, { trailingNewline: true })
  return { canceled: false, ok: true, message: 'MOD 配置档案已导出；本机存档路径已移除。', filePath, profile: portable }
}

export const exportModProfile = async (profileId: string): Promise<ModProfileTransferResult> => {
  const profile = await readProfile(profileId)
  const result = await dialog.showSaveDialog({
    title: '导出 MOD 配置档案',
    defaultPath: `${profile.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.pzprofile`,
    buttonLabel: '导出配置档案',
    filters: [{ name: 'PZ Vault MOD 配置档案', extensions: ['pzprofile'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true, ok: false, message: '已取消导出。', filePath: null }
  return exportModProfileAt(profileId, result.filePath)
}

export const importModProfileAt = async (filePath: string): Promise<ModProfileTransferResult> => {
  const stats = await fs.stat(filePath)
  if (!stats.isFile() || stats.size <= 0 || stats.size > PROFILE_MAX_BYTES) throw new Error('配置档案为空或超过 1 MiB 上限。')
  const imported = validateModProfile(JSON.parse((await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')))
  const existing = (await listModProfiles()).profiles.some((profile) => profile.id === imported.id)
  const now = new Date().toISOString()
  const base = existing ? { ...imported, id: randomUUID(), name: `${imported.name}（导入副本）`.slice(0, 80), updatedAt: now } : { ...imported, updatedAt: now }
  const profile: ModProfile = { ...base, profileDigest: digestModProfile(base) }
  await saveProfile(profile)
  return { canceled: false, ok: true, message: existing ? '同 ID 配置档案已存在，已作为副本导入。' : 'MOD 配置档案已导入。', filePath, profile }
}

export const importModProfile = async (): Promise<ModProfileTransferResult> => {
  const result = await dialog.showOpenDialog({
    title: '导入 MOD 配置档案',
    properties: ['openFile'],
    buttonLabel: '验证并导入',
    filters: [{ name: 'PZ Vault MOD 配置档案', extensions: ['pzprofile'] }]
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true, ok: false, message: '已取消导入。', filePath: null }
  return importModProfileAt(result.filePaths[0])
}
