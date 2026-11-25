import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import type { AnalysisConfidence, CompatibilitySeverity, FreezeConfig, IntegrityFinding, IntegrityReport, ReferencedModRoot } from '../shared/types'
import { readGameIdentity } from './game-identity'
import { detectSteamInstallation, validateSteamGame } from './steam-service'
import { getSnapshot } from './vault-service'

type ManifestEntry = { relativePath: string; sha256: string }
type RootVerification = { checked: number; missing: string[]; changed: string[]; added: string[]; unreadable: string[] }
type ReferenceVerification = { missing: string[]; changed: string[]; metadataDrift: string[]; checkedFiles: number }

const severityRank: Record<CompatibilitySeverity, number> = { blocker: 0, warning: 1, unknown: 2, pass: 3 }

const finding = (
  id: string,
  severity: CompatibilitySeverity,
  confidence: AnalysisConfidence,
  category: IntegrityFinding['category'],
  title: string,
  summary: string,
  impact: string,
  action: string,
  rule: string,
  evidence: string[] = []
): IntegrityFinding => ({ id, severity, confidence, category, title, summary, impact, action, rule, evidence })

const hashFile = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
})

const collectRelativeFiles = async (root: string): Promise<string[]> => {
  if (!existsSync(root)) return []
  const files: string[] = []
  const pending = ['']
  while (pending.length) {
    const relativeDirectory = pending.pop()!
    const entries = await fs.readdir(path.join(root, relativeDirectory), { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) pending.push(relativePath)
      else if (entry.isFile()) files.push(relativePath)
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'))
}

const parseManifest = async (manifestPath: string): Promise<ManifestEntry[]> => {
  const raw = (await fs.readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, '')
  const rows: ManifestEntry[] = []
  const seen = new Set<string>()
  for (const [index, line] of raw.split(/\r?\n/).slice(1).entries()) {
    if (!line.trim()) continue
    const match = line.match(/^"((?:[^"]|"")*)","\d+","([A-Fa-f0-9]{64})"$/)
    if (!match) throw new Error(`基线清单第 ${index + 2} 行格式无效：${line.slice(0, 120)}`)
    const relativePath = match[1].replace(/""/g, '"')
    const key = relativePath.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) throw new Error(`基线清单包含重复路径：${relativePath}`)
    seen.add(key)
    rows.push({ relativePath, sha256: match[2].toUpperCase() })
  }
  return rows
}

const verifyRoot = async (root: string, manifestPath: string): Promise<RootVerification> => {
  const manifest = await parseManifest(manifestPath)
  const expected = new Set(manifest.map((row) => row.relativePath.replace(/\\/g, '/').toLowerCase()))
  const missing: string[] = []
  const changed: string[] = []
  const unreadable: string[] = []
  for (let index = 0; index < manifest.length; index += 8) {
    await Promise.all(manifest.slice(index, index + 8).map(async (row) => {
      const filePath = path.join(root, row.relativePath)
      if (!existsSync(filePath)) {
        missing.push(row.relativePath)
        return
      }
      try {
        if (await hashFile(filePath) !== row.sha256) changed.push(row.relativePath)
      } catch {
        unreadable.push(row.relativePath)
      }
    }))
  }
  const added = (await collectRelativeFiles(root)).filter((relativePath) => !expected.has(relativePath.replace(/\\/g, '/').toLowerCase()))
  return { checked: manifest.length, missing, changed, added, unreadable }
}

const verifyReferencedMod = async (mod: ReferencedModRoot): Promise<ReferenceVerification> => {
  const missing: string[] = []
  const changed: string[] = []
  const metadataDrift: string[] = []
  if (!existsSync(mod.sourcePath)) missing.push(`${mod.name}：引用源不存在 → ${mod.sourcePath}`)
  if (!existsSync(mod.targetPath)) missing.push(`${mod.name}：目标目录不存在 → ${mod.targetPath}`)
  if (missing.length) return { missing, changed, metadataDrift, checkedFiles: 0 }

  if (mod.linkMode === 'junction') {
    try {
      const [sourceRealPath, targetRealPath] = await Promise.all([fs.realpath(mod.sourcePath), fs.realpath(mod.targetPath)])
      if (path.resolve(sourceRealPath).toLowerCase() !== path.resolve(targetRealPath).toLowerCase()) changed.push(`${mod.name}：目录连接指向了其他位置`)
      return { missing, changed, metadataDrift, checkedFiles: 1 }
    } catch {
      changed.push(`${mod.name}：无法解析目录连接`)
      return { missing, changed, metadataDrift, checkedFiles: 1 }
    }
  }

  const [sourceFiles, targetFiles] = await Promise.all([collectRelativeFiles(mod.sourcePath), collectRelativeFiles(mod.targetPath)])
  const targetByKey = new Map(targetFiles.map((file) => [file.replace(/\\/g, '/').toLowerCase(), file]))
  const sourceKeys = new Set(sourceFiles.map((file) => file.replace(/\\/g, '/').toLowerCase()))
  for (const targetFile of targetFiles) if (!sourceKeys.has(targetFile.replace(/\\/g, '/').toLowerCase())) changed.push(`${mod.name}：目标多出 ${targetFile}`)
  let linkedFiles = 0
  let copiedFiles = 0
  for (let index = 0; index < sourceFiles.length; index += 32) {
    await Promise.all(sourceFiles.slice(index, index + 32).map(async (sourceFile) => {
      const targetFile = targetByKey.get(sourceFile.replace(/\\/g, '/').toLowerCase())
      if (!targetFile) {
        missing.push(`${mod.name}：目标缺少 ${sourceFile}`)
        return
      }
      const sourcePath = path.join(mod.sourcePath, sourceFile)
      const targetPath = path.join(mod.targetPath, targetFile)
      try {
        const [sourceStats, targetStats] = await Promise.all([fs.stat(sourcePath), fs.stat(targetPath)])
        const isSameFile = Boolean(sourceStats.ino && targetStats.ino && sourceStats.dev === targetStats.dev && sourceStats.ino === targetStats.ino)
        if (isSameFile) {
          linkedFiles += 1
          return
        }
        copiedFiles += 1
        if (sourceStats.size !== targetStats.size || await hashFile(sourcePath) !== await hashFile(targetPath)) changed.push(`${mod.name}：内容变化 ${sourceFile}`)
      } catch {
        changed.push(`${mod.name}：无法读取 ${sourceFile}`)
      }
    }))
  }
  if (mod.files !== sourceFiles.length) metadataDrift.push(`${mod.name}：登记 ${mod.files} 个文件，实际引用源 ${sourceFiles.length} 个`)
  if (mod.linkedFiles !== undefined && mod.linkedFiles !== linkedFiles) metadataDrift.push(`${mod.name}：登记硬链接 ${mod.linkedFiles} 个，实际 ${linkedFiles} 个`)
  if (mod.copiedFiles !== undefined && mod.copiedFiles !== copiedFiles) metadataDrift.push(`${mod.name}：登记回退复制 ${mod.copiedFiles} 个，实际 ${copiedFiles} 个`)
  return { missing, changed, metadataDrift, checkedFiles: sourceFiles.length }
}

const persist = async (report: IntegrityReport, outputRoot: string): Promise<IntegrityReport> => {
  await fs.mkdir(outputRoot, { recursive: true })
  const reportPath = path.join(outputRoot, `latest-${report.source.toLowerCase()}.json`)
  const saved = { ...report, reportPath }
  await fs.writeFile(reportPath, JSON.stringify(saved, null, 2), 'utf8')
  return saved
}

const reportVerdict = (findings: IntegrityFinding[]): CompatibilitySeverity => (
  [...findings].sort((left, right) => severityRank[left.severity] - severityRank[right.severity])[0]?.severity ?? 'pass'
)

const plainIntegritySummary = (verdict: CompatibilitySeverity, summary: IntegrityReport['summary']): string => {
  if (verdict === 'pass') return `检查完成：${summary.checkedFiles} 个项目均与登记状态一致。`
  if (verdict === 'unknown') return '检查未能形成确定结论；报告中列出了尚缺少的证据。'
  return `检查发现 ${summary.missingFiles} 个缺失、${summary.changedFiles} 个变化、${summary.addedFiles} 个新增、${summary.brokenReferences} 个引用异常。`
}

const analyzeThinVersion = async (config: FreezeConfig): Promise<{ findings: IntegrityFinding[]; summary: IntegrityReport['summary']; rawOutput: string }> => {
  const findings: IntegrityFinding[] = []
  const identity = await readGameIdentity(config.GamePath, config.BuildID ?? 'unknown', config.CachePath)
  const identityEvidence = [`实际版本 ${identity.version}`, `实际 revision ${identity.revision ?? '未知'}`, `实际 JAR SHA-256 ${identity.jarSha256 ?? '未知'}`]
  if (identity.status === 'unknown' || identity.status === 'cache-only') findings.push(finding('thin-identity-unverified', 'unknown', 'unverified', 'identity', '无法确认基础游戏身份', '没有从游戏二进制取得可靠版本身份。', '无法证明快速版仍引用创建时的基础游戏。', '修复或恢复基础版本的 projectzomboid.jar 后重新分析。', 'THIN-IDENTITY-READABLE', identity.evidence))
  const expectedRevision = config.BaseRevision ?? config.Revision
  const expectedHash = config.BaseGameJarSHA256 ?? config.GameJarSHA256
  if (!expectedRevision && !expectedHash) findings.push(finding('thin-baseline-missing', 'unknown', 'unverified', 'baseline', '快速版缺少基础游戏身份基线', '元数据中既没有创建时 revision，也没有 projectzomboid.jar SHA-256。', '可以读取当前游戏身份，但无法证明它就是创建快速版时使用的身份。', '从可信完整版本重新创建快速版，以登记基础 revision 和 JAR 哈希。', 'THIN-IDENTITY-BASELINE', identityEvidence))
  if (expectedRevision && !identity.revision) findings.push(finding('thin-revision-unreadable', 'unknown', 'unverified', 'identity', '无法读取当前游戏 revision', `创建时登记值为 ${expectedRevision}，但当前二进制没有取得可比较值。`, '不能确认当前游戏代码 revision 是否仍与创建时一致。', '恢复可读取的 GitVersion.class 后重新分析。', 'THIN-IDENTITY-REVISION', identityEvidence))
  if (expectedHash && !identity.jarSha256) findings.push(finding('thin-hash-unreadable', 'unknown', 'unverified', 'identity', '无法计算当前游戏核心 JAR 哈希', `创建时登记了 SHA-256 ${expectedHash}，但当前文件没有取得可比较值。`, '不能确认 projectzomboid.jar 是否仍与创建时一致。', '恢复可读取的 projectzomboid.jar 后重新分析。', 'THIN-IDENTITY-HASH', identityEvidence))
  if (expectedRevision && identity.revision && expectedRevision !== identity.revision) findings.push(finding('thin-revision-changed', 'blocker', 'confirmed', 'identity', '基础游戏 revision 已变化', `登记值 ${expectedRevision}，实际值 ${identity.revision}。`, '快速版正在使用与创建时不同的游戏代码。', '切回原基础版本，或从当前基础重新创建快速版。', 'THIN-IDENTITY-REVISION', identityEvidence))
  if (expectedHash && identity.jarSha256 && expectedHash.toUpperCase() !== identity.jarSha256.toUpperCase()) findings.push(finding('thin-jar-changed', 'blocker', 'confirmed', 'identity', '基础游戏核心 JAR 已变化', 'projectzomboid.jar 的 SHA-256 与登记值不同。', '快速版的游戏逻辑已经不再是创建时的内容。', '恢复原 JAR，或重新创建快速版并重新进行兼容性分析。', 'THIN-IDENTITY-HASH', identityEvidence))

  const references = config.ReferencedMods ?? []
  const results: ReferenceVerification[] = []
  for (const mod of references) results.push(await verifyReferencedMod(mod))
  const missing = results.flatMap((result) => result.missing)
  const changed = results.flatMap((result) => result.changed)
  const metadataDrift = results.flatMap((result) => result.metadataDrift)
  const checkedFiles = results.reduce((sum, result) => sum + result.checkedFiles, 0)
  if (missing.length) findings.push(finding('thin-reference-missing', 'blocker', 'confirmed', 'reference', '快速版引用内容缺失', `${missing.length} 个引用源、目标目录或目标文件不存在。`, '相关 MOD 无法按创建时状态加载。', '恢复缺失目录或从完整基础版重新创建快速版。', 'THIN-REFERENCE-PRESENCE', missing))
  if (changed.length) findings.push(finding('thin-reference-changed', 'blocker', 'confirmed', 'reference', '快速版引用内容已经变化', `${changed.length} 个目标文件与引用源不一致。`, 'MOD 内容已偏离创建时状态，运行结果不可复现。', '恢复来源内容或重新创建快速版。', 'THIN-REFERENCE-CONTENT', changed))
  if (metadataDrift.length) findings.push(finding('thin-reference-metadata', 'warning', 'confirmed', 'reference', '快速版登记统计与实际状态不同', `${metadataDrift.length} 项硬链接或文件数量统计发生变化，但已逐文件核对内容。`, '磁盘复用状态可能变化；内容一致时通常不影响游戏运行。', '确认是否移动或重建过 MOD 目录；需要精确复用时重新创建快速版。', 'THIN-REFERENCE-METADATA', metadataDrift))
  if (!findings.length) findings.push(finding('thin-pass', 'pass', 'confirmed', 'reference', '基础身份和 MOD 引用均一致', `已核对 ${references.length} 个 MOD 根目录、${checkedFiles} 个文件。`, '没有发现会使快速版偏离创建状态的证据。', '无需处理；基础完整版本仍不可移动或删除。', 'THIN-REFERENCE-COMPLETE', [...identityEvidence, `MOD 根目录 ${references.length}`, `文件 ${checkedFiles}`]))
  const summary: IntegrityReport['summary'] = { checkedFiles: checkedFiles + 1, missingFiles: missing.length, changedFiles: changed.length, addedFiles: 0, unreadableFiles: identity.status === 'unknown' ? 1 : 0, brokenReferences: missing.length + changed.length, findings: findings.length }
  return { findings, summary, rawOutput: [...identityEvidence, ...missing, ...changed, ...metadataDrift].join('\n') }
}

const analyzeFullVersion = async (config: FreezeConfig): Promise<{ findings: IntegrityFinding[]; summary: IntegrityReport['summary']; rawOutput: string }> => {
  if (!config.ManifestPath) throw new Error('冻结元数据没有登记 SHA-256 基线目录。')
  const targets = [
    { label: '游戏', category: 'game' as const, root: config.GamePath, manifest: path.join(config.ManifestPath, 'game.sha256.csv') },
    { label: 'MOD', category: 'mods' as const, root: path.join(config.CachePath, 'mods'), manifest: path.join(config.ManifestPath, 'mods.sha256.csv') }
  ]
  const findings: IntegrityFinding[] = []
  const results: Array<{ label: string; category: 'game' | 'mods'; result: RootVerification }> = []
  for (const target of targets) {
    if (!existsSync(target.manifest)) {
      findings.push(finding(`baseline-missing-${target.category}`, 'unknown', 'unverified', 'baseline', `${target.label}基线清单缺失`, target.manifest, `无法证明${target.label}内容是否仍为冻结时状态；这不等于文件已经损坏。`, '恢复清单文件，或从可信来源重新创建该冻结版本。', 'FULL-BASELINE-PRESENT', [target.manifest]))
      continue
    }
    try {
      results.push({ label: target.label, category: target.category, result: await verifyRoot(target.root, target.manifest) })
    } catch (error) {
      findings.push(finding(`baseline-invalid-${target.category}`, 'unknown', 'unverified', 'baseline', `${target.label}基线无法读取`, error instanceof Error ? error.message : '清单解析失败。', `无法对${target.label}进行完整逐文件核对；这不等于文件已经损坏。`, '恢复有效清单，或重新创建该冻结版本。', 'FULL-BASELINE-VALID', [target.manifest]))
    }
  }
  for (const { label, category, result } of results) {
    if (result.missing.length) findings.push(finding(`${category}-missing`, 'blocker', 'confirmed', category, `${label}文件缺失`, `基线中的 ${result.missing.length} 个文件已不存在。`, `${label}可能无法启动，或运行内容不完整。`, '从可信备份恢复文件，或重新创建该版本。', 'FULL-FILE-PRESENT', result.missing))
    if (result.changed.length) findings.push(finding(`${category}-changed`, 'blocker', 'confirmed', category, `${label}文件内容变化`, `${result.changed.length} 个文件的 SHA-256 与基线不同。`, `${label}已经不是冻结时的精确内容。`, '确认变化来源；需要可复现版本时从可信备份恢复。', 'FULL-FILE-HASH', result.changed))
    if (result.added.length) findings.push(finding(`${category}-added`, 'warning', 'confirmed', category, `${label}目录出现新增文件`, `${result.added.length} 个文件不在冻结基线中。`, '新增内容可能参与加载，但不会被旧基线证明可信。', '确认这些文件是否为有意添加；否则移出并重新分析。', 'FULL-NO-UNTRACKED-FILES', result.added))
    if (result.unreadable.length) findings.push(finding(`${category}-unreadable`, 'blocker', 'confirmed', category, `${label}文件无法读取`, `${result.unreadable.length} 个文件存在但无法计算 SHA-256。`, '这些文件的内容无法验证，运行时也可能读取失败。', '检查权限、磁盘状态和占用进程后重新分析。', 'FULL-FILE-READABLE', result.unreadable))
  }
  const totals = results.reduce((value, item) => ({ checkedFiles: value.checkedFiles + item.result.checked, missingFiles: value.missingFiles + item.result.missing.length, changedFiles: value.changedFiles + item.result.changed.length, addedFiles: value.addedFiles + item.result.added.length, unreadableFiles: value.unreadableFiles + item.result.unreadable.length }), { checkedFiles: 0, missingFiles: 0, changedFiles: 0, addedFiles: 0, unreadableFiles: 0 })
  if (!findings.length) findings.push(finding('full-pass', 'pass', 'confirmed', 'baseline', '所有文件均与冻结基线一致', `逐文件核对了 ${totals.checkedFiles} 个 SHA-256，且没有发现基线外文件。`, '该完整版本仍保持创建时的精确内容。', '无需处理。', 'FULL-BASELINE-COMPLETE', results.map((item) => `${item.label}：${item.result.checked} 个文件`)))
  const summary: IntegrityReport['summary'] = { ...totals, brokenReferences: 0, findings: findings.length }
  return { findings, summary, rawOutput: findings.flatMap((item) => item.evidence).join('\n') }
}

export const analyzeIntegrity = async (options: { submitSteamValidation?: boolean } = {}): Promise<IntegrityReport> => {
  const snapshot = await getSnapshot()
  const generatedAt = new Date().toISOString()
  const source = snapshot.activeSource
  const shouldSubmitSteamValidation = options.submitSteamValidation !== false
  const steam = source === 'Steam' ? await detectSteamInstallation() : null
  const sourceLabel = source === 'Steam' ? `Steam 原版 ${steam?.version ?? '未知'} · Build ${steam?.buildId ?? '—'}` : snapshot.config?.DisplayName?.trim() || snapshot.config?.Version || '当前冻结版本'
  const outputRoot = source === 'Steam' ? path.join(snapshot.managerRoot ?? app.getPath('userData'), 'reports', 'integrity') : path.join(snapshot.config?.ReportPath || path.join(snapshot.config?.FreezeRoot ?? app.getPath('userData'), 'reports'), 'integrity')
  const methodology = source === 'Steam' ? ['确认 Steam 安装路径和当前二进制身份', shouldSubmitSteamValidation ? '向 Steam 客户端提交 AppID 108600 官方文件验证请求' : '只读模式不向 Steam 提交验证请求，避免验证或更新改变当前文件'] : snapshot.config?.StorageMode === 'ThinReference' ? ['从 projectzomboid.jar 读取实际版本、revision 和 SHA-256', '逐个核对快速版 MOD 引用源、目标文件和硬链接/回退复制内容'] : ['解析创建版本时保存的游戏与 MOD SHA-256 清单', '逐文件重新计算 SHA-256，并检查缺失、变化、新增和不可读文件']
  const limitations = source === 'Steam' ? [shouldSubmitSteamValidation ? 'Steam 没有向启动器提供验证完成回调；提交请求不等于验证已经通过。' : '本次只确认现有安装身份，没有逐文件核对 Steam 官方基线，因此不能宣告文件完整性通过。'] : ['完整性分析证明文件状态是否一致，不判断 MOD 之间能否协同运行。']

  try {
    if (source === 'Steam') {
      if (!steam?.detected || !steam.gamePath) throw new Error(steam?.issue ?? '未识别到 Steam 原版。')
      const submitted = shouldSubmitSteamValidation
      if (submitted) await validateSteamGame()
      const summary: IntegrityReport['summary'] = { checkedFiles: 0, missingFiles: 0, changedFiles: 0, addedFiles: 0, unreadableFiles: 0, brokenReferences: 0, findings: 1 }
      return persist({ schemaVersion: 1, generatedAt, source, sourceLabel, plainSummary: submitted ? '已向 Steam 提交官方文件验证；必须等待 Steam 客户端完成后才能确认结果。' : '只读检查确认了 Steam 游戏身份；本次没有触发 Steam 官方文件验证。', reportPath: null, verdict: 'unknown', methodology, limitations, summary, findings: [finding('steam-external-verification', 'unknown', 'unverified', 'external', submitted ? '等待 Steam 完成官方文件验证' : '本次未触发 Steam 官方文件验证', submitted ? '启动器已经提交验证请求，但 Steam 未提供完成状态。' : '共享流程只读取现有游戏身份，避免 Steam 验证或更新改变正在比对的内容。', '当前不能宣告全部 Steam 文件完整，也不能宣告文件损坏。', submitted ? '等待 Steam 下载页面中的验证任务完成，再返回重新检测游戏身份。' : '需要官方文件验证时，请在完整性维护页面明确执行。', 'STEAM-EXTERNAL-VERIFICATION', [submitted ? 'steam://validate/108600' : 'read-only', steam.gamePath])], rawOutput: submitted ? 'steam://validate/108600' : 'read-only' }, outputRoot)
    }
    if (!snapshot.config) throw new Error(snapshot.issue ?? '当前冻结版本没有可读取的元数据。')
    const analyzed = snapshot.config.StorageMode === 'ThinReference' ? await analyzeThinVersion(snapshot.config) : await analyzeFullVersion(snapshot.config)
    analyzed.findings.sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.title.localeCompare(right.title, 'zh-CN'))
    const verdict = reportVerdict(analyzed.findings)
    return persist({ schemaVersion: 1, generatedAt, source, sourceLabel, plainSummary: plainIntegritySummary(verdict, analyzed.summary), reportPath: null, verdict, storageMode: snapshot.config.StorageMode, methodology, limitations, summary: analyzed.summary, findings: analyzed.findings, rawOutput: analyzed.rawOutput }, outputRoot)
  } catch (error) {
    const message = error instanceof Error ? error.message : '完整性分析失败。'
    const summary: IntegrityReport['summary'] = { checkedFiles: 0, missingFiles: 0, changedFiles: 0, addedFiles: 0, unreadableFiles: 0, brokenReferences: 0, findings: 1 }
    return persist({ schemaVersion: 1, generatedAt, source, sourceLabel, plainSummary: `无法完成分析：${message}`, reportPath: null, verdict: 'unknown', storageMode: snapshot.config?.StorageMode, methodology, limitations: [...limitations, '分析过程没有完成，因此不能把该结果解释为“通过”或“损坏”。'], summary, findings: [finding('integrity-unavailable', 'unknown', 'unverified', 'baseline', '无法形成完整性结论', message, '本次分析没有覆盖全部目标文件。', '按错误提示恢复路径、清单或权限后重新分析。', 'ANALYSIS-COMPLETE', [snapshot.issue ?? message])], rawOutput: message }, outputRoot)
  }
}
