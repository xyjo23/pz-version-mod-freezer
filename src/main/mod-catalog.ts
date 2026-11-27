import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import type { GameIdentity, JavaArchiveEvidence, ModCatalog, ModCatalogEntry, ModCatalogFile, ModCatalogFileKind } from '../shared/types'
import { analyzeJavaArchive, readJavaRuntimeEvidence, selectEffectiveJavaClassOwners } from './java-archive-analysis'
import type { ResolvedMod } from './mod-resolver'
import { atomicWriteJsonIfChanged } from './safe-write'

type CatalogOptions = {
  source: ModCatalog['source']
  sourceLabel: string
  catalogPath: string
  game: GameIdentity
  gamePath?: string
  mods: ResolvedMod[]
}

type CandidateFile = { relativePath: string; sourcePath: string; layerPath: string }

const normalizeRelative = (value: string): string => value.split(path.sep).join('/')

const sha256File = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
})

const inspectStableFile = async (candidate: CandidateFile): Promise<ModCatalogFile> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fs.stat(candidate.sourcePath)
    const sha256 = await sha256File(candidate.sourcePath)
    const after = await fs.stat(candidate.sourcePath)
    if (before.size === after.size && before.mtimeMs === after.mtimeMs) {
      return {
        ...candidate,
        bytes: after.size,
        modifiedAt: after.mtime.toISOString(),
        sha256,
        kind: classifyFile(candidate.relativePath)
      }
    }
  }
  throw new Error('文件在扫描期间发生变化；本次未采用不稳定结果。')
}

const classifyFile = (relativePath: string): ModCatalogFileKind => {
  const normalized = relativePath.toLowerCase().replace(/\\/g, '/')
  const extension = path.extname(normalized)
  if (extension === '.lua') return 'lua'
  if (extension === '.jar') return 'java-archive'
  if (extension === '.class') return 'jvm-bytecode'
  if (['.dll', '.so', '.dylib', '.exe'].includes(extension)) return 'native-binary'
  if (normalized.includes('/media/scripts/') || normalized.startsWith('media/scripts/')) return 'pz-script'
  if (extension === '.xml') return 'xml'
  if (extension === '.json') return 'json'
  if (normalized.includes('/translate/') || normalized.includes('/translation/') || normalized.startsWith('media/lua/shared/translate/')) return 'translation'
  if (normalized.includes('/maps/') || ['.lotpack', '.lotheader', '.bin'].includes(extension)) return 'map'
  if (['.pack', '.tiles', '.texture', '.png', '.jpg', '.jpeg'].includes(extension)) return 'asset'
  if (['.ogg', '.wav', '.mp3', '.mp4'].includes(extension)) return 'media'
  if (['.info', '.ini', '.txt', '.md', '.properties'].includes(extension)) return 'metadata'
  return 'other'
}

const walkLayer = async (
  layerPath: string,
  skippedLinks: string[],
  unreadable: Array<{ path: string; error: string }>
): Promise<CandidateFile[]> => {
  if (!existsSync(layerPath)) return []
  try {
    if ((await fs.lstat(layerPath)).isSymbolicLink()) {
      skippedLinks.push(layerPath)
      return []
    }
  } catch (error) {
    unreadable.push({ path: layerPath, error: error instanceof Error ? error.message : String(error) })
    return []
  }
  const files: CandidateFile[] = []
  const pending = ['']
  while (pending.length) {
    const relativeDirectory = pending.pop()!
    const directory = path.join(layerPath, relativeDirectory)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      unreadable.push({ path: directory, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name)
      const sourcePath = path.join(layerPath, relativePath)
      if (entry.isSymbolicLink()) {
        skippedLinks.push(sourcePath)
      } else if (entry.isDirectory()) {
        pending.push(relativePath)
      } else if (entry.isFile()) {
        files.push({ relativePath: normalizeRelative(relativePath), sourcePath, layerPath })
      }
    }
  }
  return files
}

const mapIndex = (pairs: Array<[string | null, string]>): Record<string, string[]> => {
  const index = new Map<string, Set<string>>()
  for (const [rawKey, catalogId] of pairs) {
    const key = rawKey?.trim()
    if (!key) continue
    const values = index.get(key) ?? new Set<string>()
    values.add(catalogId)
    index.set(key, values)
  }
  return Object.fromEntries([...index.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, values]) => [key, [...values].sort((left, right) => left.localeCompare(right, 'en'))]))
}

const logicalCatalogDigest = (game: GameIdentity, javaRuntime: ModCatalog['javaRuntime'], mods: ModCatalogEntry[], indexes: ModCatalog['indexes']): string => {
  const logical = {
    game: { version: game.version, revision: game.revision, buildId: game.buildId, jarSha256: game.jarSha256 },
    javaRuntime,
    mods: mods.map((mod) => ({
      catalogId: mod.catalogId,
      modId: mod.modId,
      workshopId: mod.workshopId,
      active: mod.active,
      selected: mod.version.selected,
      dependencies: mod.dependencies,
      metadataSha256: mod.metadata.sha256,
      contentDigest: mod.content.contentDigest,
      javaArchives: mod.content.javaArchives.map((archive) => ({
        path: archive.relativePath,
        sha256: archive.archiveSha256,
        completeness: archive.completeness,
        classes: archive.definedClasses.map((entry) => [entry.name, entry.sha256, entry.majorVersion, entry.release]),
        externalClasses: archive.externalClasses,
        projectZomboidClasses: archive.projectZomboidClasses,
        mixinFrameworks: archive.mixinFrameworks,
        mixinTargets: archive.mixinTargets,
        errors: archive.errors
      })),
      unreadable: mod.content.unreadable,
      skippedLinks: mod.content.skippedLinks
    })),
    indexes
  }
  return createHash('sha256').update(JSON.stringify(logical), 'utf8').digest('hex').toUpperCase()
}

const buildEntry = async (mod: ResolvedMod, targetVersion: string): Promise<ModCatalogEntry> => {
  const catalogId = `mod-${createHash('sha256').update(path.resolve(mod.record.rootPath).toLowerCase(), 'utf8').digest('hex').slice(0, 20)}`
  const skippedLinks: string[] = []
  const unreadable: Array<{ path: string; error: string }> = []
  const effective = new Map<string, CandidateFile>()
  const layerOverrides: ModCatalogEntry['content']['layerOverrides'] = []
  for (const layerPath of mod.layers) {
    for (const file of await walkLayer(layerPath, skippedLinks, unreadable)) {
      const key = file.relativePath.toLowerCase()
      const previous = effective.get(key)
      if (previous) layerOverrides.push({ relativePath: file.relativePath, replacedLayer: previous.layerPath, effectiveLayer: layerPath })
      effective.set(key, file)
    }
  }

  const candidates = [...effective.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'))
  const files: ModCatalogFile[] = []
  for (let index = 0; index < candidates.length; index += 8) {
    const inspected = await Promise.all(candidates.slice(index, index + 8).map(async (candidate) => {
      try {
        return await inspectStableFile(candidate)
      } catch (error) {
        unreadable.push({ path: candidate.sourcePath, error: error instanceof Error ? error.message : String(error) })
        return null
      }
    }))
    files.push(...inspected.filter((file): file is ModCatalogFile => file !== null))
  }

  let metadataSha256: string | null = null
  if (mod.metadataPath) {
    try {
      metadataSha256 = await sha256File(mod.metadataPath)
    } catch (error) {
      unreadable.push({ path: mod.metadataPath, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const contentDigest = createHash('sha256').update(JSON.stringify(files.map((file) => [file.relativePath.toLowerCase(), file.bytes, file.sha256])), 'utf8').digest('hex').toUpperCase()
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const javaArchives: JavaArchiveEvidence[] = []
  for (const file of files.filter((candidate) => candidate.kind === 'java-archive')) {
    try {
      javaArchives.push(await analyzeJavaArchive(file.sourcePath, file.relativePath, file.sha256))
    } catch (error) {
      javaArchives.push({
        relativePath: file.relativePath,
        sourcePath: file.sourcePath,
        archiveSha256: file.sha256,
        completeness: 'partial',
        entries: 0,
        classes: 0,
        uncompressedBytes: 0,
        minimumClassMajor: null,
        maximumClassMajor: null,
        nativeMethods: 0,
        manifest: { mainClass: null, classPath: [], implementationVersion: null, multiRelease: false },
        definedClasses: [],
        externalClasses: [],
        projectZomboidClasses: [],
        mixinFrameworks: [],
        mixinTargets: [],
        errors: [error instanceof Error ? error.message : String(error)]
      })
    }
  }
  const evidence = [
    `目标游戏版本：${targetVersion}`,
    `生效层：${mod.layers.join(' + ') || '无可用层'}`,
    `mod.info：${mod.metadataPath ?? '未找到'}`,
    `已取得 SHA-256 的有效普通文件：${files.length}`,
    ...(mod.metadataError ? [`mod.info 读取异常：${mod.metadataError}`] : []),
    ...(mod.resolutionIssue ? [`版本目录解析：${mod.resolutionIssue}`] : []),
    ...(skippedLinks.length ? [`跳过目录联接/符号链接：${skippedLinks.length}`] : []),
    ...(unreadable.length ? [`无法取得完整证据：${unreadable.length} 项`] : []),
    ...(javaArchives.length ? [`JAR 内部静态解析：${javaArchives.reduce((sum, archive) => sum + archive.classes, 0)} 个 Class`] : []),
    ...(javaArchives.some((archive) => archive.completeness === 'partial') ? ['至少一个 JAR 未能完整解析。'] : [])
  ]
  return {
    catalogId,
    key: mod.record.key,
    name: mod.record.name,
    modId: mod.record.modId,
    workshopId: mod.record.workshopId,
    source: mod.record.source,
    rootPath: mod.record.rootPath,
    active: mod.record.active,
    version: {
      target: targetVersion,
      selected: mod.record.selectedVersion,
      variants: mod.record.variants,
      layers: mod.layers,
      minimum: mod.record.versionMin,
      maximum: mod.record.versionMax,
      resolutionIssue: mod.resolutionIssue
    },
    dependencies: {
      require: mod.record.require,
      incompatible: mod.record.incompatible,
      loadAfter: mod.record.loadAfter,
      loadBefore: mod.record.loadBefore
    },
    metadata: { path: mod.metadataPath, sha256: metadataSha256, readError: mod.metadataError },
    content: {
      files,
      totalFiles: files.length,
      totalBytes,
      contentDigest,
      layerOverrides,
      skippedLinks: skippedLinks.sort((left, right) => left.localeCompare(right, 'en')),
      unreadable: unreadable.sort((left, right) => left.path.localeCompare(right.path, 'en')),
      jars: files.filter((file) => file.kind === 'java-archive').map((file) => file.relativePath),
      classes: files.filter((file) => file.kind === 'jvm-bytecode').map((file) => file.relativePath),
      nativeBinaries: files.filter((file) => file.kind === 'native-binary').map((file) => file.relativePath),
      javaArchives
    },
    evidence
  }
}

export const buildModCatalog = async (options: CatalogOptions): Promise<ModCatalog> => {
  const javaRuntime = options.gamePath ? await readJavaRuntimeEvidence(options.gamePath) : null
  const mods: ModCatalogEntry[] = []
  for (const mod of [...options.mods].sort((left, right) => left.record.rootPath.localeCompare(right.record.rootPath, 'en'))) {
    mods.push(await buildEntry(mod, options.game.version))
  }
  const byModId = mapIndex(mods.map((mod) => [mod.modId, mod.catalogId]))
  const byWorkshopId = mapIndex(mods.map((mod) => [mod.workshopId, mod.catalogId]))
  const requiredBy = mapIndex(mods.flatMap((mod) => mod.dependencies.require.map((required) => [required, mod.catalogId] as [string, string])))
  const javaClassOwnersMap = new Map<string, ModCatalog['indexes']['javaClassOwners'][string]>()
  for (const mod of mods) for (const archive of mod.content.javaArchives) for (const definition of archive.definedClasses) {
    const owners = javaClassOwnersMap.get(definition.name) ?? []
    owners.push({ catalogId: mod.catalogId, archivePath: archive.relativePath, sha256: definition.sha256, release: definition.release, multiRelease: archive.manifest.multiRelease })
    javaClassOwnersMap.set(definition.name, owners)
  }
  const javaClassOwners = Object.fromEntries([...javaClassOwnersMap.entries()].sort(([left], [right]) => left.localeCompare(right, 'en')))
  const indexes = { byModId, byWorkshopId, requiredBy, javaClassOwners }
  const unreadable = mods.reduce((sum, mod) => sum + mod.content.unreadable.length + (mod.metadata.readError ? 1 : 0), 0)
  const skippedLinks = mods.reduce((sum, mod) => sum + mod.content.skippedLinks.length, 0)
  const unresolved = mods.filter((mod) => Boolean(mod.version.resolutionIssue) || !mod.modId).length
  const javaArchiveErrors = mods.reduce((sum, mod) => sum + mod.content.javaArchives.reduce((archiveSum, archive) => archiveSum + archive.errors.length, 0), 0)
  const duplicateJavaClasses = Object.values(javaClassOwners).filter((owners) => new Set(selectEffectiveJavaClassOwners(owners, javaRuntime?.major ?? null).map((owner) => owner.catalogId)).size > 1).length
  const catalog: ModCatalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: options.source,
    sourceLabel: options.sourceLabel,
    catalogPath: options.catalogPath,
    game: options.game,
    javaRuntime,
    digestAlgorithm: 'SHA-256',
    catalogDigest: '',
    completeness: unreadable || skippedLinks || unresolved || javaArchiveErrors ? 'partial' : 'complete',
    summary: {
      discoveredMods: mods.length,
      resolvedMods: mods.length - unresolved,
      unresolvedMods: unresolved,
      activeMods: mods.filter((mod) => mod.active).length,
      uniqueModIds: Object.keys(byModId).length,
      workshopProjects: Object.keys(byWorkshopId).length,
      duplicateModIds: Object.values(byModId).filter((ids) => ids.length > 1).length,
      files: mods.reduce((sum, mod) => sum + mod.content.totalFiles, 0),
      bytes: mods.reduce((sum, mod) => sum + mod.content.totalBytes, 0),
      jars: mods.reduce((sum, mod) => sum + mod.content.jars.length, 0),
      classes: mods.reduce((sum, mod) => sum + mod.content.classes.length, 0),
      nativeBinaries: mods.reduce((sum, mod) => sum + mod.content.nativeBinaries.length, 0),
      javaArchivesAnalyzed: mods.reduce((sum, mod) => sum + mod.content.javaArchives.length, 0),
      javaClasses: mods.reduce((sum, mod) => sum + mod.content.javaArchives.reduce((archiveSum, archive) => archiveSum + archive.classes, 0), 0),
      javaArchiveErrors,
      projectZomboidClassReferences: mods.reduce((sum, mod) => sum + mod.content.javaArchives.reduce((archiveSum, archive) => archiveSum + archive.projectZomboidClasses.length, 0), 0),
      mixinArchives: mods.reduce((sum, mod) => sum + mod.content.javaArchives.filter((archive) => archive.mixinFrameworks.length > 0).length, 0),
      duplicateJavaClasses,
      unreadable,
      skippedLinks
    },
    indexes,
    methodology: [
      '按实际游戏 major.minor 规则选择 B42 common 与最高可用版本目录。',
      '后加载版本层覆盖 common 同路径文件；覆盖关系逐项保留。',
      '每个有效普通文件都在大小和修改时间稳定的窗口内计算 SHA-256。',
      'JAR 采用受限 ZIP 流读取，解析 Class 常量池、类版本、native 方法、PZ API 引用和 Mixin 静态痕迹；不会加载任何类。',
      '目录联接和符号链接不被跟随，避免扫描逃出 MOD 根目录。'
    ],
    limitations: [
      'Class 常量池不能证明反射、动态生成、脚本桥接或运行时补丁一定会执行；相关结论保持为静态证据或待验证。',
      '本阶段不执行 Lua、Java 或本地代码，也不判定代码来源是否可信。',
      ...(javaArchiveErrors ? [`JAR 内部解析记录了 ${javaArchiveErrors} 个错误，因此数据库标记为 partial。`] : []),
      ...(unreadable ? [`${unreadable} 项内容无法完整读取，因此数据库标记为 partial。`] : []),
      ...(skippedLinks ? [`${skippedLinks} 个目录联接或符号链接被安全跳过，其目标内容不计入数据库。`] : []),
      ...(unresolved ? [`${unresolved} 个 MOD 缺少可用版本层或 Mod ID，不能视为完整解析。`] : [])
    ],
    mods
  }
  catalog.catalogDigest = logicalCatalogDigest(options.game, javaRuntime, mods, indexes)
  return catalog
}

export const persistModCatalog = async (catalog: ModCatalog): Promise<ModCatalog> => {
  await atomicWriteJsonIfChanged(catalog.catalogPath, catalog)
  return catalog
}
