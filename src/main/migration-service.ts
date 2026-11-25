import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import type { ActionResult, FreezeConfig, LauncherAction, MigrationPreview, MigrationRequest, SteamInstallation } from '../shared/types'
import { readGameIdentity } from './game-identity'
import { analyzeQuickMigration, materializeQuickMigration } from './quick-migration-service'
import { frozenLaunchArguments } from './launch-arguments'
import { detectSteamInstallation } from './steam-service'
import { activateVersion, getSnapshot, listVersions } from './vault-service'

type ProcessResult = { code: number; output: string }

const runProcess = (command: string, args: string[]): Promise<ProcessResult> => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
  child.on('error', reject)
  child.on('close', (code) => resolve({ code: code ?? -1, output: output.trim() }))
})

const safeName = (value: string): string => value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 80)
const safeProfileId = (value: string): string => {
  const ascii = value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '').slice(0, 55)
  const digest = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 10)
  return `${ascii || 'profile'}_${digest}`
}
const isAsciiPath = (value: string): boolean => /^[\x20-\x7E]+$/.test(value)
const timeStamp = (): string => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)

const buildTargetPath = (managerRoot: string, version: string, buildId: string, label?: string): string => {
  const name = label?.trim()
    ? safeProfileId(label.trim())
    : `B${safeName(version)}_build${safeName(buildId)}_${timeStamp()}`
  return path.join(managerRoot, 'frozen', name)
}

const readFrozenConfig = async (freezeRoot: string): Promise<FreezeConfig> => {
  const raw = await fs.readFile(path.join(freezeRoot, 'metadata', 'freeze.json'), 'utf8')
  return JSON.parse(raw.replace(/^\uFEFF/, '')) as FreezeConfig
}

const resolveFrozenSource = async (sourceId?: string): Promise<{ root: string; config: FreezeConfig } | null> => {
  if (!sourceId) return null
  const version = (await listVersions()).find((candidate) => candidate.id === sourceId)
  if (!version) return null
  return { root: version.freezeRoot, config: await readFrozenConfig(version.freezeRoot) }
}

const migrationSteps = (request: MigrationRequest): string[] => request.mode === 'SafeCopy'
  ? ['验证来源、目标空间与版本元数据', '完整复制游戏、独立缓存与本地 MOD', '登记新版本并写入隔离配置']
  : ['分析存档、服务器配置、MOD 依赖和文件体积', '引用不可变游戏核心与启用 MOD，仅复制存档和配置', '写入基础版本依赖并执行身份复核']

export const previewMigration = async (request: MigrationRequest): Promise<MigrationPreview> => {
  const snapshot = await getSnapshot()
  const warnings: string[] = []
  if (!request.label?.trim()) warnings.push('请为新版本填写一个便于识别的名称；版本号只作为技术信息显示。')
  if (!snapshot.managerRoot) {
    return { canRun: false, sourceLabel: '未选择来源', sourcePath: null, targetPath: null, mode: request.mode, warnings: ['请先选择版本管理目录。'], steps: migrationSteps(request) }
  }

  if (request.sourceType === 'Steam') {
    const steam = await detectSteamInstallation()
    if (!steam.detected || !steam.gamePath) {
      return { canRun: false, sourceLabel: 'Steam 原版', sourcePath: steam.gamePath, targetPath: null, mode: request.mode, warnings: [steam.issue ?? '未检测到 Steam 原版。'], steps: migrationSteps(request) }
    }
    if (request.mode === 'FastLink') warnings.push('Steam 原版会自动更新，不能作为薄版本的稳定基础；请先创建完整冻结版。')
    if (request.protectSaves) warnings.push('存档保护已开启：Saves、配置和运行时缓存始终使用独立复制。')
    const targetPath = buildTargetPath(snapshot.managerRoot, steam.version, steam.buildId, request.label)
    if (existsSync(targetPath)) warnings.push('目标版本目录已经存在，请修改新版本目录名称。')
    if (!isAsciiPath(targetPath)) warnings.push('Project Zomboid 无法可靠解析含中文或其他非 ASCII 字符的 -cachedir 路径；请把版本管理目录移动到纯英文路径。')
    return {
      canRun: request.mode === 'SafeCopy' && Boolean(request.label?.trim()) && !existsSync(targetPath) && isAsciiPath(targetPath),
      sourceLabel: `Steam 原版 ${steam.version}`,
      sourcePath: steam.gamePath,
      targetPath,
      mode: request.mode,
      warnings,
      steps: migrationSteps(request)
    }
  }

  const source = await resolveFrozenSource(request.sourceId)
  if (!source) {
    return { canRun: false, sourceLabel: '冻结版本', sourcePath: null, targetPath: null, mode: request.mode, warnings: ['所选冻结版本不存在或元数据不可读。'], steps: migrationSteps(request) }
  }
  if (source.config.StorageMode === 'ThinReference') {
    warnings.push('当前来源本身是薄版本。为避免形成依赖链，请选择它所依赖的完整冻结版。')
  }
  if (request.protectSaves) warnings.push('存档保护已开启：来源存档会完整复制到新版本，不参与共享。')
  const targetPath = buildTargetPath(snapshot.managerRoot, source.config.Version ?? 'unknown', source.config.BuildID ?? 'unknown', request.label)
  if (existsSync(targetPath)) warnings.push('目标版本目录已经存在，请修改新版本目录名称。')
  if (!isAsciiPath(targetPath)) warnings.push('Project Zomboid 无法可靠解析含中文或其他非 ASCII 字符的 -cachedir 路径；请把版本管理目录移动到纯英文路径。')
  let analysis: MigrationPreview['analysis']
  if (request.mode === 'FastLink' && source.config.StorageMode !== 'ThinReference') {
    try {
      const plan = await analyzeQuickMigration(source.root, source.config)
      analysis = plan.analysis
      if (path.parse(plan.sourceCachePath).root.toLowerCase() !== path.parse(targetPath).root.toLowerCase()) {
        analysis = {
          ...analysis,
          estimatedWriteBytes: analysis.estimatedWriteBytes + analysis.referencedModBytes,
          estimatedSavedBytes: Math.max(0, analysis.estimatedSavedBytes - analysis.referencedModBytes)
        }
        warnings.push('目标版本与基础 MOD 不在同一磁盘卷，NTFS 硬链接不可用；所需 MOD 将回退为真实复制。')
      }
      warnings.push(`快速薄版本依赖基础冻结版“${source.config.DisplayName?.trim() || path.basename(source.root)}”；基础版本不可移动或删除。`)
      if (analysis.fallbackToAllMods) warnings.push('没有找到存档或服务器 MOD 上下文，将引用全部已安装 MOD，空间节省仍主要来自游戏核心。')
      if (analysis.missingModIds.length) warnings.push(`启用列表中有 ${analysis.missingModIds.length} 个 Mod ID 未安装；快速版本会保留缺失证据并挂接当前全部已安装 MOD，但不会补全这些缺失内容：${analysis.missingModIds.slice(0, 8).join('、')}`)
    } catch (error) {
      warnings.push(`快速迁移分析失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    canRun: Boolean(request.label?.trim()) && !existsSync(targetPath) && isAsciiPath(targetPath) && source.config.StorageMode !== 'ThinReference' && (request.mode !== 'FastLink' || Boolean(analysis)),
    sourceLabel: source.config.DisplayName?.trim() || `冻结版本 ${source.config.Version ?? request.sourceId}`,
    sourcePath: source.root,
    targetPath,
    mode: request.mode,
    warnings,
    steps: migrationSteps(request),
    analysis
  }
}

const robocopy = async (source: string, destination: string, extraArgs: string[] = []): Promise<string> => {
  await fs.mkdir(destination, { recursive: true })
  const result = await runProcess('robocopy.exe', [source, destination, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:2', '/W:1', '/XJ', '/NFL', '/NDL', '/NP', ...extraArgs])
  if (result.code > 7) throw new Error(`Robocopy failed with exit code ${result.code}: ${result.output}`)
  return result.output
}

const backupMutableData = async (managerRoot: string, sourceCache: string, sourceLabel: string): Promise<string | null> => {
  if (!existsSync(sourceCache)) return null
  const backupRoot = path.join(managerRoot, 'save-backups', `${timeStamp()}_${safeName(sourceLabel)}`)
  await fs.mkdir(backupRoot, { recursive: true })
  const saves = path.join(sourceCache, 'Saves')
  if (existsSync(saves)) await robocopy(saves, path.join(backupRoot, 'Saves'))
  const rootFiles = await fs.readdir(sourceCache, { withFileTypes: true })
  const protectedExtensions = new Set(['.ini', '.json', '.db', '.cfg', '.properties'])
  for (const entry of rootFiles) {
    if (!entry.isFile() || !protectedExtensions.has(path.extname(entry.name).toLowerCase())) continue
    await fs.copyFile(path.join(sourceCache, entry.name), path.join(backupRoot, entry.name))
  }
  await fs.writeFile(path.join(backupRoot, 'backup.json'), JSON.stringify({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceCache,
    sourceLabel,
    policy: 'Saves plus root configuration and database files; no automatic deletion'
  }, null, 2), 'utf8')
  return backupRoot
}

const collectFiles = async (root: string): Promise<string[]> => {
  const files: string[] = []
  const pending = ['']
  while (pending.length) {
    const relative = pending.pop()!
    const directory = path.join(root, relative)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const next = path.join(relative, entry.name)
      if (entry.isDirectory()) pending.push(next)
      else if (entry.isFile()) files.push(next)
    }
  }
  return files
}

const hashFile = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
})

const writeHashManifest = async (root: string, destination: string): Promise<number> => {
  if (!existsSync(root)) {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, '\uFEFF"RelativePath","Length","SHA256"\r\n', 'utf8')
    return 0
  }
  const files = await collectFiles(root)
  const rows = ['"RelativePath","Length","SHA256"']
  for (let index = 0; index < files.length; index += 8) {
    const batch = await Promise.all(files.slice(index, index + 8).map(async (relative) => {
      const fullPath = path.join(root, relative)
      const stats = await fs.stat(fullPath)
      return `"${relative.replace(/"/g, '""')}","${stats.size}","${await hashFile(fullPath)}"`
    }))
    rows.push(...batch)
  }
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, `\uFEFF${rows.join('\r\n')}\r\n`, 'utf8')
  return files.length
}

const writeRegisteredConfig = async (
  managerRoot: string,
  targetRoot: string,
  sourceConfig: FreezeConfig,
  mode: MigrationRequest['mode'],
  displayName: string,
  overrides: Partial<FreezeConfig> = {}
): Promise<FreezeConfig> => {
  const config: FreezeConfig & Record<string, unknown> = {
    ...sourceConfig,
    DisplayName: displayName.trim(),
    ManagerRoot: managerRoot,
    FreezeRoot: targetRoot,
    GamePath: path.join(targetRoot, 'game'),
    CachePath: path.join(targetRoot, 'cache'),
    ManifestPath: path.join(targetRoot, 'manifests'),
    ReportPath: path.join(targetRoot, 'reports'),
    BackupPath: path.join(targetRoot, 'backups'),
    Created: new Date().toISOString(),
    LaunchArguments: frozenLaunchArguments(sourceConfig.LaunchArguments, path.join(targetRoot, 'cache')),
    MigrationMode: mode,
    SourceFreezeRoot: sourceConfig.FreezeRoot,
    StorageMode: 'FullCopy',
    ...overrides
  }
  await fs.mkdir(path.join(targetRoot, 'metadata'), { recursive: true })
  await fs.mkdir(config.ReportPath, { recursive: true })
  await fs.mkdir(config.BackupPath, { recursive: true })
  await fs.writeFile(path.join(targetRoot, 'metadata', 'freeze.json'), JSON.stringify(config, null, 2), 'utf8')
  const currentPath = path.join(managerRoot, 'current-freeze.json')
  if (existsSync(currentPath)) await fs.copyFile(currentPath, `${currentPath}.launcher-backup`)
  await fs.writeFile(currentPath, JSON.stringify(config, null, 2), 'utf8')
  return config
}

const migrateFromFrozen = async (request: MigrationRequest, targetRoot: string): Promise<string> => {
  const source = await resolveFrozenSource(request.sourceId)
  if (!source) throw new Error('所选冻结版本不存在。')
  if (existsSync(targetRoot)) throw new Error(`迁移目标已存在：${targetRoot}`)
  const managerRoot = (await getSnapshot()).managerRoot!
  const sourceCachePath = source.config.CachePath || path.join(source.root, 'cache')
  const saveBackup = request.protectSaves
    ? await backupMutableData(managerRoot, sourceCachePath, `frozen_${source.config.Version ?? request.sourceId ?? 'unknown'}`)
    : null
  await fs.mkdir(targetRoot, { recursive: true })
  try {
    if (request.mode === 'SafeCopy') {
      await robocopy(source.config.GamePath || path.join(source.root, 'game'), path.join(targetRoot, 'game'))
      await robocopy(sourceCachePath, path.join(targetRoot, 'cache'))
      if (existsSync(path.join(source.root, 'manifests'))) await robocopy(path.join(source.root, 'manifests'), path.join(targetRoot, 'manifests'))
      if (existsSync(path.join(source.root, 'metadata'))) await robocopy(path.join(source.root, 'metadata'), path.join(targetRoot, 'metadata'))
      await writeRegisteredConfig(managerRoot, targetRoot, source.config, request.mode, request.label!)
      return `安全完整复制完成；游戏、MOD、配置与存档均为独立文件。${saveBackup ? `\n迁移前存档快照：${saveBackup}` : ''}`
    }

    if (source.config.StorageMode === 'ThinReference') throw new Error('薄版本不能继续作为基础版本，请选择完整冻结版')
    const plan = await analyzeQuickMigration(source.root, source.config)
    const baseIdentity = await readGameIdentity(plan.sourceGamePath, source.config.BuildID ?? 'unknown', plan.sourceCachePath)
    if (source.config.Revision && baseIdentity.revision !== source.config.Revision) throw new Error(`基础版本 revision 已变化：预期 ${source.config.Revision}，实际 ${baseIdentity.revision ?? 'unknown'}`)
    if (source.config.GameJarSHA256 && baseIdentity.jarSha256 !== source.config.GameJarSHA256) throw new Error('基础版本游戏 JAR 与冻结身份不一致，请先执行完整性校验')
    const targetCache = path.join(targetRoot, 'cache')
    const referencedMods = await materializeQuickMigration(plan, targetCache)
    const hardLinkedModFiles = referencedMods.reduce((sum, mod) => sum + (mod.linkedFiles ?? 0), 0)
    const copiedModFiles = referencedMods.reduce((sum, mod) => sum + (mod.copiedFiles ?? 0), 0)
    const config = await writeRegisteredConfig(managerRoot, targetRoot, source.config, request.mode, request.label!, {
      GamePath: plan.sourceGamePath,
      CachePath: targetCache,
      StorageMode: 'ThinReference',
      BaseFreezeRoot: source.root,
      BaseGamePath: plan.sourceGamePath,
      BaseRevision: baseIdentity.revision ?? undefined,
      BaseGameJarSHA256: baseIdentity.jarSha256 ?? undefined,
      Version: baseIdentity.version,
      FullVersion: [baseIdentity.version, baseIdentity.revision].filter(Boolean).join(' '),
      Revision: baseIdentity.revision ?? undefined,
      GameJarSHA256: baseIdentity.jarSha256 ?? undefined,
      IdentityStatus: baseIdentity.status,
      MutableCachePolicyVersion: 1,
      ReferencedMods: referencedMods,
      EffectiveModCount: new Set(referencedMods.flatMap((mod) => mod.modIds)).size,
      WorkshopProjectCount: new Set(referencedMods.flatMap((mod) => mod.workshopId ? [mod.workshopId] : [])).size
    })
    const record = { schemaVersion: 2, createdAt: new Date().toISOString(), source: source.root, target: targetRoot, storageMode: config.StorageMode, analysis: plan.analysis, referencedMods }
    await fs.writeFile(path.join(targetRoot, 'metadata', 'reuse-record.json'), JSON.stringify(record, null, 2), 'utf8')
    await fs.writeFile(path.join(targetRoot, 'reports', 'quick-migration-analysis.json'), JSON.stringify(plan.analysis, null, 2), 'utf8')
    return `快速薄版本创建完成：游戏核心引用 ${plan.analysis.sourceGameFiles} 个文件；可用 MOD ${referencedMods.length} 个根目录，硬链接 ${hardLinkedModFiles} 个文件、回退复制 ${copiedModFiles} 个；独立数据 ${plan.analysis.copiedMutableFiles} 个文件。${plan.analysis.missingModIds.length ? ` 启用上下文仍有 ${plan.analysis.missingModIds.length} 个 Mod ID 在来源中缺失，证据已写入分析报告。` : ''}基础冻结版不可移动或删除。${saveBackup ? `\n迁移前存档快照：${saveBackup}` : ''}`
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : '迁移失败'}；未完成的目标保留在 ${targetRoot}，便于检查后手动清理。`)
  }
}

const migrateFromSteam = async (request: MigrationRequest, steam: SteamInstallation, targetRoot: string, managerRoot: string): Promise<string> => {
  if (request.mode !== 'SafeCopy') throw new Error('Steam 原版不能作为薄版本基础，请先创建完整冻结版。')
  if (!steam.gamePath || !steam.cachePath || !steam.manifestPath) throw new Error('Steam 来源信息不完整。')
  if (existsSync(targetRoot)) throw new Error(`目标目录已经存在：${targetRoot}`)
  const gameTarget = path.join(targetRoot, 'game')
  const cacheTarget = path.join(targetRoot, 'cache')
  const manifestsTarget = path.join(targetRoot, 'manifests')
  const metadataTarget = path.join(targetRoot, 'metadata')
  const saveBackup = request.protectSaves
    ? await backupMutableData(managerRoot, steam.cachePath, `steam_${steam.version}_${steam.buildId}`)
    : null
  await robocopy(steam.gamePath, gameTarget)
  if (existsSync(steam.cachePath)) await robocopy(steam.cachePath, cacheTarget)
  else await fs.mkdir(cacheTarget, { recursive: true })

  let localizedMods = 0
  const workshopPath = steam.workshopPath
  const projects = workshopPath && existsSync(workshopPath)
    ? await fs.readdir(workshopPath, { withFileTypes: true })
    : []
  for (const project of projects.filter((entry) => entry.isDirectory())) {
    const modsRoot = path.join(workshopPath!, project.name, 'mods')
    if (!existsSync(modsRoot)) continue
    for (const modRoot of (await fs.readdir(modsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
      const destinationName = safeName(`WS${project.name}__${modRoot.name}`)
      await robocopy(path.join(modsRoot, modRoot.name), path.join(cacheTarget, 'mods', destinationName))
      localizedMods += 1
    }
  }

  await fs.mkdir(metadataTarget, { recursive: true })
  await fs.copyFile(steam.manifestPath, path.join(metadataTarget, 'appmanifest_108600.original.acf'))
  const versionFile = path.join(steam.cachePath, 'version.txt')
  if (existsSync(versionFile)) await fs.copyFile(versionFile, path.join(metadataTarget, 'game-version.txt'))
  const frozenIdentity = await readGameIdentity(gameTarget, steam.buildId, cacheTarget)
  if (frozenIdentity.version !== steam.version || frozenIdentity.revision !== steam.revision || frozenIdentity.jarSha256 !== steam.gameJarSha256) {
    throw new Error(`冻结后身份复核失败：来源 ${steam.version}/${steam.revision ?? 'unknown'}，目标 ${frozenIdentity.version}/${frozenIdentity.revision ?? 'unknown'}`)
  }
  await fs.writeFile(path.join(metadataTarget, 'game-identity.json'), JSON.stringify(frozenIdentity, null, 2), 'utf8')
  const gameFiles = await writeHashManifest(gameTarget, path.join(manifestsTarget, 'game.sha256.csv'))
  const modFiles = await writeHashManifest(path.join(cacheTarget, 'mods'), path.join(manifestsTarget, 'mods.sha256.csv'))
  const config: FreezeConfig & Record<string, unknown> = {
    ManagerRoot: managerRoot,
    FreezeRoot: targetRoot,
    GamePath: gameTarget,
    CachePath: cacheTarget,
    ManifestPath: manifestsTarget,
    ReportPath: path.join(targetRoot, 'reports'),
    BackupPath: path.join(targetRoot, 'backups'),
    Version: frozenIdentity.version,
    FullVersion: [frozenIdentity.version, frozenIdentity.revision].filter(Boolean).join(' '),
    BuildID: steam.buildId,
    Revision: frozenIdentity.revision ?? undefined,
    GameJarSHA256: frozenIdentity.jarSha256 ?? undefined,
    IdentityStatus: frozenIdentity.status,
    DisplayName: request.label!.trim(),
    Created: new Date().toISOString(),
    WorkshopProjectCount: steam.workshopProjectCount,
    EffectiveModCount: localizedMods,
    SourceGame: steam.gamePath,
    SourceWorkshop: steam.workshopPath,
    SourceCache: steam.cachePath,
    SourceSteamManifest: steam.manifestPath
  }
  await writeRegisteredConfig(managerRoot, targetRoot, config, request.mode, request.label!)
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), source: 'Steam', gameFiles, modFiles, localizedMods, saveProtection: request.protectSaves }
  await fs.writeFile(path.join(targetRoot, 'reports', 'creation-summary.json'), JSON.stringify(report, null, 2), 'utf8')
  return `Steam 原版安全复制完成。游戏文件 ${gameFiles} 个，MOD 文件 ${modFiles} 个，本地化 MOD 根目录 ${localizedMods} 个。\n新版本目录：${targetRoot}${saveBackup ? `\n迁移前存档快照：${saveBackup}` : ''}`
}

export const executeMigration = async (request: MigrationRequest): Promise<ActionResult> => {
  const started = Date.now()
  const preview = await previewMigration(request)
  const action: LauncherAction = request.mode === 'SafeCopy' ? 'MigrateSafe' : 'MigrateFast'
  if (!preview.canRun || !preview.targetPath) {
    return { ok: false, action, message: '迁移条件未满足。', output: preview.warnings.join('\n'), finishedAt: new Date().toISOString() }
  }
  try {
    const snapshot = await getSnapshot()
    if (!snapshot.managerRoot) throw new Error('请先选择版本管理目录。')
    const output = request.sourceType === 'Steam'
      ? await migrateFromSteam(request, await detectSteamInstallation(), preview.targetPath, snapshot.managerRoot)
      : await migrateFromFrozen(request, preview.targetPath)
    await activateVersion(path.basename(preview.targetPath))
    return { ok: true, action, message: `版本迁移完成，用时 ${Math.round((Date.now() - started) / 1000)} 秒。`, output, finishedAt: new Date().toISOString() }
  } catch (error) {
    return { ok: false, action, message: '版本迁移失败。', output: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() }
  }
}
