import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app, dialog, shell } from 'electron'

import type { ActionResult, FreezeConfig, FreezeVersionSummary, LauncherAction, LauncherSnapshot, ModSummary, VersionImportResult } from '../shared/types'
import { readGameIdentity } from './game-identity'
import { discoverLocalMods, discoverWorkshopMods, toModSummaries } from './mod-resolver'
import { frozenLaunchArguments } from './launch-arguments'
import { monitorExternalLaunch, monitorSpawnedLaunch, snapshotConsole } from './launch-monitor'
import { ensureSteamClientRunning } from './steam-client'
import { detectSteamInstallation, launchSteamGame, validateSteamGame } from './steam-service'

const ACTIONS: ReadonlySet<LauncherAction> = new Set(['Launch', 'Verify', 'BackupSave'])

const getSettingsPath = (): string => path.join(app.getPath('userData'), 'launcher-settings.json')
const getRegistryPath = (): string => path.join(app.getPath('userData'), 'version-registry.json')

type LauncherSettings = { managerRoot: string | null; activeSource: 'Steam' | 'Frozen'; activeVersionRoot: string | null }
type VersionRegistration = {
  id: string
  freezeRoot: string
  origin: 'Managed' | 'External'
  managerRoot?: string
  registeredAt: string
}
type VersionRegistry = { schemaVersion: 1; managerRoots: string[]; versions: VersionRegistration[] }

const emptyRegistry = (): VersionRegistry => ({ schemaVersion: 1, managerRoots: [], versions: [] })
const normalizeRoot = (value: string): string => path.resolve(value).replace(/[\\/]+$/, '')
const rootKey = (value: string): string => normalizeRoot(value).toLowerCase()
const registrationId = (freezeRoot: string): string => `frozen-${createHash('sha256').update(rootKey(freezeRoot), 'utf8').digest('hex').slice(0, 16)}`

const readSettings = async (): Promise<LauncherSettings> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as { managerRoot?: unknown; activeSource?: unknown; activeVersionRoot?: unknown }
    const managerRoot = typeof parsed.managerRoot === 'string' ? parsed.managerRoot : null
    const activeVersionRoot = typeof parsed.activeVersionRoot === 'string' ? parsed.activeVersionRoot : null
    const activeSource = parsed.activeSource === 'Steam' ? 'Steam' : activeVersionRoot || managerRoot ? 'Frozen' : 'Steam'
    return { managerRoot, activeSource, activeVersionRoot }
  } catch {
    return { managerRoot: null, activeSource: 'Steam', activeVersionRoot: null }
  }
}

const saveSettings = async (settings: LauncherSettings): Promise<void> => {
  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true })
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8')
}

const saveManagerRoot = async (managerRoot: string): Promise<void> => {
  const settings = await readSettings()
  await saveSettings({ ...settings, managerRoot })
}

const saveActiveSource = async (activeSource: LauncherSettings['activeSource'], activeVersionRoot?: string): Promise<void> => {
  const settings = await readSettings()
  await saveSettings({ ...settings, activeSource, activeVersionRoot: activeVersionRoot ? normalizeRoot(activeVersionRoot) : settings.activeVersionRoot })
}

const readRegistry = async (): Promise<VersionRegistry> => {
  try {
    const parsed = parseJson<Partial<VersionRegistry>>(await fs.readFile(getRegistryPath(), 'utf8'))
    const managerRoots = Array.isArray(parsed.managerRoots) ? parsed.managerRoots.filter((value): value is string => typeof value === 'string') : []
    const versions = Array.isArray(parsed.versions) ? parsed.versions.filter((value): value is VersionRegistration => (
      Boolean(value) && typeof value.id === 'string' && typeof value.freezeRoot === 'string' &&
      (value.origin === 'Managed' || value.origin === 'External') && typeof value.registeredAt === 'string'
    )) : []
    return { schemaVersion: 1, managerRoots, versions }
  } catch {
    return emptyRegistry()
  }
}

const saveRegistry = async (registry: VersionRegistry): Promise<void> => {
  await fs.mkdir(path.dirname(getRegistryPath()), { recursive: true })
  await fs.writeFile(getRegistryPath(), JSON.stringify(registry, null, 2), 'utf8')
}

const addManagerRoot = (registry: VersionRegistry, managerRoot: string): boolean => {
  const normalized = normalizeRoot(managerRoot)
  if (registry.managerRoots.some((candidate) => rootKey(candidate) === rootKey(normalized))) return false
  registry.managerRoots.push(normalized)
  return true
}

const registerRoot = (
  registry: VersionRegistry,
  freezeRoot: string,
  origin: VersionRegistration['origin'],
  managerRoot?: string
): boolean => {
  const normalized = normalizeRoot(freezeRoot)
  const existing = registry.versions.find((candidate) => rootKey(candidate.freezeRoot) === rootKey(normalized))
  if (existing) {
    let changed = false
    if (origin === 'Managed' && existing.origin !== 'Managed') {
      existing.origin = 'Managed'
      changed = true
    }
    if (managerRoot && (!existing.managerRoot || rootKey(existing.managerRoot) !== rootKey(managerRoot))) {
      existing.managerRoot = normalizeRoot(managerRoot)
      changed = true
    }
    return changed
  }
  registry.versions.push({
    id: registrationId(normalized),
    freezeRoot: normalized,
    origin,
    managerRoot: managerRoot ? normalizeRoot(managerRoot) : undefined,
    registeredAt: new Date().toISOString()
  })
  return true
}

const parseJson = <T>(raw: string): T => JSON.parse(raw.replace(/^\uFEFF/, '')) as T
const isAsciiPath = (value: string): boolean => /^[\x20-\x7E]+$/.test(value)

const thinDependencyIssue = (config: FreezeConfig): string | null => {
  if (config.StorageMode !== 'ThinReference') return null
  if (!isAsciiPath(config.CachePath)) return `薄版本缓存路径包含游戏启动器无法可靠解析的非 ASCII 字符：${config.CachePath}`
  if (!config.BaseFreezeRoot || !existsSync(config.BaseFreezeRoot)) return `薄版本依赖的基础冻结版不存在：${config.BaseFreezeRoot ?? '未登记'}`
  const unsupported = (config.ReferencedMods ?? []).find((mod) => mod.linkMode !== 'hardlink')
  if (unsupported) return `薄版本使用游戏无法识别的旧式 MOD 目录联接，需要重新创建：${unsupported.name}`
  const missing = (config.ReferencedMods ?? []).find((mod) => !existsSync(mod.sourcePath) || !existsSync(mod.targetPath))
  return missing ? `薄版本 MOD 引用不存在：${missing.name}` : null
}

const quarantineIssue = (config: FreezeConfig): string | null => (
  config.ShareInstallStatus === 'Quarantined'
    ? '该共享版本的安装后指纹复核未通过，已被隔离并禁止启动。请重新接收原共享包或删除此测试版本。'
    : null
)

const effectiveModCount = (config: FreezeConfig): number | undefined => (
  config.StorageMode === 'ThinReference' && config.ReferencedMods
    ? new Set(config.ReferencedMods.flatMap((mod) => mod.modIds)).size
    : config.EffectiveModCount
)

const discoverManagerRoots = async (managerRoot: string): Promise<string[]> => {
  const frozenRoot = path.join(managerRoot, 'frozen')
  try {
    const entries = await fs.readdir(frozenRoot, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(frozenRoot, entry.name))
      .filter((freezeRoot) => existsSync(path.join(freezeRoot, 'metadata', 'freeze.json')))
  } catch {
    return []
  }
}

const legacyActiveRoot = async (managerRoot: string | null): Promise<string | null> => {
  if (!managerRoot) return null
  try {
    const config = parseJson<FreezeConfig>(await fs.readFile(path.join(managerRoot, 'current-freeze.json'), 'utf8'))
    return config.FreezeRoot ? normalizeRoot(config.FreezeRoot) : null
  } catch {
    return null
  }
}

const syncRegistry = async (): Promise<{ registry: VersionRegistry; settings: LauncherSettings; activeRoot: string | null }> => {
  const settings = await readSettings()
  const registry = await readRegistry()
  let changed = false
  if (settings.managerRoot) changed = addManagerRoot(registry, settings.managerRoot) || changed

  const activeRoot = settings.activeVersionRoot ?? await legacyActiveRoot(settings.managerRoot)
  if (activeRoot) {
    let owningRoot = settings.managerRoot && rootKey(activeRoot).startsWith(`${rootKey(path.join(settings.managerRoot, 'frozen'))}\\`)
      ? settings.managerRoot
      : undefined
    try {
      const activeConfig = parseJson<FreezeConfig>(await fs.readFile(path.join(activeRoot, 'metadata', 'freeze.json'), 'utf8'))
      if (activeConfig.ManagerRoot && rootKey(activeRoot).startsWith(`${rootKey(path.join(activeConfig.ManagerRoot, 'frozen'))}\\`)) {
        owningRoot = activeConfig.ManagerRoot
        changed = addManagerRoot(registry, owningRoot) || changed
      }
    } catch {
      // Keep the registration visible even when its metadata is temporarily unavailable.
    }
    changed = registerRoot(registry, activeRoot, owningRoot ? 'Managed' : 'External', owningRoot) || changed
  }

  for (const managerRoot of registry.managerRoots) {
    for (const freezeRoot of await discoverManagerRoots(managerRoot)) {
      changed = registerRoot(registry, freezeRoot, 'Managed', managerRoot) || changed
    }
  }

  if (changed) await saveRegistry(registry)
  if (!settings.activeVersionRoot && activeRoot) await saveSettings({ ...settings, activeVersionRoot: activeRoot })
  return { registry, settings: { ...settings, activeVersionRoot: settings.activeVersionRoot ?? activeRoot }, activeRoot }
}

const normalizedVersionConfig = (config: FreezeConfig, freezeRoot: string): FreezeConfig => {
  const gamePath = config.StorageMode === 'ThinReference' ? config.GamePath : path.join(freezeRoot, 'game')
  const cachePath = config.StorageMode === 'ThinReference' ? config.CachePath : path.join(freezeRoot, 'cache')
  return {
    ...config,
    FreezeRoot: freezeRoot,
    GamePath: gamePath,
    CachePath: cachePath,
    ManifestPath: config.ManifestPath || path.join(freezeRoot, 'manifests'),
    ReportPath: config.ReportPath || path.join(freezeRoot, 'reports'),
    BackupPath: config.BackupPath || path.join(freezeRoot, 'backups'),
    EffectiveModCount: effectiveModCount(config),
    LaunchArguments: frozenLaunchArguments(config.LaunchArguments, cachePath)
  }
}

const readActiveConfig = async (settings: LauncherSettings): Promise<{ config: FreezeConfig; configPath: string } | null> => {
  const activeRoot = settings.activeVersionRoot ?? await legacyActiveRoot(settings.managerRoot)
  const metadataPath = activeRoot ? path.join(activeRoot, 'metadata', 'freeze.json') : null
  if (metadataPath && existsSync(metadataPath)) {
    const config = parseJson<FreezeConfig>(await fs.readFile(metadataPath, 'utf8'))
    return { config: normalizedVersionConfig(config, normalizeRoot(activeRoot!)), configPath: metadataPath }
  }
  if (!settings.managerRoot) return null
  const currentPath = path.join(settings.managerRoot, 'current-freeze.json')
  if (!existsSync(currentPath)) return null
  const config = parseJson<FreezeConfig>(await fs.readFile(currentPath, 'utf8'))
  const freezeRoot = normalizeRoot(config.FreezeRoot)
  return { config: normalizedVersionConfig(config, freezeRoot), configPath: currentPath }
}

export const listCurrentMods = async (): Promise<ModSummary[]> => {
  const snapshot = await getSnapshot()
  if (snapshot.activeSource === 'Steam') {
    const steam = await detectSteamInstallation()
    const workshop = await discoverWorkshopMods(steam.workshopPath, steam.version)
    const local = await discoverLocalMods(steam.cachePath ? path.join(steam.cachePath, 'mods') : null, steam.version)
    return toModSummaries([...workshop, ...local])
  }
  if (!snapshot.config?.GamePath || !snapshot.config.CachePath) return []
  const identity = await readGameIdentity(snapshot.config.GamePath, snapshot.config.BuildID ?? 'unknown', snapshot.config.CachePath)
  return toModSummaries(await discoverLocalMods(path.join(snapshot.config.CachePath, 'mods'), identity.version))
}

const getLastBackup = async (
  backupPath: string
): Promise<LauncherSnapshot['lastBackup']> => {
  try {
    const entries = await fs.readdir(backupPath, { withFileTypes: true })
    const backups = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^cache-snapshot_.*\.zip$/i.test(entry.name))
        .map(async (entry) => {
          const fullPath = path.join(backupPath, entry.name)
          const stats = await fs.stat(fullPath)
          return { name: entry.name, createdAt: stats.mtime.toISOString(), size: stats.size }
        })
    )
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  } catch {
    return null
  }
}

export const getSnapshot = async (): Promise<LauncherSnapshot> => {
  const settings = await readSettings()
  const { managerRoot, activeSource } = settings
  try {
    const active = await readActiveConfig(settings)
    const config = active?.config ?? null
    const engineRoot = config?.ManagerRoot || managerRoot
    const enginePath = engineRoot ? path.join(engineRoot, 'tools', 'PZ-Freeze-Manager.ps1') : null
    if (!config) {
      return {
        activeSource,
        isConfigured: Boolean(managerRoot),
        isHealthy: activeSource === 'Steam',
        managerRoot,
        enginePath,
        config: null,
        lastBackup: null,
        issue: managerRoot ? '版本库已就绪，尚未创建或选择受管版本。' : null
      }
    }
    const requiredPaths = [config.FreezeRoot, config.GamePath, config.CachePath]
    const missingPath = requiredPaths.find((candidate) => !candidate || !existsSync(candidate))
    const dependencyIssue = missingPath ? null : (quarantineIssue(config) ?? thinDependencyIssue(config))
    return {
      activeSource,
      isConfigured: true,
      isHealthy: !missingPath && !dependencyIssue,
      managerRoot,
      enginePath,
      config,
      lastBackup: await getLastBackup(config.BackupPath),
      issue: missingPath ? `Required path is missing: ${missingPath}` : dependencyIssue
    }
  } catch (error) {
    return {
      activeSource,
      isConfigured: true,
      isHealthy: false,
      managerRoot,
      enginePath: managerRoot ? path.join(managerRoot, 'tools', 'PZ-Freeze-Manager.ps1') : null,
      config: null,
      lastBackup: null,
      issue: error instanceof Error ? error.message : 'Unable to read the freeze configuration.'
    }
  }
}

export const chooseManagerRoot = async (): Promise<LauncherSnapshot> => {
  const result = await dialog.showOpenDialog({
    title: 'Select the PZ Freeze Manager folder',
    properties: ['openDirectory'],
    buttonLabel: 'Use this folder'
  })
  if (result.canceled || !result.filePaths[0]) return getSnapshot()

  const managerRoot = result.filePaths[0]
  const entries = await fs.readdir(managerRoot)
  const looksLikeManager = existsSync(path.join(managerRoot, 'current-freeze.json')) || existsSync(path.join(managerRoot, 'tools', 'PZ-Freeze-Manager.ps1')) || existsSync(path.join(managerRoot, 'frozen'))
  if (entries.length > 0 && !looksLikeManager) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '目录中已有其他文件',
      message: '请选择空目录，或选择已有的 PZ 版本管理目录。'
    })
    return getSnapshot()
  }

  await fs.mkdir(path.join(managerRoot, 'frozen'), { recursive: true })
  await fs.mkdir(path.join(managerRoot, 'logs'), { recursive: true })
  const previousSettings = await readSettings()
  const registry = await readRegistry()
  if (previousSettings.managerRoot) addManagerRoot(registry, previousSettings.managerRoot)
  addManagerRoot(registry, managerRoot)
  await saveRegistry(registry)
  await saveManagerRoot(managerRoot)
  await syncRegistry()
  return getSnapshot()
}

export const listVersions = async (): Promise<FreezeVersionSummary[]> => {
  const { registry, settings, activeRoot } = await syncRegistry()
  const versions = await Promise.all(registry.versions.map(async (registration): Promise<FreezeVersionSummary> => {
    const freezeRoot = normalizeRoot(registration.freezeRoot)
    const fallback = {
      id: registration.id,
      name: path.basename(freezeRoot),
      freezeRoot,
      version: '未知',
      origin: registration.origin,
      managerRoot: registration.managerRoot,
      registeredAt: registration.registeredAt,
      isActive: settings.activeSource === 'Frozen' && Boolean(activeRoot) && rootKey(activeRoot!) === rootKey(freezeRoot),
      isHealthy: false
    } satisfies FreezeVersionSummary
    try {
      const config = normalizedVersionConfig(
        parseJson<FreezeConfig>(await fs.readFile(path.join(freezeRoot, 'metadata', 'freeze.json'), 'utf8')),
        freezeRoot
      )
      const dependencyHealthy = quarantineIssue(config) === null && thinDependencyIssue(config) === null
      return {
        ...fallback,
        name: config.DisplayName?.trim() || path.basename(freezeRoot),
        gamePath: config.GamePath,
        cachePath: config.CachePath,
        backupPath: config.BackupPath,
        version: config.Version ?? path.basename(freezeRoot),
        fullVersion: config.FullVersion,
        buildId: config.BuildID,
        created: config.Created,
        workshopProjectCount: config.WorkshopProjectCount,
        effectiveModCount: effectiveModCount(config),
        storageMode: config.StorageMode ?? 'FullCopy',
        managerRoot: registration.origin === 'External' ? undefined : registration.managerRoot ?? config.ManagerRoot,
        shareInstallStatus: config.ShareInstallStatus,
        isHealthy: dependencyHealthy && existsSync(config.GamePath) && existsSync(config.CachePath)
      }
    } catch {
      return fallback
    }
  }))
  return versions.sort((a, b) => (b.created ?? b.registeredAt ?? '').localeCompare(a.created ?? a.registeredAt ?? ''))
}

export const activateVersion = async (versionId: string): Promise<LauncherSnapshot> => {
  if (!versionId) throw new Error('Invalid version identifier.')
  const settings = await readSettings()
  const versions = await listVersions()
  const version = versions.find((candidate) => (
    candidate.id === versionId || rootKey(candidate.freezeRoot) === rootKey(versionId) || path.basename(candidate.freezeRoot) === versionId
  ))
  if (!version) throw new Error('登记册中没有找到所选版本。')
  const freezeRoot = normalizeRoot(version.freezeRoot)
  const metadataPath = path.join(freezeRoot, 'metadata', 'freeze.json')
  const config = normalizedVersionConfig(parseJson<FreezeConfig>(await fs.readFile(metadataPath, 'utf8')), freezeRoot)
  const quarantined = quarantineIssue(config)
  if (quarantined) throw new Error(quarantined)
  const gamePath = config.GamePath
  const cachePath = config.CachePath
  const dependencyIssue = thinDependencyIssue(config)
  if (dependencyIssue) throw new Error(dependencyIssue)
  if (!existsSync(gamePath) || !existsSync(cachePath)) throw new Error('The selected frozen version is incomplete.')

  const nextConfig: FreezeConfig = {
    ...config,
    ManagerRoot: version.origin === 'External'
      ? settings.managerRoot ?? freezeRoot
      : version.managerRoot ?? config.ManagerRoot ?? settings.managerRoot ?? path.dirname(path.dirname(freezeRoot)),
    FreezeRoot: freezeRoot,
    GamePath: gamePath,
    CachePath: cachePath,
    ManifestPath: path.join(freezeRoot, 'manifests'),
    ReportPath: path.join(freezeRoot, 'reports'),
    BackupPath: path.join(freezeRoot, 'backups'),
    LaunchArguments: frozenLaunchArguments(config.LaunchArguments, cachePath)
  }

  await fs.writeFile(metadataPath, JSON.stringify(nextConfig, null, 2), 'utf8')
  if (settings.managerRoot) {
    const configPath = path.join(settings.managerRoot, 'current-freeze.json')
    if (existsSync(configPath)) await fs.copyFile(configPath, `${configPath}.launcher-backup`)
    await fs.writeFile(configPath, JSON.stringify(nextConfig, null, 2), 'utf8')
  }
  await saveActiveSource('Frozen', freezeRoot)
  return getSnapshot()
}

export const importVersionPaths = async (selectedPaths: string[]): Promise<VersionImportResult> => {
  const registry = await readRegistry()
  let imported = 0
  let skipped = 0
  for (const selectedPath of selectedPaths) {
    const candidates = existsSync(path.join(selectedPath, 'metadata', 'freeze.json'))
      ? [selectedPath]
      : await discoverManagerRoots(selectedPath)
    if (!candidates.length) {
      skipped += 1
      continue
    }
    for (const freezeRoot of candidates) {
      try {
        const importedConfig = normalizedVersionConfig(parseJson<FreezeConfig>(await fs.readFile(path.join(freezeRoot, 'metadata', 'freeze.json'), 'utf8')), freezeRoot)
        if (!importedConfig.Version || !existsSync(importedConfig.GamePath) || !existsSync(importedConfig.CachePath)) throw new Error('导入版本缺少版本号、游戏目录或缓存目录。')
        const existed = registry.versions.some((candidate) => rootKey(candidate.freezeRoot) === rootKey(freezeRoot))
        const isManagerRoot = candidates.length > 1 || rootKey(path.dirname(freezeRoot)) === rootKey(path.join(selectedPath, 'frozen'))
        if (isManagerRoot) addManagerRoot(registry, selectedPath)
        registerRoot(registry, freezeRoot, isManagerRoot ? 'Managed' : 'External', isManagerRoot ? selectedPath : undefined)
        if (existed) skipped += 1
        else imported += 1
      } catch {
        skipped += 1
      }
    }
  }
  await saveRegistry(registry)
  const message = imported
    ? `已登记 ${imported} 个版本${skipped ? `，跳过 ${skipped} 个无效或重复目录` : ''}。`
    : `没有登记新版本；跳过 ${skipped} 个无效或重复目录。请选择包含 metadata\\freeze.json 的版本目录。`
  return { canceled: false, imported, skipped, message }
}

export const importVersion = async (): Promise<VersionImportResult> => {
  const result = await dialog.showOpenDialog({
    title: '导入外部 Project Zomboid 版本',
    properties: ['openDirectory', 'multiSelections'],
    buttonLabel: '登记所选版本'
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true, imported: 0, skipped: 0, message: '已取消导入。' }
  return importVersionPaths(result.filePaths)
}

export const activateSteam = async (): Promise<LauncherSnapshot> => {
  await saveActiveSource('Steam')
  return getSnapshot()
}

export const runAction = async (action: LauncherAction): Promise<ActionResult> => {
  if (!ACTIONS.has(action)) throw new Error(`Unsupported action: ${action}`)
  const snapshot = await getSnapshot()
  if (snapshot.activeSource === 'Steam') {
    if (action === 'Launch') {
      const steam = await detectSteamInstallation()
      if (!steam.detected || !steam.executablePath || !steam.cachePath) {
        throw new Error(steam.issue ?? '无法确认 Steam 原版的安装目录。')
      }
      const reportRoot = path.join(snapshot.managerRoot ?? app.getPath('userData'), 'reports', 'launch')
      const result = await monitorExternalLaunch(
        async () => { await launchSteamGame() },
        {
          source: 'Steam',
          executable: steam.executablePath,
          args: [],
          cachePath: steam.cachePath,
          reportRoot,
          expectedVersion: steam.version,
          expectedBuildId: steam.buildId,
          imageName: path.basename(steam.executablePath),
          detectionMs: 120_000
        }
      )
      return { ok: result.ok, action, message: result.message, output: result.output, finishedAt: new Date().toISOString() }
    }
    if (action === 'Verify') {
      await validateSteamGame()
      return { ok: true, action, message: '已交给 Steam 执行完整性验证。', output: 'steam://validate/108600', finishedAt: new Date().toISOString() }
    }
    throw new Error('Steam 原版存档备份尚未开放。')
  }
  if (!snapshot.isHealthy || !snapshot.config) {
    throw new Error(snapshot.issue ?? 'Select a valid frozen version first.')
  }

  if (action === 'Launch') return runNativeAction(action, snapshot.config)

  if (!snapshot.enginePath || !existsSync(snapshot.enginePath) || (snapshot.config.StorageMode === 'ThinReference' && action !== 'BackupSave')) {
    return runNativeAction(action, snapshot.config)
  }

  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    snapshot.enginePath,
    '-Action',
    action,
    '-ManagerRoot',
    snapshot.config.ManagerRoot || snapshot.managerRoot || path.dirname(path.dirname(snapshot.config.FreezeRoot))
  ]

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => {
      const ok = code === 0
      resolve({
        ok,
        action,
        message: ok ? `${action} completed.` : `${action} failed with exit code ${code}.`,
        output: output.trim(),
        finishedAt: new Date().toISOString()
      })
    })
  })
}

const hashFile = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
})

const parseManifest = async (manifestPath: string): Promise<Array<{ relativePath: string; sha256: string }>> => {
  const raw = (await fs.readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, '')
  return raw.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const match = line.match(/^"((?:[^"]|"")*)","\d+","([A-Fa-f0-9]{64})"$/)
    if (!match) throw new Error(`无法解析清单行：${line.slice(0, 120)}`)
    return { relativePath: match[1].replace(/""/g, '"'), sha256: match[2].toUpperCase() }
  })
}

const verifyManifest = async (root: string, manifestPath: string): Promise<{ checked: number; missing: string[]; changed: string[] }> => {
  const rows = await parseManifest(manifestPath)
  const missing: string[] = []
  const changed: string[] = []
  for (let index = 0; index < rows.length; index += 8) {
    await Promise.all(rows.slice(index, index + 8).map(async (row) => {
      const filePath = path.join(root, row.relativePath)
      if (!existsSync(filePath)) {
        missing.push(row.relativePath)
      } else if (await hashFile(filePath) !== row.sha256) {
        changed.push(row.relativePath)
      }
    }))
  }
  return { checked: rows.length, missing, changed }
}

const collectRelativeFiles = async (root: string): Promise<string[]> => {
  if (!existsSync(root)) return []
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

const isHardLinkedTree = async (source: string, target: string): Promise<boolean> => {
  const [sourceFiles, targetFiles] = await Promise.all([collectRelativeFiles(source), collectRelativeFiles(target)])
  if (sourceFiles.length !== targetFiles.length || sourceFiles.some((file, index) => file.toLowerCase() !== targetFiles[index]?.toLowerCase())) return false
  for (let index = 0; index < sourceFiles.length; index += 64) {
    const valid = await Promise.all(sourceFiles.slice(index, index + 64).map(async (relativePath) => {
      const [sourceStats, targetStats] = await Promise.all([fs.stat(path.join(source, relativePath)), fs.stat(path.join(target, relativePath))])
      if (sourceStats.size !== targetStats.size) return false
      return !sourceStats.ino || !targetStats.ino || (sourceStats.dev === targetStats.dev && sourceStats.ino === targetStats.ino)
    }))
    if (valid.some((value) => !value)) return false
  }
  return true
}

const runNativeAction = async (action: LauncherAction, config: FreezeConfig): Promise<ActionResult> => {
  const finishedAt = (): string => new Date().toISOString()
  if (action === 'Launch') {
    const executable = path.join(config.GamePath, 'ProjectZomboid64.exe')
    if (!existsSync(executable)) throw new Error(`游戏程序不存在：${executable}`)
    const steam = await detectSteamInstallation()
    if (!steam.steamPath) throw new Error('冻结版仍需要 Steam 身份，但当前没有检测到 Steam 客户端。')
    await ensureSteamClientRunning(steam.steamPath)
    const args = frozenLaunchArguments(config.LaunchArguments, config.CachePath)
    const before = await snapshotConsole(config.CachePath)
    const child = spawn(executable, args, { cwd: config.GamePath, detached: true, stdio: 'ignore', windowsHide: false })
    const result = await monitorSpawnedLaunch(child, {
      source: 'Frozen',
      executable,
      args,
      cachePath: config.CachePath,
      reportRoot: path.join(config.ReportPath || path.join(config.FreezeRoot, 'reports'), 'launch'),
      expectedVersion: config.Version ?? 'unknown',
      expectedBuildId: config.BuildID ?? 'unknown'
    }, before)
    if (result.status === 'running') child.unref()
    return { ok: result.ok, action, message: result.message, output: result.output, finishedAt: finishedAt() }
  }

  if (action === 'Verify') {
    if (config.StorageMode === 'ThinReference') {
      const identity = await readGameIdentity(config.GamePath, config.BuildID ?? 'unknown', config.CachePath)
      const identityProblems = [
        config.BaseRevision && identity.revision !== config.BaseRevision ? `revision 预期 ${config.BaseRevision}，实际 ${identity.revision ?? 'unknown'}` : null,
        config.BaseGameJarSHA256 && identity.jarSha256 !== config.BaseGameJarSHA256 ? '游戏 JAR SHA-256 与基础版本记录不一致' : null
      ].filter((value): value is string => Boolean(value))
      const missingReferences = (config.ReferencedMods ?? []).filter((mod) => !existsSync(mod.sourcePath) || !existsSync(mod.targetPath))
      const wrongReferences: string[] = []
      for (const mod of (config.ReferencedMods ?? []).filter((item) => !missingReferences.includes(item))) {
        try {
          if (mod.linkMode === 'hardlink') {
            if (!await isHardLinkedTree(mod.sourcePath, mod.targetPath)) wrongReferences.push(mod.name)
          } else {
            const [sourceRealPath, targetRealPath] = await Promise.all([fs.realpath(mod.sourcePath), fs.realpath(mod.targetPath)])
            if (path.resolve(sourceRealPath).toLowerCase() !== path.resolve(targetRealPath).toLowerCase()) wrongReferences.push(mod.name)
          }
        } catch {
          wrongReferences.push(mod.name)
        }
      }
      const problems = identityProblems.length + missingReferences.length + wrongReferences.length
      const output = [
        `基础游戏：${identity.version} / ${identity.revision ?? 'unknown'} / ${identity.jarSha256 ?? 'no-hash'}`,
        `MOD 引用：检查 ${config.ReferencedMods?.length ?? 0}，缺失 ${missingReferences.length}，错链 ${wrongReferences.length}`,
        ...identityProblems.map((problem) => `[身份] ${problem}`),
        ...missingReferences.slice(0, 20).map((mod) => `[缺失][MOD 引用] ${mod.name} -> ${mod.sourcePath}`),
        ...wrongReferences.slice(0, 20).map((name) => `[错链][MOD 引用] ${name}`)
      ].join('\n')
      return { ok: problems === 0, action, message: problems === 0 ? '薄版本依赖与身份校验通过。' : `薄版本校验发现 ${problems} 个问题。`, output, finishedAt: finishedAt() }
    }
    if (!config.ManifestPath) throw new Error('当前版本没有 SHA-256 基线清单。')
    const gameManifest = path.join(config.ManifestPath, 'game.sha256.csv')
    const modManifest = path.join(config.ManifestPath, 'mods.sha256.csv')
    if (!existsSync(gameManifest)) throw new Error(`缺少游戏基线清单：${gameManifest}`)
    const game = await verifyManifest(config.GamePath, gameManifest)
    const mods = existsSync(modManifest)
      ? await verifyManifest(path.join(config.CachePath, 'mods'), modManifest)
      : { checked: 0, missing: [], changed: [] }
    const problems = game.missing.length + game.changed.length + mods.missing.length + mods.changed.length
    const output = [
      `游戏：检查 ${game.checked}，缺失 ${game.missing.length}，变化 ${game.changed.length}`,
      `MOD：检查 ${mods.checked}，缺失 ${mods.missing.length}，变化 ${mods.changed.length}`,
      ...game.missing.slice(0, 20).map((item) => `[缺失][游戏] ${item}`),
      ...game.changed.slice(0, 20).map((item) => `[变化][游戏] ${item}`),
      ...mods.missing.slice(0, 20).map((item) => `[缺失][MOD] ${item}`),
      ...mods.changed.slice(0, 20).map((item) => `[变化][MOD] ${item}`)
    ].join('\n')
    return { ok: problems === 0, action, message: problems === 0 ? 'SHA-256 完整性校验通过。' : `完整性校验发现 ${problems} 个问题。`, output, finishedAt: finishedAt() }
  }

  throw new Error('当前版本库没有旧维护引擎，原生存档备份将在下一阶段开放。')
}

export const openLogs = async (): Promise<boolean> => {
  const snapshot = await getSnapshot()
  const managerRoot = snapshot.config?.ManagerRoot || snapshot.managerRoot
  if (!managerRoot) return false
  const logPath = path.join(managerRoot, 'logs')
  if (!existsSync(logPath)) return false
  return (await shell.openPath(logPath)) === ''
}
