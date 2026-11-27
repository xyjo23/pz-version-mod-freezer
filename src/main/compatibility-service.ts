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
import { analyzeLuaSemantics } from './lua-analysis'
import { analyzeScriptCollection, analyzeScriptSemantics, type ScriptDefinitionCollectionResult, type ScriptSource } from './script-analysis'
import { atomicWriteJsonIfChanged } from './safe-write'
import { detectSteamInstallation } from './steam-service'
import { collectLayerFiles, discoverLocalMods, discoverWorkshopMods, gameVersionKey, normalizeModId, type ResolvedMod } from './mod-resolver'
import { analyzeTranslationSemantics } from './translation-analysis'
import { getSnapshot } from './vault-service'
import { analyzeVersionImpact } from './version-impact-analysis'

type AnalysisSource = {
  source: 'Steam' | 'Frozen'
  label: string
  gamePath: string
  cachePath: string
  workshopPath: string | null
  buildId: string
  identity: GameIdentity
  outputRoot: string
  managerRoot: string | null
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
      outputRoot,
      managerRoot: snapshot.managerRoot
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
    outputRoot: config.ReportPath || path.join(config.FreezeRoot, 'reports'),
    managerRoot: snapshot.managerRoot ?? config.ManagerRoot ?? null
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
): Promise<{ overlaps: FileOverlap[]; overlapCount: number; identicalOverlapCount: number; semanticSafeTranslationCount: number; semanticSafeScriptCount: number; scriptDefinitions: ScriptDefinitionCollectionResult; classificationSeverityCounts: Map<FileOverlapClassification, Map<CompatibilitySeverity, number>>; baseOverrideCount: number; binaryModIds: string[] }> => {
  const owners = new Map<string, { displayPath: string; modIds: Set<string>; files: string[]; entries: Array<{ modId: string; filePath: string }> }>()
  const scriptSources: ScriptSource[] = []
  const baseOverrides = new Set<string>()
  const binaryModIds = new Set<string>()
  for (const mod of mods) {
    const modId = mod.record.modId ?? mod.record.name
    const files = await collectLayerFiles(mod.layers)
    for (const [normalized, displayPath] of files) {
      const owner = owners.get(normalized) ?? { displayPath, modIds: new Set<string>(), files: [], entries: [] }
      owner.modIds.add(modId)
      const effectiveFile = [...mod.layers].reverse().map((layer) => path.join(layer, displayPath)).find((candidate) => existsSync(candidate))
      if (effectiveFile) {
        owner.files.push(effectiveFile)
        owner.entries.push({ modId, filePath: effectiveFile })
        if (classifyFile(displayPath) === 'scripts') scriptSources.push({ modId, filePath: effectiveFile, relativePath: displayPath })
      }
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
      const luaSemantic = classification === 'lua' && contentIdentical !== true
        ? await analyzeLuaSemantics(owner.entries)
        : null
      const scriptSemantic = classification === 'scripts' && contentIdentical !== true
        ? await analyzeScriptSemantics(owner.entries)
        : null
      const severity: CompatibilitySeverity = contentIdentical === true
        ? 'pass'
        : translationSemantic?.status === 'keys-disjoint'
          ? 'pass'
          : translationSemantic?.status === 'keys-conflict'
            ? 'warning'
            : luaSemantic?.status === 'lua-symbol-conflict'
              ? 'warning'
              : scriptSemantic?.status === 'script-definition-conflict'
                ? 'warning'
                : scriptSemantic?.status === 'script-definitions-identical' || scriptSemantic?.status === 'script-definitions-disjoint'
                  ? 'pass'
                  : scriptSemantic?.status === 'script-unparsed'
                    ? 'unknown'
                    : overlapSeverity(classification)
      return {
        relativePath: owner.displayPath,
        classification,
        severity,
        modIds: [...owner.modIds].sort((left, right) => left.localeCompare(right, 'en')),
        overridesBaseGame: baseOverrides.has(owner.displayPath.toLowerCase()),
        contentIdentical,
        semanticStatus: translationSemantic?.status ?? luaSemantic?.status ?? scriptSemantic?.status,
        semanticEvidence: translationSemantic?.evidence ?? luaSemantic?.evidence ?? scriptSemantic?.evidence
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
  const scriptDefinitions = await analyzeScriptCollection(scriptSources)
  return {
    overlaps: allOverlaps.slice(0, 120),
    overlapCount: allOverlaps.length,
    identicalOverlapCount: allOverlaps.filter((entry) => entry.contentIdentical === true).length,
    semanticSafeTranslationCount: allOverlaps.filter((entry) => entry.semanticStatus === 'keys-disjoint').length,
    semanticSafeScriptCount: allOverlaps.filter((entry) => entry.semanticStatus === 'script-definitions-identical' || entry.semanticStatus === 'script-definitions-disjoint').length,
    scriptDefinitions,
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
  const scriptIndexPath = path.join(catalogBase, 'script-definition-index', `latest-${source.source.toLowerCase()}.json`)
  const scriptIndexCore = {
    schemaVersion: 1 as const,
    source: source.source,
    sourceLabel: source.label,
    scopeLabel,
    game: { version: source.identity.version, revision: source.identity.revision, buildId: source.identity.buildId, jarSha256: source.identity.jarSha256 },
    summary: {
      files: files.scriptDefinitions.files,
      parsedFiles: files.scriptDefinitions.parsedFiles,
      partialFiles: files.scriptDefinitions.partialFiles,
      definitions: files.scriptDefinitions.definitions,
      crossPathConflicts: files.scriptDefinitions.crossPathConflicts.length,
      composableVariations: files.scriptDefinitions.composableVariations.length,
      identicalSharedDefinitions: files.scriptDefinitions.identicalSharedDefinitions
    },
    definitionOwners: Object.entries(files.scriptDefinitions.owners).map(([key, owners]) => ({ key, owners })),
    unparsed: files.scriptDefinitions.unparsed
  }
  const scriptIndexDigest = createHash('sha256').update(JSON.stringify(scriptIndexCore)).digest('hex').toUpperCase()
  await fs.mkdir(path.dirname(scriptIndexPath), { recursive: true })
  await atomicWriteJsonIfChanged(scriptIndexPath, { ...scriptIndexCore, generatedAt: new Date().toISOString(), indexPath: scriptIndexPath, indexDigest: scriptIndexDigest })
  for (const [classification, severityCounts] of files.classificationSeverityCounts) for (const [severity, count] of severityCounts) {
    const examples = files.overlaps.filter((overlap) => overlap.classification === classification && overlap.severity === severity).slice(0, 8)
    const translationUnparsed = classification === 'translation' && severity === 'unknown'
    const luaConflict = classification === 'lua' && severity === 'warning'
    const luaUnparsed = classification === 'lua' && examples.some((overlap) => overlap.semanticStatus === 'lua-unparsed')
    const scriptConflict = classification === 'scripts' && severity === 'warning'
    const scriptUnparsed = classification === 'scripts' && examples.some((overlap) => overlap.semanticStatus === 'script-unparsed')
    const title = luaConflict
      ? `${count} 个 Lua 路径存在同名写入或注册差异`
      : classification === 'lua'
        ? `${count} 个 Lua 同路径组合仍需运行验证`
        : scriptConflict
          ? `${count} 个脚本路径重复定义了同一游戏实体`
          : scriptUnparsed
            ? `${count} 个游戏脚本路径未能完整解析`
        : `${count} 个 ${classification} 路径需要进一步处理`
    const summary = luaConflict
      ? '静态解析确认：多个 MOD 会写入同一全局符号，或用不同内容注册同一个键。'
      : luaUnparsed
        ? '至少一个 Lua 文件没有被完整读取或分词，因此没有推断脚本冲突。'
        : classification === 'lua'
          ? '已解析 require、事件挂接、全局写入和注册项；未把“相同文件名”直接判成冲突。仍有动态调用或重复注册需要实际启动验证。'
          : scriptConflict
            ? '已确认多个 MOD 在相同脚本路径中定义了同一个 module + 实体名，而且定义内容不同。'
            : scriptUnparsed
              ? '至少一个 Project Zomboid 脚本没有被完整读取或解析，因此没有推断实体冲突。'
          : translationUnparsed
            ? '至少一个文件无法解析为支持的翻译键值格式，因此没有推断键冲突。'
            : classification === 'translation'
              ? '已解析翻译键，并确认存在同键不同值。'
              : '已确认路径相同且文件哈希不同；静态扫描不能仅凭这一事实断言运行时一定冲突。'
    issues.push(issue(`overlaps-${classification}-${severity}`, severity, classification === 'binary' ? 'security' : 'files', title, summary, examples.flatMap((overlap) => [`${overlap.relativePath} ← ${overlap.modIds.join(', ')}`, ...(overlap.semanticEvidence ?? [])]), unique(examples.flatMap((overlap) => overlap.modIds)), { confidence: classification === 'translation' ? severity === 'warning' ? 'confirmed' : 'unverified' : luaConflict || scriptConflict ? 'confirmed' : 'inferred', impact: classification === 'asset' ? '加载顺序会决定最终显示的资源，可能只是外观覆盖。' : luaConflict ? '同名全局写入可能互相替换；同一注册键的不同定义可能让最终行为受加载顺序影响。' : classification === 'lua' ? 'Project Zomboid 会分别加载多个 MOD 的 Lua；同路径本身不是证据，真正影响取决于运行时执行分支和注册表如何处理重复项。' : scriptConflict ? '后加载的 item、recipe、vehicle、model 或其他实体定义可能替换先加载定义；也可能是作者设计的扩展补丁。' : scriptUnparsed ? '当前证据不足以判断这些文件是否重复定义了同一游戏实体。' : translationUnparsed ? '当前证据不足以判断这些翻译容器是否包含同键不同值。' : classification === 'translation' ? '相同翻译键被赋予不同文字，最终显示内容可能受加载顺序影响。' : '后加载内容可能替代先加载内容，是否有害取决于文件语义。', action: luaConflict ? '先核对列出的符号或注册键是否是有意补丁，再按作者要求调整加载顺序；若作者未说明，复制存档后实际启动并检查 console.txt。' : classification === 'lua' ? '保留当前组合做一次主菜单和测试存档启动；若异常，只围绕列出的 MOD、注册键与 console.txt 排查，不要仅因文件同名删除 MOD。' : scriptConflict ? '核对报告中的完整实体键和结构摘要。如果其中一个是皮肤包或补丁，让补丁按作者要求后加载；随后用测试存档验证对应物品、配方或车辆。' : scriptUnparsed ? '检查文件编码、注释和大括号是否完整，再重新分析；不要从未完成的解析结果删除 MOD。' : translationUnparsed ? '检查文件编码和语法，或手工比较其中的翻译键。' : classification === 'translation' ? '核对列出的冲突键和 MOD 预期；如果是翻译补丁，应让补丁在原 MOD 之后加载。' : '先查看示例路径和涉及 MOD；只有出现运行症状或作者明确说明时才判定为真实冲突。', rule: `FILE-OVERLAP-${classification.toUpperCase()}` }))
  }
  if (files.scriptDefinitions.crossPathConflicts.length) {
    const examples = files.scriptDefinitions.crossPathConflicts.slice(0, 15)
    issues.push(issue('script-cross-path-conflicts', 'warning', 'files', `${files.scriptDefinitions.crossPathConflicts.length} 个游戏实体在不同脚本路径中被多个 MOD 以不同内容定义`, '全局实体索引按 module 与完整定义头匹配，因此这些冲突不会因为文件名不同而漏掉。', examples.flatMap((entry) => [entry.key, ...entry.owners.slice(0, 8).map((owner) => `${owner.modId} · ${owner.relativePath} · ${owner.summary}`)]), unique(examples.flatMap((entry) => entry.owners.map((owner) => owner.modId))), { confidence: 'confirmed', impact: '游戏脚本管理器最终只能得到该实体的一组生效定义；结果可能受 MOD 加载顺序影响，也可能是有意补丁。', action: '先确认列出的 MOD 是否存在主 MOD/补丁关系；按作者要求排列补丁，并在复制的测试存档中验证对应物品、配方、车辆或模型。', rule: 'PZ-SCRIPT-DEFINITION-UNIQUE-CROSS-PATH' }))
  } else {
    issues.push(issue('script-cross-path-pass', 'pass', 'files', '跨路径脚本实体没有发现不同内容的重复定义', `全局索引检查了 ${files.scriptDefinitions.definitions} 个有效定义。`, [scriptIndexPath, `索引摘要：${scriptIndexDigest}`], [], { confidence: 'confirmed', rule: 'PZ-SCRIPT-DEFINITION-UNIQUE-CROSS-PATH' }))
  }
  if (files.scriptDefinitions.composableVariations.length) {
    const examples = files.scriptDefinitions.composableVariations.slice(0, 10)
    issues.push(issue('script-cross-path-composable', 'unknown', 'files', `${files.scriptDefinitions.composableVariations.length} 个跨路径脚本实体采用扩展式组合定义`, '这些 model/xuiSkin 定义主要向同一实体加入 attachment 或 entity 子块。当前游戏加载方法会读取这些子块，且 Load 方法本身不调用独立 reset；但最终组合仍需运行验证。', examples.flatMap((entry) => [entry.key, ...entry.owners.slice(0, 12).map((owner) => `${owner.modId} · ${owner.relativePath} · ${owner.summary}`)]), unique(examples.flatMap((entry) => entry.owners.map((owner) => owner.modId))), { confidence: 'inferred', impact: '它们通常是有意扩展角色挂点或界面实体；共同设置的基础字段和加载顺序仍可能影响最终结果。', action: '不要仅因同名删除这些 MOD；进入测试存档检查挂点、装备显示或对应界面，并查看 console.txt 是否出现 model/xui 错误。', rule: 'PZ-SCRIPT-COMPOSABLE-DEFINITION' }))
  }
  if (files.scriptDefinitions.partialFiles) {
    issues.push(issue('script-index-partial', 'unknown', 'files', '全局脚本实体索引存在未解析文件', `${files.scriptDefinitions.partialFiles}/${files.scriptDefinitions.files} 个 PZ 脚本没有进入实体索引；报告不会把缺失部分解释为通过。`, files.scriptDefinitions.unparsed.slice(0, 20).flatMap((entry) => [`${entry.modId} · ${entry.relativePath}`, ...entry.errors]), unique(files.scriptDefinitions.unparsed.map((entry) => entry.modId)), { confidence: 'unverified', impact: '这些文件中的实体可能与其他 MOD 重名，但当前没有完整语法证据。', action: '核对列出的文件是否为空占位、说明文本或确有多余大括号/未闭合注释；修复或升级 MOD 后重新分析。', rule: 'PZ-SCRIPT-INDEX-COVERAGE' }))
  } else {
    issues.push(issue('script-index-complete', 'pass', 'files', '全局脚本实体索引覆盖完整', `${files.scriptDefinitions.files} 个脚本均已解析，共建立 ${files.scriptDefinitions.definitions} 个定义。`, [scriptIndexPath, `索引摘要：${scriptIndexDigest}`], [], { confidence: 'confirmed', rule: 'PZ-SCRIPT-INDEX-COVERAGE' }))
  }
  if (files.scriptDefinitions.identicalSharedDefinitions) issues.push(issue('script-cross-path-identical', 'pass', 'files', '跨路径同名脚本实体内容一致', `${files.scriptDefinitions.identicalSharedDefinitions} 个定义由不同 MOD、不同脚本路径共同提供，但语义摘要一致。`, [], [], { confidence: 'confirmed', rule: 'PZ-SCRIPT-DEFINITION-HASH-EQUALITY' }))
  if (files.identicalOverlapCount) issues.push(issue('identical-overlaps', 'pass', 'files', '同路径但内容完全相同的文件已排除风险', `${files.identicalOverlapCount} 个重叠路径的 SHA-256 完全一致，没有作为冲突报告。`, [], [], { confidence: 'confirmed', rule: 'FILE-OVERLAP-HASH-EQUALITY' }))
  if (files.semanticSafeTranslationCount) issues.push(issue('translation-keys-disjoint', 'pass', 'files', '翻译容器的键互不冲突', `${files.semanticSafeTranslationCount} 个同路径翻译文件虽然字节不同，但解析后没有发现同键不同值。`, [], [], { confidence: 'confirmed', rule: 'FILE-TRANSLATION-KEYS-DISJOINT' }))
  if (files.semanticSafeScriptCount) issues.push(issue('script-definitions-disjoint', 'pass', 'files', '同路径游戏脚本没有实体定义冲突', `${files.semanticSafeScriptCount} 个同路径脚本虽然字节不同，但 module 与实体定义键互不冲突或定义内容一致。`, [], [], { confidence: 'confirmed', rule: 'PZ-SCRIPT-DEFINITIONS-DISJOINT' }))
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
  const versionImpactPath = path.join(catalogBase, 'version-impact', `latest-${source.source.toLowerCase()}.json`)
  const scriptKeysByMod = new Map<string, string[]>()
  for (const [key, owners] of Object.entries(files.scriptDefinitions.owners)) for (const owner of owners) {
    scriptKeysByMod.set(owner.modId, [...new Set([...(scriptKeysByMod.get(owner.modId) ?? []), key])])
  }
  const versionImpact = source.managerRoot ? await analyzeVersionImpact({
    managerRoot: source.managerRoot,
    currentGamePath: source.gamePath,
    current: source.identity,
    reportPath: versionImpactPath,
    mods: scopedCatalogMods.map((mod) => ({
      id: mod.modId ?? mod.name,
      files: mod.content.files.map((file) => ({ relativePath: file.relativePath, sha256: file.sha256, kind: file.kind })),
      scriptDefinitionKeys: scriptKeysByMod.get(mod.modId ?? mod.name) ?? [],
      projectZomboidClasses: unique(mod.content.javaArchives.flatMap((archive) => archive.projectZomboidClasses))
    }))
  }) : null
  if (!versionImpact) {
    issues.push(issue('version-impact-no-baseline', 'unknown', 'version', '没有可用的旧版本基线', '管理目录中没有找到低于当前游戏版本且文件完整的冻结版，因此不能判断这次更新具体影响了哪些 MOD 接口。', source.managerRoot ? [path.join(source.managerRoot, 'frozen')] : [], [], { confidence: 'unverified', impact: '当前报告仍能检查本版本内的依赖和冲突，但缺少跨版本变化证据。', action: '保留一个更新前冻结版后重新分析；不要把缺少基线解释为兼容通过。', rule: 'VERSION-IMPACT-BASELINE' }))
  } else {
    const impacted = versionImpact.scriptDefinitions.affectedByMods
    if (impacted.length) issues.push(issue('version-impact-script-definitions', 'warning', 'version', `${impacted.length} 个 MOD 脚本实体与本次原版改动相交`, `从 ${versionImpact.baseline.version} 到 ${versionImpact.current.version}，这些原版实体已更改或移除，同时当前 MOD 仍定义同一个实体键。`, impacted.slice(0, 20).flatMap((entry) => [`${entry.key} ← ${entry.mods.join('、')}`, `旧：${entry.baseline ?? '无'}`, `新：${entry.current ?? '已移除'}`]), unique(impacted.flatMap((entry) => entry.mods)), { confidence: 'confirmed', impact: 'MOD 可能仍以旧版字段、默认值或结构为基础，加载顺序也可能遮蔽新版原版修复。', action: '优先升级列出的 MOD；在复制存档中验证对应物品、配方、车辆或模型，并检查 console.txt。', rule: 'VERSION-IMPACT-SCRIPT-INTERSECTION' }))
    else issues.push(issue('version-impact-script-pass', 'pass', 'version', '原版脚本变化没有命中当前 MOD 的同名实体', `两版共发现 ${versionImpact.summary.scriptDefinitionsChanged + versionImpact.summary.scriptDefinitionsRemoved} 个更改或移除的原版实体，未与当前分析范围 MOD 的实体键相交。`, [versionImpact.reportPath, `报告摘要：${versionImpact.reportDigest}`], [], { confidence: 'confirmed', rule: 'VERSION-IMPACT-SCRIPT-INTERSECTION' }))
    const overrideChanges = [...versionImpact.overriddenBaseFiles.changed, ...versionImpact.overriddenBaseFiles.removed]
    const exactOldCopies = overrideChanges.filter((entry) => entry.staleCopyMods?.length)
    if (exactOldCopies.length) issues.push(issue('version-impact-base-overrides-stale-copy', 'warning', 'version', `${exactOldCopies.length} 个 MOD 文件是更新前原版文件的精确副本`, 'MOD 文件 SHA-256 与旧版原版完全相同，而新版原版已变化或移除；这是旧版整文件副本的直接证据。', exactOldCopies.slice(0, 24).map((entry) => `${entry.key} ← ${entry.staleCopyMods!.join('、')} · ${entry.baseline}`), unique(exactOldCopies.flatMap((entry) => entry.staleCopyMods ?? [])), { confidence: 'confirmed', impact: '加载该副本时可能重新带回旧版实现并遮蔽新版修复。', action: '优先升级列出的 MOD；不要手工合并代码，在复制存档中验证后再用于正式存档。', rule: 'VERSION-IMPACT-EXACT-OLD-BASE-COPY' }))
    const unresolvedOverrides = overrideChanges.filter((entry) => !entry.staleCopyMods?.length)
    if (unresolvedOverrides.length) issues.push(issue('version-impact-base-overrides-changed', 'unknown', 'version', `${unresolvedOverrides.length} 个 MOD 同路径原版文件在新版发生变化`, '路径和两版原版 SHA-256 已确认，但 MOD 内容不是旧版原文件的精确副本；翻译容器、Lua 加载和特殊索引可能是合并或有意修改，不能仅凭同路径判冲突。', unresolvedOverrides.slice(0, 24).map((entry) => `${entry.key} · ${entry.kinds?.join('/')} ← ${entry.mods.join('、')}`), unique(unresolvedOverrides.flatMap((entry) => entry.mods)), { confidence: 'confirmed', impact: '其中可能有需要适配的覆盖，也可能完全不受影响；现有静态证据不能统一判定。', action: '先查看具体路径和 MOD 当前版本说明；对 Lua/界面修改重点检查启动日志和复制存档，不要按数量批量删除 MOD。', rule: 'VERSION-IMPACT-BASE-PATH-CHANGED' }))
    if (!overrideChanges.length) issues.push(issue('version-impact-overrides-pass', 'pass', 'version', 'MOD 同路径原版文件在两版间未发生变化', `核对了 ${versionImpact.summary.overriddenBaseFilesChecked} 个实际存在于至少一个原版中的 MOD 路径。`, [versionImpact.reportPath], [], { confidence: 'confirmed', rule: 'VERSION-IMPACT-BASE-FILE-HASH' }))
    if (versionImpact.javaApi.removed.length) issues.push(issue('version-impact-java-removed', 'warning', 'version', `${versionImpact.javaApi.removed.length} 个 MOD 引用的游戏 Java 类已移除`, 'JAR 常量池中存在这些 zombie/* 类引用，但新版 projectzomboid.jar 已找不到同名 Class。', versionImpact.javaApi.removed.slice(0, 30).map((entry) => `${entry.key} ← ${entry.mods.join('、')}`), unique(versionImpact.javaApi.removed.flatMap((entry) => entry.mods)), { confidence: 'confirmed', impact: '如果运行路径加载这些引用，可能出现 ClassNotFound、NoClassDefFound 或链接错误。', action: '升级对应 Java MOD，并在启动日志中核对类加载错误；不要手动从旧版复制 Class。', rule: 'VERSION-IMPACT-JAVA-CLASS-REMOVED' }))
    if (versionImpact.javaApi.changed.length) issues.push(issue('version-impact-java-changed', 'unknown', 'version', `${versionImpact.javaApi.changed.length} 个 MOD 引用的游戏 Java 类内容已变化`, '逐 Class SHA-256 已确认变化，但仅凭字节变化不能判断公开方法签名或运行行为是否破坏兼容。', versionImpact.javaApi.changed.slice(0, 30).map((entry) => `${entry.key} ← ${entry.mods.join('、')}`), unique(versionImpact.javaApi.changed.flatMap((entry) => entry.mods)), { confidence: 'confirmed', impact: '内部字段、方法或行为可能变化，也可能只是不会影响该 MOD 的实现调整。', action: '核对 MOD 的当前 Build 支持声明，并通过实际启动日志验证；本项不会被误写成确定冲突。', rule: 'VERSION-IMPACT-JAVA-CLASS-CHANGED' }))
    if (versionImpact.javaApi.unresolved.length) issues.push(issue('version-impact-java-unresolved', 'unknown', 'version', `${versionImpact.javaApi.unresolved.length} 个 MOD 静态引用未在两版主游戏 JAR 中找到`, '这些 zombie/* 名称同时不在两版 projectzomboid.jar；它们可能来自其他运行时 JAR、动态生成或无效引用，不能当作两版内容一致。', versionImpact.javaApi.unresolved.slice(0, 30).map((entry) => `${entry.key} ← ${entry.mods.join('、')}`), unique(versionImpact.javaApi.unresolved.flatMap((entry) => entry.mods)), { confidence: 'confirmed', impact: '当前主 JAR 对比无法说明这些引用的跨版本状态。', action: '核对游戏其他 JAR 和启动日志；不要把本项解释为类已移除。', rule: 'VERSION-IMPACT-JAVA-CLASS-UNRESOLVED' }))
    if (!versionImpact.javaApi.changed.length && !versionImpact.javaApi.removed.length && !versionImpact.javaApi.unresolved.length && versionImpact.summary.javaClassesChecked) issues.push(issue('version-impact-java-pass', 'pass', 'version', 'MOD 引用的游戏 Java 类在两版间内容一致', `逐类核对了 ${versionImpact.summary.javaClassesChecked} 个当前 JAR 静态引用。`, [versionImpact.reportPath], [], { confidence: 'confirmed', rule: 'VERSION-IMPACT-JAVA-CLASS-HASH' }))
    if (versionImpact.completeness === 'partial') issues.push(issue('version-impact-partial', 'unknown', 'version', '版本更新影响报告存在未读取证据', '部分脚本、覆盖文件或 JAR 没有完成读取，因此未把未覆盖范围解释为通过。', [...versionImpact.scriptDefinitions.errors, ...versionImpact.overriddenBaseFiles.errors, ...versionImpact.javaApi.errors].slice(0, 30), [], { confidence: 'unverified', impact: '未完成部分可能仍包含跨版本影响。', action: '按证据修复不可读文件或损坏 JAR，再重新运行分析。', rule: 'VERSION-IMPACT-COVERAGE' }))
  }
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
    scriptDefinitions: {
      path: scriptIndexPath,
      digest: scriptIndexDigest,
      files: files.scriptDefinitions.files,
      parsedFiles: files.scriptDefinitions.parsedFiles,
      partialFiles: files.scriptDefinitions.partialFiles,
      definitions: files.scriptDefinitions.definitions,
      crossPathConflicts: files.scriptDefinitions.crossPathConflicts.length,
      composableVariations: files.scriptDefinitions.composableVariations.length,
      identicalSharedDefinitions: files.scriptDefinitions.identicalSharedDefinitions
    },
    versionImpact: versionImpact ? {
      path: versionImpact.reportPath,
      digest: versionImpact.reportDigest,
      completeness: versionImpact.completeness,
      baselineVersion: versionImpact.baseline.version,
      baselineBuildId: versionImpact.baseline.buildId,
      currentVersion: versionImpact.current.version,
      currentBuildId: versionImpact.current.buildId,
      scriptDefinitionsChanged: versionImpact.summary.scriptDefinitionsChanged + versionImpact.summary.scriptDefinitionsRemoved,
      modScriptDefinitionsAffected: versionImpact.summary.modScriptDefinitionsAffected,
      overriddenBaseFilesChanged: versionImpact.summary.overriddenBaseFilesChanged + versionImpact.summary.overriddenBaseFilesRemoved,
      exactOldBaseCopies: versionImpact.summary.exactOldBaseCopies,
      javaClassesChanged: versionImpact.summary.javaClassesChanged,
      javaClassesRemoved: versionImpact.summary.javaClassesRemoved,
      javaClassesUnresolved: versionImpact.summary.javaClassesUnresolved
    } : undefined,
    identity: source.identity,
    verdict,
    methodology: [
      '从游戏二进制读取实际版本身份，并按 major.minor 选择 B42 MOD 版本目录。',
      '解析 mod.info 的 Mod ID、版本范围、require、incompatible、loadAfter 和 loadBefore。',
      '重建统一 MOD 数据库，对所有实际生效普通文件计算 SHA-256，并单独登记 JAR、Class 与本地二进制。',
      '受限读取 JAR 与 Class 常量池，登记类版本、PZ API 引用、Mixin 痕迹、native 方法和跨 MOD 同名类哈希。',
      '只对当前分析范围内的 MOD 建立依赖图和加载顺序。',
      '对同路径文件计算 SHA-256；内容完全相同的重叠不会作为风险报告。',
      'Lua 只做受限静态分词，提取 require、事件挂接、全局写入、直接注册键和带 type 的表注册；不执行脚本。',
      'Project Zomboid 脚本按 module 与完整定义头建立跨路径全局索引，并比较去除注释和排版后的定义内容与直接子块数量。',
      '选择最近的旧冻结版作为更新基线，比较原版脚本实体、MOD 同路径原版文件和 MOD 实际引用的游戏 Java Class。'
    ],
    limitations: [
      selectedContext ? `本报告的主要结论只适用于“${scopeLabel}”。` : '没有唯一启用上下文，因此依赖和覆盖分析只能描述已安装内容，不能代表某个实际存档或服务器。',
      ...(selectedContext?.missingModIds.length ? [`${selectedContext.missingModIds.length} 个缺失 Mod ID 没有文件可供解析；它们的依赖、互斥、tiledef 和文件覆盖不在已完成扫描内。`] : []),
      '静态分析不会执行 Lua、Java 或本地二进制代码；反射、动态类生成、类加载器先后和 Mixin 实际应用仍需运行日志验证。',
      '多个 MOD 的 Lua 相对路径相同不等于互相覆盖；只有静态证据确认同名写入或注册差异时才提升为警告。',
      '全局脚本索引只覆盖当前分析范围内实际生效且能完整解析的文件；未解析文件会单独列为待验证。',
      '跨版本 Class 或同路径文件内容变化不会自动解释为不兼容；只有类移除、脚本实体交集和精确旧版原文件副本会提升为警告。'
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
