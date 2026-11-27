import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { open, type Entry, type ZipFile } from 'yauzl'

import type { GameIdentity } from '../shared/types'
import { atomicWriteJsonIfChanged } from './safe-write'
import { parseScriptText } from './script-analysis'

export type VersionImpactMod = {
  id: string
  files: Array<{ relativePath: string; sha256: string; kind: string }>
  scriptDefinitionKeys: string[]
  projectZomboidClasses: string[]
}

export type VersionBaseline = {
  rootPath: string
  gamePath: string
  version: string
  buildId: string
  revision: string | null
  createdAt: string | null
}

type Difference = { key: string; baseline: string | null; current: string | null; mods: string[]; staleCopyMods?: string[]; kinds?: string[] }

export type VersionImpactReport = {
  schemaVersion: 1
  generatedAt: string
  reportPath: string
  reportDigest: string
  completeness: 'complete' | 'partial'
  current: { gamePath: string; version: string; buildId: string; revision: string | null; jarSha256: string | null }
  baseline: VersionBaseline
  summary: {
    baselineScriptFiles: number
    currentScriptFiles: number
    baselineScriptDefinitions: number
    currentScriptDefinitions: number
    scriptDefinitionsAdded: number
    scriptDefinitionsRemoved: number
    scriptDefinitionsChanged: number
    modScriptDefinitionsAffected: number
    overriddenBaseFilesChecked: number
    overriddenBaseFilesChanged: number
    overriddenBaseFilesRemoved: number
    exactOldBaseCopies: number
    javaClassesChecked: number
    javaClassesChanged: number
    javaClassesRemoved: number
    javaClassesUnresolved: number
  }
  scriptDefinitions: { added: Difference[]; removed: Difference[]; changed: Difference[]; affectedByMods: Difference[]; errors: string[] }
  overriddenBaseFiles: { changed: Difference[]; removed: Difference[]; added: Difference[]; unchanged: number; errors: string[] }
  javaApi: { changed: Difference[]; removed: Difference[]; added: Difference[]; unresolved: Difference[]; unchanged: number; errors: string[] }
  methodology: string[]
  limitations: string[]
}

const sha256File = async (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
})

const versionParts = (value: string): number[] => (value.match(/\d+/g) ?? []).map(Number)
const compareVersion = (left: string, right: string): number => {
  const a = versionParts(left); const b = versionParts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference) return difference
  }
  return 0
}
const compareBuild = (left: string, right: string): number => {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const a = BigInt(left); const b = BigInt(right)
    return a < b ? -1 : a > b ? 1 : 0
  }
  return left.localeCompare(right, 'en')
}

export const discoverVersionBaseline = async (managerRoot: string, current: GameIdentity): Promise<VersionBaseline | null> => {
  const frozenRoot = path.join(managerRoot, 'frozen')
  if (!existsSync(frozenRoot)) return null
  const candidates: VersionBaseline[] = []
  for (const entry of await fs.readdir(frozenRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const metadataPath = path.join(frozenRoot, entry.name, 'metadata', 'freeze.json')
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Record<string, unknown>
      const version = String(metadata.Version ?? 'unknown')
      const gamePath = String(metadata.GamePath ?? path.join(frozenRoot, entry.name, 'game'))
      const versionOrder = compareVersion(version, current.version)
      const buildId = String(metadata.BuildID ?? 'unknown')
      const comparableBuilds = /^\d+$/.test(buildId) && /^\d+$/.test(current.buildId)
      if (!existsSync(path.join(gamePath, 'projectzomboid.jar')) || versionOrder > 0 || (versionOrder === 0 && (!comparableBuilds || compareBuild(buildId, current.buildId) >= 0))) continue
      const revision = String(metadata.FullVersion ?? '').match(/revision=([0-9a-f]+)/i)?.[1] ?? null
      candidates.push({ rootPath: path.join(frozenRoot, entry.name), gamePath, version, buildId, revision, createdAt: metadata.Created ? String(metadata.Created) : null })
    } catch { /* A malformed/unrelated directory is not a valid baseline. */ }
  }
  return candidates.sort((left, right) => compareVersion(right.version, left.version) || compareBuild(right.buildId, left.buildId))[0] ?? null
}

const walkScripts = async (gamePath: string): Promise<string[]> => {
  const root = path.join(gamePath, 'media', 'scripts')
  if (!existsSync(root)) return []
  const result: string[] = []
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()!
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) pending.push(fullPath)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) result.push(fullPath)
    }
  }
  return result.sort((left, right) => left.localeCompare(right, 'en'))
}

const indexScripts = async (gamePath: string): Promise<{ files: number; definitions: Map<string, string>; errors: string[] }> => {
  const scriptRoot = path.join(gamePath, 'media', 'scripts')
  if (!existsSync(scriptRoot)) return { files: 0, definitions: new Map(), errors: [`原版脚本目录不存在：${scriptRoot}`] }
  const files = await walkScripts(gamePath)
  const owners = new Map<string, Array<{ path: string; digest: string }>>()
  const errors: string[] = []
  for (const filePath of files) {
    const relativePath = path.relative(gamePath, filePath).replace(/\\/g, '/')
    try {
      const parsed = parseScriptText(await fs.readFile(filePath, 'utf8'), 'base-game')
      if (!parsed.complete) {
        errors.push(`${relativePath}：${parsed.errors.join('；')}`)
        continue
      }
      for (const definition of parsed.definitions) {
        const values = owners.get(definition.key) ?? []
        values.push({ path: relativePath, digest: definition.digest })
        owners.set(definition.key, values)
      }
    } catch (error) { errors.push(`${relativePath}：${error instanceof Error ? error.message : String(error)}`) }
  }
  const definitions = new Map<string, string>()
  for (const [key, values] of owners) definitions.set(key, createHash('sha256').update(JSON.stringify(values.map((entry) => entry.digest).sort())).digest('hex').toUpperCase())
  return { files: files.length, definitions, errors }
}

const compareMaps = (baseline: Map<string, string>, current: Map<string, string>, modOwners: Map<string, string[]>): { added: Difference[]; removed: Difference[]; changed: Difference[] } => {
  const added: Difference[] = []; const removed: Difference[] = []; const changed: Difference[] = []
  for (const key of [...new Set([...baseline.keys(), ...current.keys()])].sort((a, b) => a.localeCompare(b, 'en'))) {
    const before = baseline.get(key) ?? null; const after = current.get(key) ?? null
    const item = { key, baseline: before, current: after, mods: modOwners.get(key) ?? [] }
    if (before === null) added.push(item)
    else if (after === null) removed.push(item)
    else if (before !== after) changed.push(item)
  }
  return { added, removed, changed }
}

const safeGameFile = (gamePath: string, relativePath: string): string | null => {
  const root = path.resolve(gamePath)
  const candidate = path.resolve(root, relativePath.replace(/\//g, path.sep))
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null
}

const compareOverrideFiles = async (baselineGame: string, currentGame: string, mods: VersionImpactMod[]): Promise<{ changed: Difference[]; removed: Difference[]; added: Difference[]; unchanged: number; errors: string[] }> => {
  const owners = new Map<string, Set<string>>()
  const evidence = new Map<string, Array<{ id: string; sha256: string; kind: string }>>()
  for (const mod of mods) for (const file of mod.files) {
    const key = file.relativePath.replace(/\\/g, '/')
    const set = owners.get(key) ?? new Set<string>(); set.add(mod.id); owners.set(key, set)
    evidence.set(key, [...(evidence.get(key) ?? []), { id: mod.id, sha256: file.sha256, kind: file.kind }])
  }
  const result = { changed: [] as Difference[], removed: [] as Difference[], added: [] as Difference[], unchanged: 0, errors: [] as string[] }
  for (const [key, modIds] of [...owners].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const beforePath = safeGameFile(baselineGame, key); const afterPath = safeGameFile(currentGame, key)
    if (!beforePath || !afterPath) { result.errors.push(`${key}：路径越出游戏目录。`); continue }
    const beforeExists = existsSync(beforePath); const afterExists = existsSync(afterPath)
    if (!beforeExists && !afterExists) continue
    try {
      const before = beforeExists ? await sha256File(beforePath) : null
      const after = afterExists ? await sha256File(afterPath) : null
      const pathEvidence = evidence.get(key) ?? []
      const item = { key, baseline: before, current: after, mods: [...modIds].sort(), staleCopyMods: before && before !== after ? [...new Set(pathEvidence.filter((entry) => entry.sha256 === before).map((entry) => entry.id))].sort() : [], kinds: [...new Set(pathEvidence.map((entry) => entry.kind))].sort() }
      if (before === null) result.added.push(item)
      else if (after === null) result.removed.push(item)
      else if (before !== after) result.changed.push(item)
      else result.unchanged += 1
    } catch (error) { result.errors.push(`${key}：${error instanceof Error ? error.message : String(error)}`) }
  }
  return result
}

const readZipEntry = (zipFile: ZipFile, entry: Entry): Promise<Buffer> => new Promise((resolve, reject) => {
  if (entry.uncompressedSize > 16 * 1024 * 1024) return reject(new Error(`目标 Class 超过 16 MiB：${entry.fileName}`))
  zipFile.openReadStream(entry, (error, stream) => {
    if (error || !stream) return reject(error ?? new Error(`无法读取 ${entry.fileName}`))
    const chunks: Buffer[] = []; let bytes = 0
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 16 * 1024 * 1024) stream.destroy(new Error(`目标 Class 解压后超过 16 MiB：${entry.fileName}`))
      else chunks.push(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
})

const gameJarClasses = async (gamePath: string, requested: Set<string>): Promise<{ values: Map<string, string>; errors: string[] }> => {
  if (!requested.size) return { values: new Map(), errors: [] }
  const jarPath = path.join(gamePath, 'projectzomboid.jar')
  const targets = new Map([...requested].map((name) => [`${name}.class`, name]))
  return new Promise((resolve) => {
    open(jarPath, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (openError, zipFile) => {
      if (openError || !zipFile) return resolve({ values: new Map(), errors: [openError?.message ?? '无法打开 projectzomboid.jar。'] })
      const values = new Map<string, string>(); const errors: string[] = []; let entries = 0; let settled = false
      const finish = (): void => { if (!settled) { settled = true; resolve({ values, errors }) } }
      zipFile.on('error', (error) => { errors.push(error.message); finish() })
      zipFile.on('end', finish)
      zipFile.on('entry', (entry: Entry) => {
        void (async () => {
          entries += 1
          if (entries > 100_000) throw new Error('JAR 条目超过 100000 安全上限。')
          const name = targets.get(entry.fileName)
          if (name) {
            const digest = createHash('sha256').update(await readZipEntry(zipFile, entry)).digest('hex').toUpperCase()
            const existing = values.get(name)
            if (existing && existing !== digest) errors.push(`同名 Class 内容不唯一：${name}`)
            else values.set(name, digest)
          }
          zipFile.readEntry()
        })().catch((error) => { errors.push(error instanceof Error ? error.message : String(error)); zipFile.readEntry() })
      })
      zipFile.readEntry()
    })
  })
}

export const analyzeVersionImpact = async (input: { managerRoot: string; currentGamePath: string; current: GameIdentity; mods: VersionImpactMod[]; reportPath: string }): Promise<VersionImpactReport | null> => {
  const baseline = await discoverVersionBaseline(input.managerRoot, input.current)
  if (!baseline) return null
  const modDefinitionOwners = new Map<string, string[]>()
  for (const mod of input.mods) for (const key of mod.scriptDefinitionKeys) modDefinitionOwners.set(key, [...new Set([...(modDefinitionOwners.get(key) ?? []), mod.id])].sort())
  const [beforeScripts, afterScripts, overrideFiles] = await Promise.all([
    indexScripts(baseline.gamePath), indexScripts(input.currentGamePath), compareOverrideFiles(baseline.gamePath, input.currentGamePath, input.mods)
  ])
  const scriptDefinitions = compareMaps(beforeScripts.definitions, afterScripts.definitions, modDefinitionOwners)
  const affectedByMods = [...scriptDefinitions.removed, ...scriptDefinitions.changed].filter((entry) => entry.mods.length)
  const javaOwners = new Map<string, string[]>()
  for (const mod of input.mods) for (const name of mod.projectZomboidClasses) javaOwners.set(name, [...new Set([...(javaOwners.get(name) ?? []), mod.id])].sort())
  const requested = new Set(javaOwners.keys())
  const [beforeJava, afterJava] = await Promise.all([gameJarClasses(baseline.gamePath, requested), gameJarClasses(input.currentGamePath, requested)])
  const javaChanges = compareMaps(beforeJava.values, afterJava.values, javaOwners)
  const unresolvedJava = [...requested].filter((name) => !beforeJava.values.has(name) && !afterJava.values.has(name)).sort().map((key) => ({ key, baseline: null, current: null, mods: javaOwners.get(key) ?? [] }))
  const unchangedJava = [...requested].filter((name) => beforeJava.values.has(name) && beforeJava.values.get(name) === afterJava.values.get(name)).length
  const errors = [...beforeScripts.errors, ...afterScripts.errors, ...overrideFiles.errors, ...beforeJava.errors, ...afterJava.errors]
  const core = {
    schemaVersion: 1 as const,
    current: { gamePath: input.currentGamePath, version: input.current.version, buildId: input.current.buildId, revision: input.current.revision, jarSha256: input.current.jarSha256 },
    baseline,
    summary: {
      baselineScriptFiles: beforeScripts.files, currentScriptFiles: afterScripts.files,
      baselineScriptDefinitions: beforeScripts.definitions.size, currentScriptDefinitions: afterScripts.definitions.size,
      scriptDefinitionsAdded: scriptDefinitions.added.length, scriptDefinitionsRemoved: scriptDefinitions.removed.length, scriptDefinitionsChanged: scriptDefinitions.changed.length,
      modScriptDefinitionsAffected: affectedByMods.length,
      overriddenBaseFilesChecked: overrideFiles.changed.length + overrideFiles.removed.length + overrideFiles.added.length + overrideFiles.unchanged,
      overriddenBaseFilesChanged: overrideFiles.changed.length, overriddenBaseFilesRemoved: overrideFiles.removed.length,
      exactOldBaseCopies: [...overrideFiles.changed, ...overrideFiles.removed].filter((entry) => entry.staleCopyMods?.length).length,
      javaClassesChecked: requested.size, javaClassesChanged: javaChanges.changed.length, javaClassesRemoved: javaChanges.removed.length, javaClassesUnresolved: unresolvedJava.length
    },
    scriptDefinitions: { ...scriptDefinitions, affectedByMods, errors: [...beforeScripts.errors, ...afterScripts.errors] },
    overriddenBaseFiles: overrideFiles,
    javaApi: { changed: javaChanges.changed, removed: javaChanges.removed, added: javaChanges.added, unresolved: unresolvedJava, unchanged: unchangedJava, errors: [...beforeJava.errors, ...afterJava.errors] },
    methodology: [
      '自动选择管理目录中版本号更低，或版本号相同但 Build 更低的最近冻结版作为更新前基线。',
      '递归解析两版 media/scripts，以 module 与完整实体头为键，并比较去除注释和排版后的定义摘要。',
      '只对当前分析范围 MOD 的有效相对路径比较两版原版文件 SHA-256。',
      '只比较当前分析范围 MOD JAR 静态引用到的 zombie/* 游戏 Class，并逐 Class 比较 SHA-256。'
    ],
    limitations: [
      'Class 内容变化只表示 MOD 调用的游戏内部实现发生变化，不足以单独证明 MOD 不兼容。',
      '原版脚本定义变化只有与当前 MOD 的同键定义相交时才作为直接受影响证据。',
      '静态对比不执行 Lua、Java 或游戏；反射、字符串拼接得到的类名和运行时行为仍需启动日志验证。'
    ]
  }
  const reportDigest = createHash('sha256').update(JSON.stringify(core)).digest('hex').toUpperCase()
  const report: VersionImpactReport = { ...core, generatedAt: new Date().toISOString(), reportPath: input.reportPath, reportDigest, completeness: errors.length ? 'partial' : 'complete' }
  await fs.mkdir(path.dirname(input.reportPath), { recursive: true })
  await atomicWriteJsonIfChanged(input.reportPath, report)
  return report
}
