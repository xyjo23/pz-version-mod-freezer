import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import type {
  CompatibilityContext,
  CompatibilityIssue,
  CompatibilityReport,
  CompatibilitySeverity,
  AnalysisConfidence,
  FileOverlap,
  FileOverlapClassification,
  GameIdentity
} from '../shared/types'
import { readGameIdentity } from './game-identity'
import { buildModCatalog, persistModCatalog } from './mod-catalog'
import { selectEffectiveJavaClassOwners } from './java-archive-analysis'
import { atomicWriteJsonIfChanged } from './safe-write'
import { detectSteamInstallation } from './steam-service'
import { collectLayerFiles, discoverLocalMods, discoverWorkshopMods, gameVersionKey, normalizeModId, type ResolvedMod } from './mod-resolver'
import { analyzeTranslationSemantics } from './translation-analysis'
import { getSnapshot } from './vault-service'

type AnalysisSource = {
  source: 'Steam' | 'Frozen'
  label: string
  gamePath: string
  cachePath: string
  workshopPath: string | null
  buildId: string
  identity: GameIdentity
  outputRoot: string
}

const severityRank: Record<CompatibilitySeverity, number> = { blocker: 0, warning: 1, unknown: 2, pass: 3 }

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))]

const issue = (
  id: string,
  severity: CompatibilitySeverity,
  category: CompatibilityIssue['category'],
  title: string,
  summary: string,
  evidence: string[] = [],
  modIds: string[] = [],
  details: Partial<Pick<CompatibilityIssue, 'confidence' | 'appliesToScope' | 'impact' | 'action' | 'rule'>> = {}
): CompatibilityIssue => ({
  id,
  severity,
  confidence: details.confidence ?? (severity === 'unknown' ? 'unverified' : severity === 'warning' ? 'inferred' : 'confirmed'),
  appliesToScope: details.appliesToScope ?? true,
  category,
  title,
  summary,
  impact: details.impact ?? (severity === 'blocker' ? '当前分析范围内存在明确的运行阻断条件。' : severity === 'warning' ? '这是可确认的异常或有依据的风险，但不等于一定无法运行。' : severity === 'unknown' ? '现有静态证据不足以判断是否会影响运行。' : '在本次扫描范围内没有发现该类问题。'),
  action: details.action ?? (severity === 'pass' ? '无需处理。' : '查看证据并按报告范围进行人工确认。'),
  rule: details.rule ?? category.toUpperCase(),
  evidence,
  modIds: unique(modIds)
})

const resolveSource = async (): Promise<AnalysisSource> => {
  const snapshot = await getSnapshot()
  if (snapshot.activeSource === 'Steam') {
    const steam = await detectSteamInstallation()
    if (!steam.detected || !steam.gamePath || !steam.cachePath) throw new Error(steam.issue ?? 'Steam 原版不可用。')
    const outputRoot = snapshot.managerRoot
      ? path.join(snapshot.managerRoot, 'reports', 'compatibility')
      : path.join(app.getPath('userData'), 'reports', 'compatibility')
    return {
      source: 'Steam',
      label: `Steam 原版 ${steam.version} · Build ${steam.buildId}`,
      gamePath: steam.gamePath,
      cachePath: steam.cachePath,
      workshopPath: steam.workshopPath,
      buildId: steam.buildId,
      identity: {
        version: steam.version,
        revision: steam.revision,
        buildId: steam.buildId,
        jarSha256: steam.gameJarSha256,
        status: steam.identityStatus,
        source: steam.identityStatus === 'cache-only' ? 'cache' : steam.version === 'unknown' ? 'unknown' : 'binary',
        cachedVersion: steam.cachedVersion,
        cachedRevision: steam.cachedRevision,
        evidence: [
          `Steam manifest：${steam.manifestPath ?? '未知'}`,
          `BuildID：${steam.buildId}`,
          `Core.class：${steam.version}`,
          `GitVersion.class：${steam.revision ?? '未知'}`,
          `projectzomboid.jar SHA-256：${steam.gameJarSha256 ?? '未知'}`,
          `运行缓存：${steam.cachedVersion ?? '无'} / ${steam.cachedRevision ?? '无'}`,
          `游戏目录：${steam.gamePath}`
        ]
      },
      outputRoot
    }
  }

  const config = snapshot.config
  if (!config?.GamePath || !config.CachePath) throw new Error(snapshot.issue ?? '当前冻结版本不可用。')
  const identity = await readGameIdentity(config.GamePath, config.BuildID ?? 'unknown', config.CachePath)
  return {
    source: 'Frozen',
    label: config.DisplayName?.trim() || `冻结版本 ${identity.version}`,
    gamePath: config.GamePath,
    cachePath: config.CachePath,
    workshopPath: null,
    buildId: config.BuildID ?? 'unknown',
    identity,
    outputRoot: config.ReportPath || path.join(config.FreezeRoot, 'reports')
  }
}

const findFiles = async (root: string, fileName: string, maxDepth: number): Promise<string[]> => {
  if (!existsSync(root)) return []
  const result: string[] = []
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }]
  while (pending.length) {
    const current = pending.pop()!
    for (const entry of await fs.readdir(current.directory, { withFileTypes: true })) {
      const fullPath = path.join(current.directory, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) result.push(fullPath)
      else if (entry.isDirectory() && current.depth < maxDepth) pending.push({ directory: fullPath, depth: current.depth + 1 })
    }
  }
  return result
}

const parseSaveMods = async (filePath: string): Promise<string[]> => {
  const raw = await fs.readFile(filePath, 'utf8')
  return unique(raw.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*mod\s*=\s*(.*?)\s*,?\s*$/i)
    const normalized = match?.[1] ? normalizeModId(match[1]) : ''
    return normalized ? [normalized] : []
  }))
}

const parseIniList = (raw: string, key: string): string[] => {
  const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'im'))
  return match?.[1] ? unique(match[1].split(/[;,]/).map(normalizeModId).filter(Boolean)) : []
}

const buildContexts = async (
  cachePath: string,
  installedModIds: Set<string>,
  installedWorkshopIds: Set<string>
): Promise<{ active: CompatibilityContext | null; servers: CompatibilityContext[] }> => {
  const saveFiles = await findFiles(path.join(cachePath, 'Saves'), 'mods.txt', 4)
  const saveStats = await Promise.all(saveFiles.map(async (filePath) => ({ filePath, stats: await fs.stat(filePath) })))
  const latestSave = saveStats.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)[0]
  const active = latestSave ? (() => null as CompatibilityContext | null)() : null
  let activeContext = active
  if (latestSave) {
    const modIds = await parseSaveMods(latestSave.filePath)
    activeContext = {
      kind: 'save',
      name: path.basename(path.dirname(latestSave.filePath)),
      path: latestSave.filePath,
      modIds,
      workshopIds: [],
      missingModIds: modIds.filter((id) => !installedModIds.has(id)),
      missingWorkshopIds: []
    }
  }

  const serverRoot = path.join(cachePath, 'Server')
  const serverFiles = existsSync(serverRoot)
    ? (await fs.readdir(serverRoot, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.ini')).map((entry) => path.join(serverRoot, entry.name))
    : []
  const servers = await Promise.all(serverFiles.map(async (filePath): Promise<CompatibilityContext> => {
    const raw = await fs.readFile(filePath, 'utf8')
    const modIds = parseIniList(raw, 'Mods')
    const workshopIds = parseIniList(raw, 'WorkshopItems')
    return {
      kind: 'server',
      name: path.basename(filePath, path.extname(filePath)),
      path: filePath,
      modIds,
      workshopIds,
      missingModIds: modIds.filter((id) => !installedModIds.has(id)),
      missingWorkshopIds: workshopIds.filter((id) => !installedWorkshopIds.has(id))
    }
  }))
  return { active: activeContext, servers }
}

const classifyFile = (relativePath: string): FileOverlapClassification => {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
  const extension = path.extname(normalized)
  if (/^(icon|poster|preview)\.(png|jpg|jpeg)$/.test(normalized) || normalized === 'mod.info') return 'metadata'
  if (normalized.includes('/translate/')) return 'translation'
  if (normalized.includes('/tile_definitions/') || extension === '.tiles' || /tiledef/i.test(normalized)) return 'tile-definition'
  if (normalized.includes('/maps/') || ['.lotheader', '.lotpack', '.bin'].includes(extension)) return 'map'
  if (normalized.includes('/lua/') || extension === '.lua') return 'lua'
  if (normalized.includes('/scripts/') && extension === '.txt') return 'scripts'
  if (['.jar', '.class', '.dll', '.exe'].includes(extension)) return 'binary'
  if (['.png', '.jpg', '.jpeg', '.dds', '.xml', '.x', '.fbx', '.wav', '.ogg', '.bank', '.pack'].includes(extension)) return 'asset'
  return 'other'
}

const overlapSeverity = (classification: FileOverlapClassification): CompatibilitySeverity => {
  if (classification === 'metadata') return 'pass'
  if (classification === 'translation') return 'unknown'
  if (classification === 'scripts' || classification === 'map' || classification === 'tile-definition' || classification === 'asset') return 'warning'
  return 'unknown'
}

const findDependencyCycles = (activeIds: string[], dependencies: Map<string, string[]>): string[][] => {
  const cycles: string[][] = []
  const active = new Set(activeIds)
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const visit = (id: string): void => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) {
      const start = stack.indexOf(id)
      if (start >= 0) cycles.push([...stack.slice(start), id])
      return
    }
    state.set(id, 1)
    stack.push(id)
    for (const dependency of dependencies.get(id) ?? []) if (active.has(dependency)) visit(dependency)
    stack.pop()
    state.set(id, 2)
  }
  for (const id of activeIds) visit(id)
  return cycles.filter((cycle, index) => cycles.findIndex((candidate) => [...candidate].sort().join('|') === [...cycle].sort().join('|')) === index)
}

const hashFile = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex')))
})

const analyzeFiles = async (
  mods: ResolvedMod[],
  gamePath: string
): Promise<{ overlaps: FileOverlap[]; overlapCount: number; identicalOverlapCount: number; semanticSafeTranslationCount: number; classificationSeverityCounts: Map<FileOverlapClassification, Map<CompatibilitySeverity, number>>; baseOverrideCount: number; binaryModIds: string[] }> => {
  const owners = new Map<string, { displayPath: string; modIds: Set<string>; files: string[] }>()
  const baseOverrides = new Set<string>()
  const binaryModIds = new Set<string>()
  for (const mod of mods) {
    const modId = mod.record.modId ?? mod.record.name
    const files = await collectLayerFiles(mod.layers)
    for (const [normalized, displayPath] of files) {
      const owner = owners.get(normalized) ?? { displayPath, modIds: new Set<string>(), files: [] }
      owner.modIds.add(modId)
      const effectiveFile = [...mod.layers].reverse().map((layer) => path.join(layer, displayPath)).find((candidate) => existsSync(candidate))
      if (effectiveFile) owner.files.push(effectiveFile)
      owners.set(normalized, owner)
      if (existsSync(path.join(gamePath, displayPath))) baseOverrides.add(normalized)
      if (classifyFile(displayPath) === 'binary') binaryModIds.add(modId)
    }
  }
  const overlapOwners = [...owners.values()].filter((owner) => owner.modIds.size > 1)
  const allOverlaps: FileOverlap[] = []
  for (let index = 0; index < overlapOwners.length; index += 16) {
    allOverlaps.push(...await Promise.all(overlapOwners.slice(index, index + 16).map(async (owner): Promise<FileOverlap> => {
      const classification = classifyFile(owner.displayPath)
      let contentIdentical: boolean | null = null
      try {
        const hashes = await Promise.all(owner.files.map(hashFile))
        contentIdentical = hashes.length === owner.modIds.size && new Set(hashes).size === 1
      } catch {
        contentIdentical = null
      }
      const translationSemantic = classification === 'translation' && contentIdentical !== true
        ? await analyzeTranslationSemantics(owner.files)
        : null
      const severity: CompatibilitySeverity = contentIdentical === true
        ? 'pass'
        : translationSemantic?.status === 'keys-disjoint'
          ? 'pass'
          : translationSemantic?.status === 'keys-conflict'
            ? 'warning'
            : overlapSeverity(classification)
      return {
        relativePath: owner.displayPath,
        classification,
        severity,
        modIds: [...owner.modIds].sort((left, right) => left.localeCompare(right, 'en')),
        overridesBaseGame: baseOverrides.has(owner.displayPath.toLowerCase()),
        contentIdentical,
        semanticStatus: translationSemantic?.status,
        semanticEvidence: translationSemantic?.evidence
      }
    })))
  }
  allOverlaps.sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || right.modIds.length - left.modIds.length || left.relativePath.localeCompare(right.relativePath, 'en'))
  const classificationSeverityCounts = new Map<FileOverlapClassification, Map<CompatibilitySeverity, number>>()
  for (const overlap of allOverlaps.filter((entry) => entry.severity !== 'pass')) {
    const counts = classificationSeverityCounts.get(overlap.classification) ?? new Map<CompatibilitySeverity, number>()
    counts.set(overlap.severity, (counts.get(overlap.severity) ?? 0) + 1)
    classificationSeverityCounts.set(overlap.classification, counts)
  }
  return {
    overlaps: allOverlaps.slice(0, 120),
    overlapCount: allOverlaps.length,
    identicalOverlapCount: allOverlaps.filter((entry) => entry.contentIdentical === true).length,
    semanticSafeTranslationCount: allOverlaps.filter((entry) => entry.semanticStatus === 'keys-disjoint').length,
    classificationSeverityCounts,
    baseOverrideCount: baseOverrides.size,
    binaryModIds: [...binaryModIds]
  }
}

export const analyzeCompatibility = async (): Promise<CompatibilityReport> => {
  const source = await resolveSource()
  const issues: CompatibilityIssue[] = []

  if (source.identity.status === 'stale-cache') {
    issues.push(issue('identity-stale-cache', 'warning', 'identity', '运行缓存版本已过期', '游戏二进制身份与 Zomboid/version.txt 不一致；报告以二进制为准。', source.identity.evidence, [], { confidence: 'confirmed', impact: '如果只看旧缓存会误判版本；本报告没有使用旧缓存作为最终身份。', action: '启动一次当前游戏，让运行缓存刷新；兼容性结论仍以二进制身份为准。', rule: 'GAME-IDENTITY-BINARY-PRECEDENCE' }))
  } else if (source.identity.status === 'cache-only' || source.identity.status === 'unknown') {
    issues.push(issue('identity-unverified', 'unknown', 'identity', '无法验证游戏二进制身份', '兼容性分析不能只依赖运行缓存，请修复或验证 projectzomboid.jar。', source.identity.evidence, [], { confidence: 'unverified', impact: '所有依赖游戏版本的结论都缺少可靠前提；这不等于已经证明游戏损坏。', action: '恢复可读取的 projectzomboid.jar，再重新分析。', rule: 'GAME-IDENTITY-BINARY' }))
  } else {
    issues.push(issue('identity-verified', 'pass', 'identity', '游戏身份已从二进制确认', `${source.identity.version} · Build ${source.identity.buildId} · revision ${source.identity.revision ?? '未知'}`, source.identity.evidence, [], { confidence: 'confirmed', impact: '后续版本目录和版本范围判断使用的是实际游戏文件。', action: '无需处理。', rule: 'GAME-IDENTITY-BINARY' }))
  }

  const workshopMods = source.workshopPath ? await discoverWorkshopMods(source.workshopPath, source.identity.version) : []
  const localMods = await discoverLocalMods(path.join(source.cachePath, 'mods'), source.identity.version)
  const roots = new Set<string>()
  const mods = [...workshopMods, ...localMods].filter((mod) => {
    const resolved = path.resolve(mod.record.rootPath).toLowerCase()
    if (roots.has(resolved)) return false
    roots.add(resolved)
    return true
  })
  const installedIds = new Set(mods.flatMap((mod) => mod.record.modId && !mod.resolutionIssue ? [mod.record.modId] : []))
  const workshopIds = new Set(mods.flatMap((mod) => mod.record.workshopId ? [mod.record.workshopId] : []))
  const contexts = await buildContexts(source.cachePath, installedIds, workshopIds)
  const selectedContext = contexts.active ?? (contexts.servers.length === 1 ? contexts.servers[0] : null)
  const scopeLabel = selectedContext
    ? `${selectedContext.kind === 'save' ? '最近修改的存档' : '唯一服务器配置'}：${selectedContext.name}`
    : contexts.servers.length > 1
      ? `已安装内容清单（发现 ${contexts.servers.length} 个服务器配置，未擅自选择）`
      : '已安装内容清单（没有可确认的启用上下文）'
  const activeOrder = unique(selectedContext?.modIds ?? [])
  const activeSet = new Set(activeOrder)
  for (const mod of mods) mod.record.active = Boolean(mod.record.modId && activeSet.has(mod.record.modId))
  const catalogBase = source.source === 'Steam' ? path.dirname(source.outputRoot) : source.outputRoot
  const catalogPath = path.join(catalogBase, 'mod-catalog', `latest-${source.source.toLowerCase()}.json`)
  const modCatalog = await persistModCatalog(await buildModCatalog({
    source: source.source,
    sourceLabel: source.label,
    catalogPath,
    game: source.identity,
    gamePath: source.gamePath,
    mods
  }))

  if (modCatalog.completeness === 'partial') {
    issues.push(issue('mod-catalog-partial', 'unknown', 'files', 'MOD 数据库证据不完整', `有 ${modCatalog.summary.unreadable} 项无法读取、${modCatalog.summary.skippedLinks} 个目录链接被跳过，JAR 内部解析记录 ${modCatalog.summary.javaArchiveErrors} 个错误。`, [modCatalog.catalogPath, ...modCatalog.mods.flatMap((mod) => [...mod.content.unreadable.slice(0, 3).map((entry) => `${entry.path}：${entry.error}`), ...mod.content.javaArchives.flatMap((archive) => archive.errors.slice(0, 3).map((entry) => `${archive.sourcePath}：${entry}`))])], [], { confidence: 'unverified', impact: '缺少的文件或类证据不参与依赖类型和内容指纹统计，不能把数据库解释为完整覆盖。', action: '关闭正在更新这些 MOD 的程序、修复读取权限或异常 JAR，并重新运行兼容性分析。', rule: 'MOD-CATALOG-COMPLETE' }))
  } else {
    issues.push(issue('mod-catalog-complete', 'pass', 'files', 'MOD 数据库已完整重建', `${modCatalog.summary.discoveredMods} 个 MOD、${modCatalog.summary.files} 个有效文件均已建立 SHA-256 证据。`, [modCatalog.catalogPath, `数据库摘要：${modCatalog.catalogDigest}`], [], { rule: 'MOD-CATALOG-COMPLETE' }))
  }

  if (!selectedContext) {
    issues.push(issue('context-missing', 'unknown', 'save', '没有唯一的启用模组上下文', contexts.servers.length > 1 ? `发现 ${contexts.servers.length} 个服务器配置，但当前页面没有指定要分析哪一个；本次只分析已安装内容清单。` : '未找到存档 mods.txt 或唯一服务器配置；本次只分析已安装内容清单。', [source.cachePath, ...contexts.servers.map((server) => server.path)], [], { confidence: 'unverified', impact: '无法准确判断哪些 MOD 会同时加载，因此依赖、顺序和文件覆盖结论不代表某个实际存档或服务器。', action: '后续请选择具体存档或服务器配置后重新分析。', rule: 'CONTEXT-EXPLICIT' }))
  } else if (selectedContext.missingModIds.length) {
    issues.push(issue('active-mods-missing', 'blocker', selectedContext.kind, '当前分析对象引用了缺失 MOD', `${selectedContext.missingModIds.length} 个 Mod ID 在已扫描内容中没有对应目录。`, [selectedContext.path, ...selectedContext.missingModIds], selectedContext.missingModIds, { impact: `“${selectedContext.name}”不能按配置完整加载这些 MOD。`, action: '恢复缺失的 Workshop 项目或本地 MOD；也可以从该存档/服务器配置中移除对应 Mod ID。', rule: 'CONTEXT-MOD-PRESENT' }))
  } else {
    issues.push(issue('active-mods-resolved', 'pass', selectedContext.kind, '启用列表中的 Mod ID 均可解析', `${activeOrder.length} 个不重复 Mod ID 均在当前内容中找到。`, [selectedContext.path], [], { rule: 'CONTEXT-MOD-PRESENT' }))
  }

  for (const server of contexts.servers) {
    if (server.missingModIds.length || server.missingWorkshopIds.length) {
      const isSelected = selectedContext?.path === server.path
      issues.push(issue(`server-missing-${server.name}`, isSelected ? 'blocker' : 'warning', 'server', `服务器配置“${server.name}”引用了缺失内容`, `缺少 ${server.missingModIds.length} 个 Mod ID、${server.missingWorkshopIds.length} 个 Workshop 项目。${isSelected ? '' : ' 该配置不属于本次主要分析范围。'}`, [server.path, ...server.missingModIds, ...server.missingWorkshopIds], server.missingModIds, { confidence: 'confirmed', appliesToScope: isSelected, impact: isSelected ? '当前服务器配置不能完整加载。' : '只影响这个服务器配置，不代表当前存档或其他服务器有问题。', action: '恢复对应 Workshop 项目和 Mod ID，或修正该服务器配置。', rule: 'SERVER-CONTENT-PRESENT' }))
    }
  }

  const byId = new Map<string, ResolvedMod[]>()
  for (const mod of mods) {
    if (mod.resolutionIssue) {
      const isActive = Boolean(mod.record.modId && activeSet.has(mod.record.modId))
      issues.push(issue(`version-layer-missing-${mod.record.key}`, isActive ? 'blocker' : 'warning', 'version', `没有适用于当前游戏的 MOD 内容层：${mod.record.name}`, mod.resolutionIssue, [mod.record.rootPath, ...mod.record.variants], mod.record.modId ? [mod.record.modId] : [], { confidence: 'confirmed', appliesToScope: isActive || selectedContext === null, impact: isActive ? '当前分析对象要求启用该 Mod ID，但游戏版本目录规则找不到可加载内容。' : '该目录目前不会为当前游戏版本提供有效内容。', action: '安装包含 common 或不高于当前游戏版本的对应版本目录；也可以停用该 Mod ID。', rule: 'B42-COMPATIBLE-LAYER' }))
      continue
    }
    if (mod.metadataError) {
      const isActive = Boolean(mod.record.modId && activeSet.has(mod.record.modId))
      issues.push(issue(`metadata-unreadable-${mod.record.key}`, 'unknown', 'version', `无法完整读取 mod.info：${mod.record.name}`, mod.metadataError, [mod.metadataPath ?? mod.record.rootPath], mod.record.modId ? [mod.record.modId] : [], { confidence: 'unverified', appliesToScope: isActive || selectedContext === null, impact: '版本范围、依赖、互斥和加载顺序字段可能没有被完整纳入分析。', action: '检查文件编码、权限和磁盘状态后重新分析。', rule: 'MOD-INFO-READABLE' }))
    }
    if (!mod.record.modId) {
      issues.push(issue(`missing-id-${mod.record.key}`, 'warning', 'dependency', `MOD 元数据缺少 id：${mod.record.name}`, '没有可用于游戏启用列表的运行时 Mod ID。', [mod.record.rootPath], [], { confidence: 'confirmed', appliesToScope: selectedContext === null, impact: '该目录无法与存档或服务器中的 Mod ID 建立可靠对应。', action: '检查所选 B42 版本目录中的 mod.info 是否完整。', rule: 'MOD-ID-PRESENT' }))
      continue
    }
    const group = byId.get(mod.record.modId) ?? []
    group.push(mod)
    byId.set(mod.record.modId, group)
  }
  for (const [modId, group] of byId) {
    if (group.length > 1) {
      const isActive = Boolean(selectedContext && activeSet.has(modId))
      issues.push(issue(`duplicate-${modId}`, isActive ? 'blocker' : 'warning', 'dependency', `多个目录声明同一个 Mod ID：${modId}`, `${group.length} 个目录声明了相同运行时标识。${isActive ? '该 ID 位于当前启用列表中。' : '当前没有证据表明这些目录会同时加载。'}`, group.map((mod) => mod.record.rootPath), [modId], { confidence: 'confirmed', appliesToScope: isActive || selectedContext === null, impact: isActive ? '游戏无法仅凭 Mod ID 明确区分应该加载哪一个目录。' : '如果以后启用该 Mod ID，实际选中的目录可能不明确。', action: '只保留与目标游戏版本对应的一个目录，或核对作者提供的安装说明。', rule: 'MOD-ID-UNIQUE' }))
    }
  }

  for (const mod of mods) {
    const normalizedGroups = new Map<number, string[]>()
    for (const variant of mod.variantKeys) normalizedGroups.set(variant.key, [...(normalizedGroups.get(variant.key) ?? []), variant.name])
    for (const names of normalizedGroups.values()) {
      if (names.length > 1) issues.push(issue(`variant-ambiguous-${mod.record.key}-${names.join('-')}`, 'warning', 'version', `同一版本级别存在多个目录：${mod.record.name}`, `${names.join('、')} 都会归入相同的 major.minor 版本级别。`, [mod.record.rootPath], mod.record.modId ? [mod.record.modId] : [], { confidence: 'confirmed', appliesToScope: selectedContext === null || Boolean(mod.record.modId && activeSet.has(mod.record.modId)), impact: '静态分析无法可靠断言游戏最终采用哪一个同级目录。', action: '按照作者说明只保留一个对应目录，或合并为明确的 major.minor 目录。', rule: 'B42-VARIANT-UNIQUE' }))
    }
  }

  const versionKey = gameVersionKey(source.identity.version)
  const hasSelectedContext = selectedContext !== null
  const chosenMods = (hasSelectedContext ? mods.filter((mod) => mod.record.modId && activeSet.has(mod.record.modId)) : mods).filter((mod) => !mod.resolutionIssue)
  const chosenById = new Map(chosenMods.flatMap((mod) => mod.record.modId ? [[mod.record.modId, mod] as const] : []))
  const dependencies = new Map<string, string[]>()
  for (const mod of chosenMods) {
    const id = mod.record.modId
    if (!id) continue
    dependencies.set(id, mod.record.require)
    const min = mod.record.versionMin ? gameVersionKey(mod.record.versionMin) : -1
    const max = mod.record.versionMax ? gameVersionKey(mod.record.versionMax) : -1
    if ((mod.record.versionMin && min < 0) || (mod.record.versionMax && max < 0)) {
      issues.push(issue(`version-bound-invalid-${id}`, 'unknown', 'version', `无法解析 ${id} 的版本范围`, `mod.info 声明为 ${mod.record.versionMin ?? '不限'} ～ ${mod.record.versionMax ?? '不限'}。`, [mod.record.rootPath], [id], { confidence: 'unverified', impact: '无法利用作者声明判断该 MOD 是否支持当前游戏版本。', action: '检查 mod.info 的 versionMin/versionMax 格式，或查阅作者说明。', rule: 'MOD-VERSION-RANGE-PARSEABLE' }))
    } else if (versionKey < 0) {
      issues.push(issue(`version-bound-game-unknown-${id}`, 'unknown', 'version', `无法核对 ${id} 的版本范围`, `没有取得可比较的游戏 major.minor 版本。`, [mod.record.rootPath], [id], { confidence: 'unverified', impact: '不能确认作者声明的版本范围是否覆盖当前游戏。', action: '先修复游戏身份识别，再重新分析。', rule: 'GAME-VERSION-PARSEABLE' }))
    } else if ((min >= 0 && versionKey < min) || (max >= 0 && versionKey > max)) {
      issues.push(issue(`version-bound-${id}`, 'blocker', 'version', `作者声明的版本范围不包含当前游戏：${id}`, `当前游戏 ${source.identity.version}；mod.info 声明 ${mod.record.versionMin ?? '不限'} ～ ${mod.record.versionMax ?? '不限'}。`, [mod.record.rootPath], [id], { confidence: 'confirmed', impact: '游戏会把该 MOD 视为不适用于当前版本，或该 MOD 可能依赖其他版本的接口。', action: '安装适用于当前游戏版本的 MOD 变体。', rule: 'MOD-VERSION-RANGE' }))
    }
    for (const required of mod.record.require) {
      if (!hasSelectedContext ? !chosenById.has(required) : !activeSet.has(required)) {
        issues.push(issue(`missing-dependency-${id}-${required}`, 'blocker', 'dependency', `依赖未满足：${id} 需要 ${required}`, chosenById.has(required) ? '依赖目录已安装，但没有出现在当前启用列表中。' : '当前扫描内容中没有找到依赖目录。', [mod.record.rootPath], [id, required], { confidence: 'confirmed', impact: `${id} 不能按 mod.info 声明的前置条件加载。`, action: `安装并启用 ${required}，或停用 ${id}。`, rule: 'MOD-REQUIRE-SATISFIED' }))
      }
    }
  }

  for (const cycle of findDependencyCycles([...chosenById.keys()], dependencies)) {
    issues.push(issue(`dependency-cycle-${cycle.join('-')}`, 'blocker', 'dependency', '依赖关系形成闭环', cycle.join(' → '), cycle, cycle, { confidence: 'confirmed', impact: '这些 MOD 无法形成有效的先后依赖顺序。', action: '更新相关 MOD，或停用闭环中的至少一个 MOD。', rule: 'MOD-DEPENDENCY-ACYCLIC' }))
  }

  const activeIndex = new Map(activeOrder.map((id, index) => [id, index]))
  const seenPairs = new Set<string>()
  for (const mod of chosenMods) {
    const id = mod.record.modId
    if (!id) continue
    for (const incompatible of mod.record.incompatible) {
      if (!chosenById.has(incompatible)) continue
      const pair = [id, incompatible].sort().join('|')
      if (seenPairs.has(pair)) continue
      seenPairs.add(pair)
      issues.push(issue(`incompatible-${pair}`, 'blocker', 'conflict', `作者声明互斥的 MOD 同时启用：${id} / ${incompatible}`, '至少一个 mod.info 明确把另一个 Mod ID 列入 incompatible。', [mod.record.rootPath], [id, incompatible], { confidence: 'confirmed', impact: '这是 MOD 作者提供的明确互斥声明。', action: `在当前配置中只保留 ${id} 或 ${incompatible} 其中一个。`, rule: 'MOD-INCOMPATIBLE' }))
    }
    if (activeSet.size) {
      const current = activeIndex.get(id) ?? -1
      const requiredBefore = unique([...mod.record.require, ...mod.record.loadAfter])
      for (const before of requiredBefore) {
        const target = activeIndex.get(before)
        if (target !== undefined && target > current) issues.push(issue(`order-after-${id}-${before}`, 'warning', 'load-order', `启用列表顺序与声明不同：${id}`, `${id} 在列表中位于 ${before} 之前，但 mod.info 要求它在 ${before} 之后。`, [selectedContext!.path], [id, before], { confidence: 'inferred', impact: '游戏可能重排加载顺序；如果没有正确重排，后加载覆盖关系会与作者预期不同。', action: `将 ${before} 放在 ${id} 前面，或按 MOD 作者给出的排序说明调整。`, rule: 'MOD-LOAD-AFTER' }))
      }
      for (const after of mod.record.loadBefore) {
        const target = activeIndex.get(after)
        if (target !== undefined && target < current) issues.push(issue(`order-before-${id}-${after}`, 'warning', 'load-order', `启用列表顺序与声明不同：${id}`, `${id} 在列表中位于 ${after} 之后，但 mod.info 要求它在 ${after} 之前。`, [selectedContext!.path], [id, after], { confidence: 'inferred', impact: '游戏可能重排加载顺序；如果没有正确重排，后加载覆盖关系会与作者预期不同。', action: `将 ${id} 放在 ${after} 前面，或按 MOD 作者给出的排序说明调整。`, rule: 'MOD-LOAD-BEFORE' }))
      }
    }
  }

  const tileNumbers = new Map<number, Set<string>>()
  for (const mod of chosenMods) for (const tile of mod.tileDefinitions) {
    const owners = tileNumbers.get(tile.number) ?? new Set<string>()
    owners.add(mod.record.modId ?? mod.record.name)
    tileNumbers.set(tile.number, owners)
  }
  for (const [number, owners] of tileNumbers) if (owners.size > 1) {
    issues.push(issue(`tiledef-${number}`, 'blocker', 'conflict', `重复 tiledef 编号：${number}`, `${[...owners].join('、')} 使用相同 tiledef 文件编号。`, [`tiledef=${number}`], [...owners], { confidence: 'confirmed', impact: '游戏无法为两个不同 MOD 同时使用同一个 tiledef 编号，可能导致图块映射错误。', action: '升级相关 MOD，或在当前组合中只保留其中一个；不要自行改号，除非同时重建对应图块资源。', rule: 'TILEDEF-NUMBER-UNIQUE' }))
  }

  const files = await analyzeFiles(chosenMods, source.gamePath)
  for (const [classification, severityCounts] of files.classificationSeverityCounts) for (const [severity, count] of severityCounts) {
    const examples = files.overlaps.filter((overlap) => overlap.classification === classification && overlap.severity === severity).slice(0, 8)
    const translationUnparsed = classification === 'translation' && severity === 'unknown'
    issues.push(issue(`overlaps-${classification}-${severity}`, severity, classification === 'binary' ? 'security' : 'files', `${count} 个 ${classification} 路径需要进一步处理`, translationUnparsed ? '至少一个文件无法解析为支持的翻译键值格式，因此没有推断键冲突。' : classification === 'translation' ? '已解析翻译键，并确认存在同键不同值。' : '已确认路径相同且文件哈希不同；静态扫描不能仅凭这一事实断言运行时一定冲突。', examples.flatMap((overlap) => [`${overlap.relativePath} ← ${overlap.modIds.join(', ')}`, ...(overlap.semanticEvidence ?? [])]), unique(examples.flatMap((overlap) => overlap.modIds)), { confidence: classification === 'translation' ? severity === 'warning' ? 'confirmed' : 'unverified' : 'inferred', impact: classification === 'asset' ? '加载顺序会决定最终显示的资源，可能只是外观覆盖。' : classification === 'lua' ? 'Lua 的实际影响取决于运行时事件、模块和函数实现，需要进一步语义分析。' : translationUnparsed ? '当前证据不足以判断这些翻译容器是否包含同键不同值。' : classification === 'translation' ? '相同翻译键被赋予不同文字，最终显示内容可能受加载顺序影响。' : '后加载内容可能替代先加载内容，是否有害取决于文件语义。', action: translationUnparsed ? '检查文件编码和语法，或手工比较其中的翻译键。' : classification === 'translation' ? '核对列出的冲突键和 MOD 预期；如果是翻译补丁，应让补丁在原 MOD 之后加载。' : '先查看示例路径和涉及 MOD；只有出现运行症状或作者明确说明时才判定为真实冲突。', rule: `FILE-OVERLAP-${classification.toUpperCase()}` }))
  }
  if (files.identicalOverlapCount) issues.push(issue('identical-overlaps', 'pass', 'files', '同路径但内容完全相同的文件已排除风险', `${files.identicalOverlapCount} 个重叠路径的 SHA-256 完全一致，没有作为冲突报告。`, [], [], { confidence: 'confirmed', rule: 'FILE-OVERLAP-HASH-EQUALITY' }))
  if (files.semanticSafeTranslationCount) issues.push(issue('translation-keys-disjoint', 'pass', 'files', '翻译容器的键互不冲突', `${files.semanticSafeTranslationCount} 个同路径翻译文件虽然字节不同，但解析后没有发现同键不同值。`, [], [], { confidence: 'confirmed', rule: 'FILE-TRANSLATION-KEYS-DISJOINT' }))
  if (files.baseOverrideCount) issues.push(issue('base-overrides', 'unknown', 'files', '检测到 MOD 使用了原版已有路径', `${files.baseOverrideCount} 个有效路径同时存在于游戏目录；这只是覆盖事实，不足以证明不兼容。`, [source.gamePath], [], { confidence: 'confirmed', impact: '可能是有意修改原版资源，也可能在游戏更新后需要适配。', action: '结合具体路径、MOD 说明和实际运行日志判断；不要仅凭数量删除 MOD。', rule: 'BASE-PATH-OVERRIDE' }))
  const scopedCatalogMods = hasSelectedContext ? modCatalog.mods.filter((mod) => mod.active) : modCatalog.mods
  const scopedCatalogIds = new Set(scopedCatalogMods.map((mod) => mod.catalogId))
  const catalogById = new Map(modCatalog.mods.map((mod) => [mod.catalogId, mod]))
  const javaArchives = scopedCatalogMods.flatMap((mod) => mod.content.javaArchives.map((archive) => ({ mod, archive })))
  const divergentClasses = Object.entries(modCatalog.indexes.javaClassOwners).flatMap(([className, owners]) => {
    const scopedOwners = selectEffectiveJavaClassOwners(owners.filter((owner) => scopedCatalogIds.has(owner.catalogId)), modCatalog.javaRuntime?.major ?? null)
    return new Set(scopedOwners.map((owner) => owner.catalogId)).size > 1 && new Set(scopedOwners.map((owner) => owner.sha256)).size > 1 ? [{ className, owners: scopedOwners }] : []
  })
  const identicalSharedClasses = Object.values(modCatalog.indexes.javaClassOwners).filter((owners) => {
    const scopedOwners = selectEffectiveJavaClassOwners(owners.filter((owner) => scopedCatalogIds.has(owner.catalogId)), modCatalog.javaRuntime?.major ?? null)
    return new Set(scopedOwners.map((owner) => owner.catalogId)).size > 1 && new Set(scopedOwners.map((owner) => owner.sha256)).size === 1
  }).length
  if (divergentClasses.length) {
    const examples = divergentClasses.slice(0, 20)
    issues.push(issue('java-class-divergence', 'warning', 'security', `${divergentClasses.length} 个 Java 类由多个启用 MOD 提供且内容不同`, '已确认当前 Java 运行时会选择的同名 Class SHA-256 不同；最终行为取决于类加载器顺序，不能仅凭重复断言哪个 MOD 有错。', examples.flatMap(({ className, owners }) => [className, ...owners.map((owner) => `${catalogById.get(owner.catalogId)?.modId ?? catalogById.get(owner.catalogId)?.name ?? owner.catalogId} · ${owner.archivePath} · ${owner.sha256}`)]), unique(examples.flatMap(({ owners }) => owners.flatMap((owner) => catalogById.get(owner.catalogId)?.modId ? [catalogById.get(owner.catalogId)!.modId!] : []))), { confidence: 'confirmed', impact: '如果这些 JAR 同时进入同一类加载器，先被加载的实现可能遮蔽另一个版本。', action: '核对列出的类属于有意捆绑的相同依赖，还是两个 MOD 的不同补丁；不要仅凭数量删除 MOD。', rule: 'JAVA-CLASS-OWNER-UNIQUE' }))
  }
  if (identicalSharedClasses) issues.push(issue('java-class-identical', 'pass', 'security', '跨 MOD 重复 Java 类内容一致', `${identicalSharedClasses} 个类虽然由多个 MOD 提供，但逐类 SHA-256 完全相同。`, [], [], { confidence: 'confirmed', rule: 'JAVA-CLASS-HASH-EQUALITY' }))
  const mixinArchives = javaArchives.filter(({ archive }) => archive.mixinFrameworks.length)
  if (mixinArchives.length) issues.push(issue('java-mixin-detected', 'unknown', 'security', '检测到 Java Mixin 静态痕迹', `${mixinArchives.length} 个 JAR 引用了 Mixin 框架；这说明它们可能修改游戏类，但不证明补丁一定执行或互相冲突。`, mixinArchives.flatMap(({ mod, archive }) => [`${mod.modId ?? mod.name} · ${archive.relativePath} · ${archive.mixinFrameworks.join('、')}`, ...archive.mixinTargets.slice(0, 8)]), unique(mixinArchives.flatMap(({ mod }) => mod.modId ? [mod.modId] : [])), { confidence: 'inferred', impact: 'Mixin 目标随游戏 revision 变化时可能失效；多个补丁命中同一目标时需要运行日志确认。', action: '游戏更新后核对启动日志中的 Mixin/类加载错误，并优先使用作者声明支持当前 Build 的版本。', rule: 'JAVA-MIXIN-STATIC-EVIDENCE' }))
  const nativeMethodArchives = javaArchives.filter(({ archive }) => archive.nativeMethods > 0)
  if (nativeMethodArchives.length) issues.push(issue('java-native-methods', 'unknown', 'security', 'JAR 声明了 native 方法', `${nativeMethodArchives.reduce((sum, entry) => sum + entry.archive.nativeMethods, 0)} 个方法需要 JVM 之外的本地实现；静态 Class 解析无法验证其运行环境。`, nativeMethodArchives.map(({ mod, archive }) => `${mod.modId ?? mod.name} · ${archive.relativePath} · ${archive.nativeMethods} 个 native 方法`), unique(nativeMethodArchives.flatMap(({ mod }) => mod.modId ? [mod.modId] : [])), { confidence: 'confirmed', impact: '缺少对应本地库或架构不匹配时可能在运行时失败。', action: '核对 MOD 是否同时提供当前系统所需的本地库，并通过实际启动日志验证。', rule: 'JAVA-NATIVE-METHOD' }))
  const unsupportedClasses = modCatalog.javaRuntime ? javaArchives.flatMap(({ mod, archive }) => archive.definedClasses.filter((definition) => {
    if (definition.release !== null && (!archive.manifest.multiRelease || definition.release > modCatalog.javaRuntime!.major)) return false
    return definition.majorVersion > modCatalog.javaRuntime!.classMajor
  }).map((definition) => ({ mod, archive, definition }))) : []
  if (unsupportedClasses.length) issues.push(issue('java-class-version-unsupported', 'warning', 'security', `${unsupportedClasses.length} 个可能生效的 Class 高于游戏 Java 版本`, `游戏自带 Java ${modCatalog.javaRuntime!.version}（最高 Class ${modCatalog.javaRuntime!.classMajor}），这些条目使用了更高版本。`, unsupportedClasses.slice(0, 30).map(({ mod, archive, definition }) => `${mod.modId ?? mod.name} · ${archive.relativePath} · ${definition.entryPath} · Class ${definition.majorVersion}`), unique(unsupportedClasses.flatMap(({ mod }) => mod.modId ? [mod.modId] : [])), { confidence: 'confirmed', impact: '如果游戏加载这些类，JVM 会拒绝其 Class 版本；仅位于未生效多版本目录的类已排除。', action: '安装面向游戏内置 Java 版本编译的 MOD，或向作者确认兼容构建。', rule: 'JAVA-CLASS-VERSION' }))
  if (javaArchives.length && !javaArchives.some(({ archive }) => archive.completeness === 'partial')) issues.push(issue('java-archives-parsed', 'pass', 'security', 'JAR 内部静态证据已完整建立', `${javaArchives.length} 个 JAR 共解析 ${javaArchives.reduce((sum, entry) => sum + entry.archive.classes, 0)} 个 Class、${javaArchives.reduce((sum, entry) => sum + entry.archive.projectZomboidClasses.length, 0)} 个 PZ API 类引用。`, javaArchives.flatMap(({ mod, archive }) => [`${mod.modId ?? mod.name} · Class ${archive.classes} · Java major ${archive.minimumClassMajor ?? '?'}～${archive.maximumClassMajor ?? '?'}`]), [], { confidence: 'confirmed', rule: 'JAVA-ARCHIVE-STATIC-COVERAGE' }))
  if (files.binaryModIds.length) issues.push(issue('binary-mods', 'unknown', 'security', '检测到 Java 或本地二进制扩展', '已建立文件哈希和可读取 JAR 的内部静态证据，但静态分析仍不能证明代码来源可信或运行时兼容。', files.binaryModIds, files.binaryModIds, { confidence: 'unverified', impact: '它们可能随游戏 revision 变化而失效，也具备普通 Lua MOD 之外的系统权限风险。', action: '只使用可信来源、优先选择可复现或开源构建，并在每次游戏更新后核对实际启动日志。', rule: 'BINARY-MOD-MANUAL-TRUST' }))
  const contentCoverageComplete = !selectedContext || (selectedContext.missingModIds.length === 0 && selectedContext.missingWorkshopIds.length === 0)
  if (!issues.some((entry) => entry.appliesToScope && entry.category === 'dependency' && entry.severity === 'blocker')) {
    issues.push(contentCoverageComplete
      ? issue('dependency-pass', 'pass', 'dependency', '当前分析范围的依赖图没有阻断项', '未发现缺失依赖、循环依赖或正在启用的重复 Mod ID。', [], [], { rule: 'DEPENDENCY-GRAPH-COMPLETE' })
      : issue('dependency-coverage-incomplete', 'unknown', 'dependency', '依赖图只覆盖了当前能找到的 MOD', `${selectedContext!.missingModIds.length} 个缺失 Mod ID 没有 mod.info，无法检查它们自己的依赖、互斥和加载顺序。`, [selectedContext!.path], selectedContext!.missingModIds, { confidence: 'unverified', impact: '“没有发现额外依赖错误”不能解释为整个启用列表已经通过。', action: '先恢复缺失 MOD，再重新运行兼容性分析。', rule: 'DEPENDENCY-GRAPH-COVERAGE' }))
  }
  if (!issues.some((entry) => entry.id.startsWith('tiledef-'))) {
    issues.push(contentCoverageComplete
      ? issue('tiledef-pass', 'pass', 'conflict', 'tiledef 编号未发现重复', `检查了 ${tileNumbers.size} 个有效编号。`, [], [], { rule: 'TILEDEF-NUMBER-UNIQUE' })
      : issue('tiledef-coverage-incomplete', 'unknown', 'conflict', 'tiledef 检查没有覆盖缺失 MOD', `已检查当前可读取的 ${tileNumbers.size} 个编号；缺失 MOD 的编号未知。`, [selectedContext!.path], selectedContext!.missingModIds, { confidence: 'unverified', impact: '当前结果不能排除缺失 MOD 恢复后出现 tiledef 编号重复。', action: '恢复缺失 MOD 后重新分析。', rule: 'TILEDEF-COVERAGE' }))
  }

  issues.sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.title.localeCompare(right.title, 'zh-CN'))
  const scopedIssues = issues.filter((entry) => entry.appliesToScope)
  const blockers = scopedIssues.filter((entry) => entry.severity === 'blocker').length
  const warnings = scopedIssues.filter((entry) => entry.severity === 'warning').length
  const unknowns = scopedIssues.filter((entry) => entry.severity === 'unknown').length
  const passes = scopedIssues.filter((entry) => entry.severity === 'pass').length
  const verdict: CompatibilitySeverity = blockers ? 'blocker' : warnings ? 'warning' : unknowns ? 'unknown' : 'pass'
  const plainSummary = blockers
    ? `针对“${scopeLabel}”发现 ${blockers} 个有直接证据的阻断项；处理后才能按该配置完整加载。`
    : warnings
      ? `针对“${scopeLabel}”没有发现明确阻断，但有 ${warnings} 项需要核对。`
      : unknowns
        ? `针对“${scopeLabel}”没有发现明确阻断，但仍有 ${unknowns} 项缺少足够证据。`
        : `针对“${scopeLabel}”的已实现规则均已通过；这不等于能够证明所有运行时行为绝对兼容。`
  await fs.mkdir(source.outputRoot, { recursive: true })
  const reportPath = path.join(source.outputRoot, `latest-${source.source.toLowerCase()}.json`)
  const report: CompatibilityReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: source.source,
    sourceLabel: source.label,
    scopeLabel,
    plainSummary,
    reportPath,
    modCatalog: {
      path: modCatalog.catalogPath,
      digest: modCatalog.catalogDigest,
      completeness: modCatalog.completeness,
      files: modCatalog.summary.files,
      jars: modCatalog.summary.jars,
      classes: modCatalog.summary.classes,
      nativeBinaries: modCatalog.summary.nativeBinaries,
      javaArchivesAnalyzed: modCatalog.summary.javaArchivesAnalyzed,
      javaClasses: modCatalog.summary.javaClasses,
      javaArchiveErrors: modCatalog.summary.javaArchiveErrors,
      duplicateJavaClasses: modCatalog.summary.duplicateJavaClasses,
      javaRuntime: modCatalog.javaRuntime
    },
    identity: source.identity,
    verdict,
    methodology: [
      '从游戏二进制读取实际版本身份，并按 major.minor 选择 B42 MOD 版本目录。',
      '解析 mod.info 的 Mod ID、版本范围、require、incompatible、loadAfter 和 loadBefore。',
      '重建统一 MOD 数据库，对所有实际生效普通文件计算 SHA-256，并单独登记 JAR、Class 与本地二进制。',
      '受限读取 JAR 与 Class 常量池，登记类版本、PZ API 引用、Mixin 痕迹、native 方法和跨 MOD 同名类哈希。',
      '只对当前分析范围内的 MOD 建立依赖图和加载顺序。',
      '对同路径文件计算 SHA-256；内容完全相同的重叠不会作为风险报告。'
    ],
    limitations: [
      selectedContext ? `本报告的主要结论只适用于“${scopeLabel}”。` : '没有唯一启用上下文，因此依赖和覆盖分析只能描述已安装内容，不能代表某个实际存档或服务器。',
      ...(selectedContext?.missingModIds.length ? [`${selectedContext.missingModIds.length} 个缺失 Mod ID 没有文件可供解析；它们的依赖、互斥、tiledef 和文件覆盖不在已完成扫描内。`] : []),
      '静态分析不会执行 Lua、Java 或本地二进制代码；反射、动态类生成、类加载器先后和 Mixin 实际应用仍需运行日志验证。',
      '“同路径且内容不同”是覆盖事实，不等于已经证明发生功能冲突。'
    ],
    summary: {
      installedMods: mods.length,
      activeMods: activeOrder.length,
      workshopProjects: workshopIds.size,
      blockers,
      warnings,
      unknowns,
      passes,
      overlapPaths: files.overlapCount,
      identicalOverlapPaths: files.identicalOverlapCount,
      baseGameOverrides: files.baseOverrideCount
    },
    analysisContext: selectedContext,
    activeContext: contexts.active,
    serverContexts: contexts.servers,
    issues,
    overlaps: files.overlaps,
    mods: mods.map((mod) => mod.record).sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, 'zh-CN'))
  }
  await atomicWriteJsonIfChanged(reportPath, report)
  return report
}
