import {
  Archive,
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Copy,
  Database,
  FileClock,
  FolderCog,
  FolderOpen,
  Gamepad2,
  HardDrive,
  LayoutDashboard,
  LoaderCircle,
  Maximize2,
  Minus,
  PanelRightOpen,
  PackageOpen,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  SquareTerminal,
  Wrench,
  Zap,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ActionResult, AnalysisConfidence, CompatibilityReport, CompatibilitySeverity, FileOverlapClassification, FreezeVersionSummary, IntegrityReport, LauncherAction, LauncherSnapshot, MigrationMode, MigrationPreview, MigrationSourceType, ModSummary, SharePackageInspection, SteamInstallation } from '../../shared/types'
import { VaultMark } from './VaultMark'
import { layoutRadarItems } from './radar-layout'

type Notice = { kind: 'success' | 'error'; text: string } | null
type AppView = 'console' | 'versions' | 'maintenance' | 'help' | 'settings'
type VersionDetailSelection = { kind: 'Steam' } | { kind: 'Frozen'; id: string }
type HelpTopicId = 'getting-started' | 'console' | 'versions' | 'migration' | 'compatibility' | 'troubleshooting'
type HelpTutorial = {
  id: HelpTopicId
  number: string
  eyebrow: string
  title: string
  summary: string
  prerequisites: string[]
  sections: Array<{
    title: string
    intro: string
    steps: Array<{ title: string; detail: string }>
  }>
  result: string
  warning?: string
}

const helpTutorials: HelpTutorial[] = [
  {
    id: 'getting-started', number: '01', eyebrow: 'FIRST RUN', title: '首次配置',
    summary: '从识别 Steam 到选定版本库，完成第一次可启动配置。',
    prerequisites: ['Steam 已安装 Project Zomboid', '游戏至少通过 Steam 正常启动过一次', '准备一个空间充足的 NTFS 目录作为版本库'],
    sections: [
      { title: '确认 Steam 原版', intro: '启动器会读取 Steam 库、AppID 108600 清单和游戏二进制身份。', steps: [
        { title: '打开控制台', detail: '看到“Steam 原版”、版本号与 Build 编号，说明游戏目录已被识别。' },
        { title: '处理未识别状态', detail: '先退出并重启 Steam，再回到控制台点击“重新检测”；不要手工伪造 Build 编号。' }
      ] },
      { title: '建立版本库', intro: '版本库保存冻结游戏、独立配置、存档与校验数据。', steps: [
        { title: '进入维护工具', detail: '点击“选择管理目录”，建议使用固定盘符下的独立文件夹，不要选择 Steam 游戏目录本身。' },
        { title: '开启存档保护', detail: '在设置中启用迁移前安全快照，创建版本前会额外备份 Saves、数据库和根配置。' }
      ] }
    ],
    result: '控制台能显示 Steam 版本身份，维护工具能预览目标路径，即完成首次配置。',
    warning: '移动或重命名版本库后，先重新选择管理目录；不要直接修改 current-freeze.json。'
  },
  {
    id: 'console', number: '02', eyebrow: 'PLAY & SWITCH', title: '启动与切换',
    summary: '在 Steam 原版和冻结版之间安全切换，并确认实际启动身份。',
    prerequisites: ['Steam 客户端处于登录状态', '目标版本显示“检查通过”', '联机双方使用相同游戏 Build 与相同 MOD 集合'],
    sections: [
      { title: '选择当前版本', intro: '“当前版本”决定控制台后续的启动、模组扫描、备份和校验目标。', steps: [
        { title: '进入版本管理', detail: '在列表中点击目标版本查看详情；雷达模式下双击光点可切换。' },
        { title: '执行切换', detail: '点击“切换”，等待版本标记变为“当前”。切换只更新指向，不会删除或移动版本文件。' }
      ] },
      { title: '启动并验证', intro: '冻结版仍通过 Steam 身份启动，但游戏文件、缓存和存档来自隔离目录。', steps: [
        { title: '返回控制台启动', detail: '确认名称、版本和 Build 后点击“启动当前版本”，不要同时启动另一个 Project Zomboid 实例。' },
        { title: '检查游戏主菜单', detail: '进入游戏后核对右下角版本号，并在 MOD 页面确认启用列表与目标冻结版一致。' }
      ] }
    ],
    result: '控制台显示目标版本，游戏主菜单版本一致，且独立存档目录可见，说明切换生效。',
    warning: '同一 Steam 账号通常不能同时运行两份受 Steam 管理的游戏；联机还受服务器 Build、MOD ID 和加载顺序约束。'
  },
  {
    id: 'versions', number: '03', eyebrow: 'VERSION LIBRARY', title: '版本管理',
    summary: '使用全局登记册管理 Steam 原版、管理器制作版本和外部冻结版本。',
    prerequisites: ['Steam 原版会自动登记', '管理器制作的版本会随管理目录自动登记', '外部版本目录需要包含 metadata\\freeze.json'],
    sections: [
      { title: '识别三种状态', intro: '版本卡以可启动性为核心，不只依赖文件夹名称。', steps: [
        { title: 'Steam 原版', detail: '由 Steam 更新，Build 可能变化；适合作为新冻结版来源。' },
        { title: '完整冻结版', detail: '游戏、MOD 和可变数据均独立，占用更大但便于整体归档或移动。' },
        { title: '快速薄版本', detail: '直接引用完整冻结版的游戏核心，并以同卷 NTFS 硬链接复用启用 MOD；存档和运行时配置仍保持独立。' }
      ] },
      { title: '登记与日常管理', intro: '版本集合不受当前迁移目标目录限制，登记后会持续显示。', steps: [
        { title: '自动登记', detail: 'Steam 原版和所有已记录管理器目录中的冻结版本会自动进入集合。切换迁移目标目录不会隐藏旧版本。' },
        { title: '导入外部版本', detail: '点击“导入外部版本”，可选择单个冻结版本目录，也可选择包含 frozen 子目录的管理器目录。导入只登记位置，不复制游戏文件。' },
        { title: '查看版本详情', detail: '点击版本卡，核对来源、有效模组、登记时间以及实际文件位置。' },
        { title: '发现不可用版本', detail: '登记项会继续保留并显示不可用；先确认版本目录、game、cache 等核心路径没有被移动或删除。' }
      ] }
    ],
    result: '健康版本可切换、可打开目录且能读取版本和模组摘要；异常版本会被阻止启动。',
    warning: '薄版本依赖同卷 NTFS 文件关系。不要用会破坏硬链接语义的网盘同步或不明清理工具处理版本库。'
  },
  {
    id: 'migration', number: '04', eyebrow: 'FAST MIGRATION', title: '创建与快速迁移',
    summary: '用完整复制或硬链接快速建立新版本，并保护可变数据。',
    prerequisites: ['来源版本健康且游戏已退出', 'Steam 只能创建完整冻结版；快速模式必须选择完整冻结版作为来源', '快速模式的 MOD 硬链接要求来源与目标位于同一个 NTFS 卷', '版本名称必填且目标磁盘空间满足预览要求'],
    sections: [
      { title: '配置迁移任务', intro: '维护工具会在执行前展示来源、目标和预计空间变化。', steps: [
        { title: '选择来源', detail: '从实时 Steam 原版只能做完整复制，可锁定当前 Build；快速迁移必须选择一个非薄版本的完整冻结版。' },
        { title: '选择模式', detail: '需要完全独立或跨盘移动时选“安全完整复制”；同盘快速建版选“快速薄版本”。' },
        { title: '命名并检查预览', detail: '核对计划目标、预计新增、引用游戏核心、挂接 MOD 和预计节省，确认没有阻断警告。' }
      ] },
      { title: '执行后验收', intro: '迁移完成不等于立即删除来源，必须先验证新版本。', steps: [
        { title: '等待登记完成', detail: '终端显示完成后，新版本会自动登记并切换为当前版本。' },
        { title: '连续验证', detail: '先执行完整性校验，再启动到主菜单并打开一个测试存档；确认退出正常后再用于长期游玩。' }
      ] }
    ],
    result: '新版本出现在版本管理中、状态健康、可启动，存档与配置位于自己的 cache 目录。',
    warning: '快速薄版本依赖其基础完整冻结版：基础版不可移动或删除。Saves、数据库、options.ini、日志与运行时 cache 会保持独立，不参与引用或硬链接。'
  },
  {
    id: 'compatibility', number: '05', eyebrow: 'B42 MOD ANALYSIS', title: 'MOD 兼容性分析',
    summary: '读取 B42 版本变体、依赖和文件覆盖证据，判断当前集合是否可用。',
    prerequisites: ['已切换到要检查的版本', 'Workshop 与本地 MOD 文件可访问', '如需对照存档或服务器，相关配置必须位于当前版本缓存中'],
    sections: [
      { title: '运行分析', intro: '分析器按游戏实际目录规则选择 MOD 版本，不会只看 Workshop 标题。', steps: [
        { title: '进入完整性与兼容性', detail: '先确认页面对应当前版本，再点击“开始兼容性分析”。' },
        { title: '理解身份关系', detail: 'Workshop ID 是发布项目，Mod ID 是游戏加载身份；同一 Workshop 可包含多个 Mod ID 和版本变体。' }
      ] },
      { title: '处理报告', intro: '按严重程度从上到下处理，并保留报告中的路径与 ID 证据。', steps: [
        { title: '阻断', detail: '优先修复缺失依赖、循环依赖、重复 Mod ID、明确互斥和不满足的版本条件。' },
        { title: '警告与待验证', detail: '检查加载顺序、存档或服务器清单差异，以及无法仅靠静态文件确认的脚本行为。' },
        { title: '文件重叠', detail: '配置叠加、资源覆盖和代码覆盖含义不同；代码或地图覆盖需要重点核查加载顺序。' }
      ] }
    ],
    result: '阻断项归零，并确认所有警告的理由后，再复制存档进行实际进服或开档验证。',
    warning: '“通过”代表静态证据未发现已知问题，不保证所有 MOD 在运行时绝对兼容。更新 MOD 后应重新分析。'
  },
  {
    id: 'troubleshooting', number: '06', eyebrow: 'RECOVERY', title: '故障排查',
    summary: '针对闪退、版本不符、MOD 缺失和迁移失败进行有证据的排查。',
    prerequisites: ['暂时不要删除来源版本和备份', '记录复现步骤与当前版本名称', '通过设置页面打开日志目录'],
    sections: [
      { title: '启动或闪退', intro: '先区分启动器未拉起游戏、游戏启动后退出、进入存档后崩溃。', steps: [
        { title: '核对版本身份', detail: '查看控制台 Build、游戏主菜单版本以及目标服务器版本，三者必须匹配。' },
        { title: '查看日志', detail: '打开启动器日志和当前版本 cache 下的 console.txt，搜索 ERROR、Exception 和最后加载的 MOD。' },
        { title: '最小化验证', detail: '保留原版本不动，在副本或新测试版本中停用可疑 MOD，逐批恢复以定位问题。' }
      ] },
      { title: '迁移或 MOD 异常', intro: '不要用覆盖复制修补未知状态，先确定缺失的是文件、身份还是依赖。', steps: [
        { title: '运行完整性校验', detail: '确认游戏与本地 MOD 是否偏离创建时 SHA-256 基线。' },
        { title: '运行兼容性分析', detail: '保存缺失依赖、重复 ID、清单差异和覆盖路径，按报告证据修复。' },
        { title: '回退到健康版本', detail: '直接切换回此前健康冻结版；切换操作不会删除故障版本，便于继续取证。' }
      ] }
    ],
    result: '能稳定复现、找到对应日志证据，并在健康版本或最小 MOD 集合中恢复启动，才算完成定位。',
    warning: '不要在没有备份时删除 Saves、Workshop 内容或整个版本目录。需要反馈时请附版本名、Build、操作时间和日志末段。'
  }
]

const HelpTopicIcon = ({ id }: { id: HelpTopicId }): React.JSX.Element => {
  const Icon = id === 'getting-started' ? BookOpen : id === 'console' ? LayoutDashboard : id === 'versions' ? Boxes : id === 'migration' ? Zap : id === 'compatibility' ? ClipboardCheck : Wrench
  return <Icon />
}

const actionPlans: Record<LauncherAction, string[]> = {
  Launch: ['读取并校验当前冻结配置', '绑定独立缓存与启动参数', '启动所选 Project Zomboid 版本'],
  Verify: ['载入游戏与模组 SHA-256 基线', '扫描冻结目录并逐项比对', '生成完整性校验报告'],
  BackupSave: ['检查独立缓存与存档目录', '创建存档压缩快照', '计算摘要并写入备份记录'],
  MigrateSafe: ['验证来源、目标和可用空间', '完整复制游戏、MOD、配置与独立存档', '登记新版本并切换当前目标'],
  MigrateFast: ['验证 NTFS 分区和来源基线', '硬链接复用只读资源并复制可变数据', '记录复用关系并登记新版本']
}

const formatDate = (value?: string | null): string => {
  if (!value) return '暂无记录'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value))
}

const formatBytes = (value?: number): string => {
  if (!value) return '—'
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`
  return `${(value / 1024 ** 2).toFixed(1)} MiB`
}
const compactPath = (value?: string | null): string => value || '尚未配置'
const VERSION_NAME_LIMIT = 24

const VersionName = ({ name, variant = 'list' }: { name: string; variant?: 'list' | 'hero' }): React.JSX.Element => {
  const [revealed, setRevealed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const characters = Array.from(name)
  const isLong = characters.length > VERSION_NAME_LIMIT
  const shortened = isLong ? `${characters.slice(0, VERSION_NAME_LIMIT).join('')}...` : name

  useEffect(() => {
    if (!revealed) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setRevealed(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [revealed])

  return <div className={`version-name-wrap ${variant === 'hero' ? 'hero-version-name' : ''}`} ref={rootRef}>{isLong ? <button className="version-name" onClick={(event) => { event.stopPropagation(); setRevealed((value) => !value) }}>{shortened}</button> : <span className="version-name">{name}</span>}{revealed && isLong && <div className="version-name-full">{name}</div>}</div>
}

type VersionRadarProps = {
  versions: FreezeVersionSummary[]
  steam: SteamInstallation | null
  activeSource: LauncherSnapshot['activeSource']
  onFrozenActivate: (versionId: string) => void
  onSteamActivate: () => void
}

const VersionRadar = ({ versions, steam, activeSource, onFrozenActivate, onSteamActivate }: VersionRadarProps): React.JSX.Element => {
  const items = useMemo(() => {
    const frozen = versions.map((version) => ({ id: version.id, kind: 'Frozen' as const, name: version.name, version: version.version, created: version.created, current: version.isActive, healthy: version.isHealthy }))
    if (!steam?.detected) return frozen
    return [{ id: 'steam-original', kind: 'Steam' as const, name: 'Steam 原版', version: steam.version, created: steam.installedAt ?? undefined, current: activeSource === 'Steam', healthy: true }, ...frozen]
  }, [activeSource, steam, versions])
  const positions = useMemo(() => layoutRadarItems(items.map((item) => ({ key: `${item.kind}-${item.id}`, version: item.version, created: item.created, current: item.current }))), [items])

  return <section className="version-radar-panel enter delay-1">
    <div className="version-radar" role="group" aria-label="版本相对雷达，双击光点切换版本">
      <div className="radar-grid-ring ring-a" /><div className="radar-grid-ring ring-b" /><div className="radar-grid-ring ring-c" />
      <div className="radar-axis horizontal"><span>更早</span><i /><span>更新</span></div>
      <div className="radar-axis vertical"><span>高版本</span><i /><span>低版本</span></div>
      <div className="radar-sweep" />
      {items.map((item, index) => {
        const position = positions[index] ?? { left: 50, top: 50 }
        return <button
          key={`${item.kind}-${item.id}`}
          className={`radar-blip ${item.current ? 'current' : ''} ${item.kind === 'Steam' ? 'steam' : ''} ${item.healthy ? '' : 'unhealthy'}`}
          style={{ left: `${position.left}%`, top: `${position.top}%`, animationDelay: `${index * 180}ms` }}
          aria-disabled={!item.healthy}
          onDoubleClick={() => { if (item.healthy) item.kind === 'Steam' ? onSteamActivate() : onFrozenActivate(item.id) }}
          onKeyDown={(event) => { if (event.key === 'Enter' && item.healthy) item.kind === 'Steam' ? onSteamActivate() : onFrozenActivate(item.id) }}
          aria-label={`${item.name}，版本 ${item.version}，${item.healthy ? '双击或按 Enter 切换' : '当前版本不可切换'}`}
        ><span className="radar-dot" /><span className="radar-tooltip"><b>{item.name}</b><small>版本 {item.version}</small><em>{item.current ? '当前中心' : formatDate(item.created)}</em></span></button>
      })}
      {!items.length && <div className="radar-no-versions">尚无可扫描版本</div>}
    </div>
  </section>
}

const ConsoleVersionRadar = ({ versions, steam, activeSource, onFrozenActivate, onSteamActivate }: VersionRadarProps): React.JSX.Element => {
  const items = useMemo(() => {
    const frozen = versions.map((version) => ({ id: version.id, kind: 'Frozen' as const, name: version.name, version: version.version, created: version.created, current: version.isActive, healthy: version.isHealthy }))
    return steam?.detected
      ? [{ id: 'steam-original', kind: 'Steam' as const, name: 'Steam 原版', version: steam.version, created: steam.installedAt ?? undefined, current: activeSource === 'Steam', healthy: true }, ...frozen]
      : frozen
  }, [activeSource, steam, versions])
  const positions = useMemo(() => layoutRadarItems(items.map((item) => ({ key: `${item.kind}-${item.id}`, version: item.version, created: item.created, current: item.current }))), [items])
  return <div className="console-radar-visual"><div className="console-radar-top"><span>VERSION RADAR</span><b>{items.length} 个版本</b></div><div className="console-radar"><div className="radar-grid-ring ring-a" /><div className="radar-grid-ring ring-b" /><div className="radar-axis horizontal"><i /></div><div className="radar-axis vertical"><i /></div><div className="radar-sweep" />{items.map((item, index) => {
    const position = positions[index] ?? { left: 50, top: 50 }
    return <button key={`${item.kind}-${item.id}`} className={`radar-blip ${item.current ? 'current' : ''} ${item.kind === 'Steam' ? 'steam' : ''} ${item.healthy ? '' : 'unhealthy'}`} style={{ left: `${position.left}%`, top: `${position.top}%`, animationDelay: `${index * 180}ms` }} aria-disabled={!item.healthy} onDoubleClick={() => { if (item.healthy) item.kind === 'Steam' ? onSteamActivate() : onFrozenActivate(item.id) }} onKeyDown={(event) => { if (event.key === 'Enter' && item.healthy) item.kind === 'Steam' ? onSteamActivate() : onFrozenActivate(item.id) }} aria-label={`${item.name}，${item.healthy ? '双击或按 Enter 切换' : '当前版本不可切换'}`}><span className="radar-dot" /><span className="radar-tooltip"><b>{item.name}</b><small>版本 {item.version}</small><em>{item.current ? '当前中心' : item.healthy ? formatDate(item.created) : '不可切换'}</em></span></button>
  })}</div><small className="console-radar-hint">悬停识别 · 双击或按 Enter 切换</small></div>
}

const compatibilityLabels: Record<CompatibilitySeverity, string> = {
  blocker: '阻断',
  warning: '警告',
  unknown: '待验证',
  pass: '通过'
}

const confidenceLabels: Record<AnalysisConfidence, string> = {
  confirmed: '事实已确认',
  inferred: '风险推断',
  unverified: '证据不足'
}

const overlapLabels: Record<FileOverlapClassification, string> = {
  lua: 'Lua 脚本',
  scripts: '游戏脚本',
  map: '地图文件',
  'tile-definition': 'Tile 定义',
  translation: '翻译文件',
  binary: '二进制扩展',
  asset: '资源文件',
  metadata: '元数据',
  other: '其他文件'
}

type ReadableFinding = {
  severity: CompatibilitySeverity
  confidence: AnalysisConfidence
  title: string
  summary: string
  impact: string
  action: string
  rule: string
  evidence: string[]
  appliesToScope?: boolean
}

const FindingCard = ({ entry }: { entry: ReadableFinding }): React.JSX.Element => (
  <article className={`compatibility-issue ${entry.severity} ${entry.appliesToScope === false ? 'out-of-scope' : ''}`}>
    <div className="issue-labels">
      <span className="issue-severity">{compatibilityLabels[entry.severity]}</span>
      <span className={`confidence-label ${entry.confidence}`}>{confidenceLabels[entry.confidence]}</span>
      {entry.appliesToScope === false && <span className="scope-label">其他配置</span>}
    </div>
    <div className="issue-content">
      <b>{entry.title}</b>
      <p>{entry.summary}</p>
      <div className="issue-meaning">
        <p><strong>会有什么影响</strong><span>{entry.impact}</span></p>
        <p><strong>应该怎么处理</strong><span>{entry.action}</span></p>
      </div>
      <details className="issue-evidence">
        <summary>查看判定依据 <span>{entry.rule}</span></summary>
        {entry.evidence.length > 0 ? <code>{entry.evidence.slice(0, 12).join('\n')}</code> : <small>该规则没有额外路径或日志证据。</small>}
      </details>
    </div>
  </article>
)

const ReportMethod = ({ methodology, limitations }: { methodology: string[]; limitations: string[] }): React.JSX.Element => (
  <details className="report-method">
    <summary>这份报告是怎样得出结论的</summary>
    <div><section><b>检查方法</b>{methodology.map((item) => <p key={item}>{item}</p>)}</section><section><b>结论边界</b>{limitations.map((item) => <p key={item}>{item}</p>)}</section></div>
  </details>
)

const CompatibilityResults = ({ report }: { report: CompatibilityReport }): React.JSX.Element => (
  <section className="compatibility-report enter">
    <div className="compatibility-report-header">
      <div><span className="eyebrow">COMPATIBILITY REPORT</span><h2>{report.sourceLabel}</h2><p>生成于 {formatDate(report.generatedAt)} · 报告已保存到 {report.reportPath ?? '应用数据目录'}</p></div>
      <div className={`compatibility-verdict ${report.verdict}`}><span />{compatibilityLabels[report.verdict]}</div>
    </div>
    <div className="report-plain-summary"><b>本次结论</b><p>{report.plainSummary}</p><span>分析范围：{report.scopeLabel}</span></div>
    <div className="compatibility-stats">
      <div><span>已安装 MOD</span><b>{report.summary.installedMods}</b><small>激活 {report.summary.activeMods}</small></div>
      <div className="danger"><span>阻断</span><b>{report.summary.blockers}</b><small>必须处理</small></div>
      <div className="warning"><span>警告</span><b>{report.summary.warnings}</b><small>建议检查</small></div>
      <div className="unknown"><span>待验证</span><b>{report.summary.unknowns}</b><small>需要语义分析</small></div>
      <div><span>路径重叠</span><b>{report.summary.overlapPaths}</b><small>内容相同 {report.summary.identicalOverlapPaths} · 覆盖原版 {report.summary.baseGameOverrides}</small></div>
    </div>
    <div className="identity-evidence">
      <ShieldCheck /><div><b>{report.identity.version} · Build {report.identity.buildId}</b><span>revision {report.identity.revision ?? '未知'} · {report.identity.status === 'stale-cache' ? '运行缓存已过期，以二进制为准' : '二进制身份已解析'}</span></div>
    </div>
    <div className="compatibility-columns">
      <div className="compatibility-issues">
        <div className="report-section-title"><h3>规则结果</h3><span>{report.issues.filter((entry) => entry.appliesToScope).length} 项影响当前范围 · {report.issues.length} 项已列出</span></div>
        {report.issues.map((entry) => <FindingCard entry={entry} key={entry.id} />)}
      </div>
      <div className="overlap-evidence">
        <div className="report-section-title"><h3>文件覆盖证据</h3><span>显示 {report.overlaps.length}/{report.summary.overlapPaths}</span></div>
        {report.overlaps.length ? report.overlaps.slice(0, 40).map((overlap) => <article key={`${overlap.classification}:${overlap.relativePath}`}><div><span className={`overlap-kind ${overlap.severity}`}>{overlapLabels[overlap.classification]}</span>{overlap.contentIdentical === true && <span className="identical-overlap">内容相同</span>}{overlap.semanticStatus === 'keys-disjoint' && <span className="identical-overlap">翻译键不冲突</span>}{overlap.semanticStatus === 'keys-conflict' && <span className="base-override">同键不同值</span>}{overlap.semanticStatus === 'unparsed' && <span className="hash-unavailable">键值未解析</span>}{overlap.contentIdentical === null && <span className="hash-unavailable">哈希未完成</span>}{overlap.overridesBaseGame && <span className="base-override">覆盖原版</span>}</div><code>{overlap.relativePath}</code><small>{overlap.modIds.join(' · ')}</small></article>) : <div className="report-empty"><CheckCircle2 />没有需要展示的同路径覆盖</div>}
      </div>
    </div>
    <ReportMethod methodology={report.methodology} limitations={report.limitations} />
  </section>
)

const IntegrityResults = ({ report }: { report: IntegrityReport }): React.JSX.Element => (
  <section className="compatibility-report integrity-report enter">
    <div className="compatibility-report-header">
      <div><span className="eyebrow">INTEGRITY REPORT</span><h2>{report.sourceLabel}</h2><p>生成于 {formatDate(report.generatedAt)} · 报告已保存到 {report.reportPath ?? '应用数据目录'}</p></div>
      <div className={`compatibility-verdict ${report.verdict}`}><span />{compatibilityLabels[report.verdict]}</div>
    </div>
    <div className="report-plain-summary"><b>本次结论</b><p>{report.plainSummary}</p><span>存储方式：{report.storageMode === 'ThinReference' ? '快速迁移版（引用与回退复制）' : report.storageMode === 'FullCopy' ? '全量迁移版（独立文件）' : 'Steam 原版'}</span></div>
    <div className="compatibility-stats integrity-stats">
      <div><span>已检查项目</span><b>{report.summary.checkedFiles}</b><small>{report.storageMode === 'ThinReference' ? '文件与引用' : '基线文件'}</small></div>
      <div className="danger"><span>缺失</span><b>{report.summary.missingFiles}</b><small>基线内容不存在</small></div>
      <div className="warning"><span>变化</span><b>{report.summary.changedFiles}</b><small>SHA-256 不一致</small></div>
      <div className="warning"><span>新增</span><b>{report.summary.addedFiles}</b><small>基线外内容</small></div>
      <div className="danger"><span>不可读</span><b>{report.summary.unreadableFiles}</b><small>无法完成哈希</small></div>
      <div className="unknown"><span>断裂引用</span><b>{report.summary.brokenReferences}</b><small>快速版依赖异常</small></div>
    </div>
    <div className="integrity-findings">
      <div className="report-section-title"><h3>文件与结构结论</h3><span>{report.findings.length} 项</span></div>
      {report.findings.map((entry) => <FindingCard entry={entry} key={entry.id} />)}
    </div>
    <ReportMethod methodology={report.methodology} limitations={report.limitations} />
  </section>
)

export const App = (): React.JSX.Element => {
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null)
  const [versions, setVersions] = useState<FreezeVersionSummary[]>([])
  const [busyAction, setBusyAction] = useState<LauncherAction | null>(null)
  const [switchingId, setSwitchingVersion] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<ActionResult | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const previewMode = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null
  const previewView = previewMode?.get('view')
  const [activeView, setActiveView] = useState<AppView>(['versions', 'maintenance', 'help', 'settings'].includes(previewView ?? '') ? previewView as AppView : 'console')
  const previewHelpTopic = previewMode?.get('helpTopic') as HelpTopicId | null
  const [activeHelpTopic, setActiveHelpTopic] = useState<HelpTopicId | null>(() => helpTutorials.some((topic) => topic.id === previewHelpTopic) ? previewHelpTopic : null)
  const helpScrollRef = useRef<HTMLDivElement>(null)
  const [isDrawerOpen, setDrawerOpen] = useState(previewMode?.get('drawer') === 'open')
  const [detailSelection, setDetailSelection] = useState<VersionDetailSelection | null>(null)
  const [isModsDrawerOpen, setModsDrawerOpen] = useState(previewMode?.get('mods') === 'open')
  const [currentMods, setCurrentMods] = useState<ModSummary[]>([])
  const [modsLoading, setModsLoading] = useState(false)
  const [analysisMode, setAnalysisMode] = useState<'integrity' | 'compatibility'>('integrity')
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport | null>(null)
  const [integrityLoading, setIntegrityLoading] = useState(false)
  const [compatibilityReport, setCompatibilityReport] = useState<CompatibilityReport | null>(null)
  const [compatibilityLoading, setCompatibilityLoading] = useState(false)
  const [showAnalysisResponsibilities, setShowAnalysisResponsibilities] = useState(false)
  const [isTerminalOpen, setTerminalOpen] = useState(previewMode?.get('terminal') === 'open')
  const [isTerminalPinned, setTerminalPinned] = useState(false)
  const [showTerminal, setShowTerminal] = useState(() => previewMode?.get('terminal') === 'open' || window.localStorage.getItem('pz-vault-show-terminal') === 'true' || window.localStorage.getItem('pz-vault-show-recent-activity') === 'true')
  const [showVersionRadar, setShowVersionRadar] = useState(() => previewMode?.get('versionView') === 'radar' || window.localStorage.getItem('pz-vault-version-registry-view') === 'radar')
  const [steam, setSteam] = useState<SteamInstallation | null>(null)
  const [maintenanceSection, setMaintenanceSection] = useState<'version-control' | 'integrity' | 'share'>('version-control')
  const [migrationMode, setMigrationMode] = useState<MigrationMode>('SafeCopy')
  const [migrationSourceType, setMigrationSourceType] = useState<MigrationSourceType>('Steam')
  const [migrationSourceId, setMigrationSourceId] = useState('')
  const [migrationLabel, setMigrationLabel] = useState('')
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [versionImportBusy, setVersionImportBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState<'create' | 'inspect' | 'install' | null>(null)
  const [shareInspection, setShareInspection] = useState<SharePackageInspection | null>(null)
  const [saveProtection, setSaveProtection] = useState(() => window.localStorage.getItem('pz-vault-save-protection') === 'true')
  const [showSaveOnboarding, setShowSaveOnboarding] = useState(() => previewMode?.get('onboarding') === 'open' || (!import.meta.env.DEV && window.localStorage.getItem('pz-vault-save-onboarding-seen') !== 'true'))

  const refresh = useCallback(async () => {
    const [nextSnapshot, nextVersions, nextSteam] = await Promise.all([window.vault.getSnapshot(), window.vault.listVersions(), window.vault.detectSteam()])
    setSnapshot(nextSnapshot)
    setVersions(nextVersions)
    setSteam(nextSteam)
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3800)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (activeHelpTopic) helpScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [activeHelpTopic])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
        setDetailSelection(null)
        setModsDrawerOpen(false)
        setTerminalOpen(false)
        setTerminalPinned(false)
        setActiveHelpTopic(null)
        setShowAnalysisResponsibilities(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])
  useEffect(() => {
    if (!snapshot?.managerRoot) {
      setMigrationPreview(null)
      return
    }
    const request = { sourceType: migrationSourceType, sourceId: migrationSourceType === 'Frozen' ? migrationSourceId : undefined, mode: migrationMode, label: migrationLabel || undefined, protectSaves: saveProtection }
    let active = true
    void window.vault.previewMigration(request).then((preview) => { if (active) setMigrationPreview(preview) })
    return () => { active = false }
  }, [snapshot?.managerRoot, migrationSourceType, migrationSourceId, migrationMode, migrationLabel, saveProtection, versions.length])

  const chooseRoot = async (): Promise<void> => {
    const next = await window.vault.chooseManagerRoot()
    setSnapshot(next)
    setVersions(await window.vault.listVersions())
    if (next.isHealthy) {
      setNotice({ kind: 'success', text: '冻结环境已连接' })
      setDrawerOpen(true)
    } else if (next.managerRoot) {
      setNotice({ kind: 'success', text: '版本库目录已就绪，可以从 Steam 原版创建首个受管版本' })
    }
  }

  const importExternalVersion = async (): Promise<void> => {
    setVersionImportBusy(true)
    try {
      const result = await window.vault.importVersion()
      if (result.canceled) return
      setVersions(await window.vault.listVersions())
      setNotice({ kind: result.imported ? 'success' : 'error', text: result.message })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '外部版本导入失败。' })
    } finally {
      setVersionImportBusy(false)
    }
  }

  const createShareManifest = async (): Promise<void> => {
    setShareBusy('create')
    try {
      const result = await window.vault.createSharePackage()
      if (result.canceled) return
      setNotice({ kind: result.ok ? 'success' : 'error', text: result.message })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '共享清单制作失败。' })
    } finally {
      setShareBusy(null)
    }
  }

  const inspectSharedManifest = async (): Promise<void> => {
    setShareBusy('inspect')
    try {
      const result = await window.vault.inspectSharePackage()
      if (result.canceled) return
      setShareInspection(result)
      setNotice({ kind: result.valid ? 'success' : 'error', text: result.message })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '共享包验证失败。' })
    } finally {
      setShareBusy(null)
    }
  }

  const installSharedManifest = async (): Promise<void> => {
    if (!shareInspection?.filePath) return
    setShareBusy('install')
    try {
      const result = await window.vault.installSharePackage(shareInspection.filePath)
      setNotice({ kind: result.ok ? 'success' : 'error', text: result.message })
      if (result.installedRoot) {
        await refresh()
        setIntegrityReport(null)
        setCompatibilityReport(null)
      }
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '共享版本安装失败。' })
    } finally {
      setShareBusy(null)
    }
  }

  const activateVersion = async (versionId: string): Promise<void> => {
    setSwitchingVersion(versionId)
    try {
      const next = await window.vault.activateVersion(versionId)
      setIntegrityReport(null)
      setCompatibilityReport(null)
      setSnapshot(next)
      setVersions(await window.vault.listVersions())
      const selected = versions.find((version) => version.id === versionId)
      setNotice({ kind: 'success', text: `已切换到“${selected?.name ?? versionId}”` })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '版本切换失败。' })
    } finally {
      setSwitchingVersion(null)
    }
  }

  const activateSteam = async (): Promise<void> => {
    setSwitchingVersion('steam-original')
    try {
      const next = await window.vault.activateSteam()
      setIntegrityReport(null)
      setCompatibilityReport(null)
      setSnapshot(next)
      setVersions(await window.vault.listVersions())
      setNotice({ kind: 'success', text: '已将“Steam 原版”设为当前版本' })
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Steam 原版切换失败。' })
    } finally {
      setSwitchingVersion(null)
    }
  }

  const toggleTerminal = (): void => {
    const next = !showTerminal
    setShowTerminal(next)
    if (!next) {
      setTerminalOpen(false)
      setTerminalPinned(false)
    }
    window.localStorage.setItem('pz-vault-show-terminal', String(next))
  }

  const toggleVersionRadar = (): void => {
    const next = !showVersionRadar
    setShowVersionRadar(next)
    window.localStorage.setItem('pz-vault-version-registry-view', next ? 'radar' : 'list')
  }

  const updateSaveProtection = (enabled: boolean): void => {
    setSaveProtection(enabled)
    window.localStorage.setItem('pz-vault-save-protection', String(enabled))
    window.localStorage.setItem('pz-vault-save-onboarding-seen', 'true')
    setShowSaveOnboarding(false)
  }

  const migrateVersion = async (): Promise<void> => {
    const action: LauncherAction = migrationMode === 'SafeCopy' ? 'MigrateSafe' : 'MigrateFast'
    setMigrationBusy(true)
    setBusyAction(action)
    setLastResult(null)
    if (showTerminal) setTerminalOpen(true)
    try {
      const result = await window.vault.executeMigration({ sourceType: migrationSourceType, sourceId: migrationSourceType === 'Frozen' ? migrationSourceId : undefined, mode: migrationMode, label: migrationLabel || undefined, protectSaves: saveProtection })
      setLastResult(result)
      setNotice({ kind: result.ok ? 'success' : 'error', text: result.message })
      if (result.ok) {
        setIntegrityReport(null)
        setCompatibilityReport(null)
      }
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '迁移执行失败。' })
    } finally {
      setBusyAction(null)
      setMigrationBusy(false)
    }
  }

  const perform = async (action: LauncherAction): Promise<void> => {
    setBusyAction(action)
    setLastResult(null)
    if (showTerminal) setTerminalOpen(true)
    try {
      const result = await window.vault.runAction(action)
      setLastResult(result)
      setNotice({ kind: result.ok ? 'success' : 'error', text: result.message })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请查看日志。' })
    } finally {
      setBusyAction(null)
    }
  }

  const runCompatibilityAnalysis = async (): Promise<void> => {
    setAnalysisMode('compatibility')
    setCompatibilityLoading(true)
    setCompatibilityReport(null)
    try {
      const report = await window.vault.analyzeCompatibility()
      setCompatibilityReport(report)
      setNotice({ kind: report.verdict === 'blocker' ? 'error' : 'success', text: report.verdict === 'blocker' ? `兼容性分析完成：发现 ${report.summary.blockers} 个阻断项` : '兼容性分析完成' })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '兼容性分析失败。' })
    } finally {
      setCompatibilityLoading(false)
    }
  }

  const runIntegrityAnalysis = async (): Promise<void> => {
    setAnalysisMode('integrity')
    setIntegrityLoading(true)
    setBusyAction('Verify')
    setLastResult(null)
    if (showTerminal) setTerminalOpen(true)
    try {
      const report = await window.vault.analyzeIntegrity()
      setIntegrityReport(report)
      const ok = report.verdict === 'pass'
      setLastResult({ ok, action: 'Verify', message: ok ? '完整性分析通过。' : report.verdict === 'unknown' ? '完整性分析等待外部验证。' : '完整性分析发现阻断项。', output: report.rawOutput, finishedAt: report.generatedAt })
      setNotice({ kind: ok ? 'success' : report.verdict === 'unknown' ? 'success' : 'error', text: ok ? '完整性分析完成：内容与登记基线一致' : report.verdict === 'unknown' ? '已提交验证，当前结论为待验证' : `完整性分析完成：发现 ${report.summary.findings} 个结论项` })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '完整性分析失败。' })
    } finally {
      setBusyAction(null)
      setIntegrityLoading(false)
    }
  }

  const openEnvironment = (): void => {
    if (!snapshot) return
    setModsDrawerOpen(false)
    setDetailSelection(snapshot.activeSource === 'Steam' ? { kind: 'Steam' } : activeVersion ? { kind: 'Frozen', id: activeVersion.id } : null)
    setDrawerOpen(true)
  }


  const openVersionDetails = (selection: VersionDetailSelection): void => {
    setModsDrawerOpen(false)
    setDetailSelection(selection)
    setDrawerOpen(true)
  }

  const status = useMemo(() => {
    if (snapshot?.activeSource === 'Steam') return steam?.detected ? { text: 'Steam 原版就绪', tone: 'success' } : { text: 'Steam 原版不可用', tone: 'danger' }
    if (!snapshot?.isConfigured) return { text: '等待连接', tone: 'neutral' }
    if (!snapshot.isHealthy) return { text: '需要处理', tone: 'danger' }
    return { text: '隔离环境就绪', tone: 'success' }
  }, [snapshot, steam])
  const isBusy = busyAction !== null
  const terminalAction = busyAction ?? lastResult?.action ?? null
  const terminalPlan = terminalAction ? actionPlans[terminalAction] : []
  const activeVersion = versions.find((version) => version.isActive)
  const legacyVersionName = snapshot?.config?.FreezeRoot?.split(/[\\/]/).filter(Boolean).pop()
  const currentDisplayName = snapshot?.activeSource === 'Steam' ? 'Steam 原版' : activeVersion?.name ?? snapshot?.config?.DisplayName ?? legacyVersionName ?? '尚未选择版本'
  const isSteamCurrent = snapshot?.activeSource === 'Steam'
  const effectiveDetailSelection = detailSelection ?? (isSteamCurrent ? { kind: 'Steam' as const } : activeVersion ? { kind: 'Frozen' as const, id: activeVersion.id } : null)
  const detailIsSteam = effectiveDetailSelection?.kind === 'Steam'
  const detailFrozen = effectiveDetailSelection?.kind === 'Frozen' ? versions.find((version) => version.id === effectiveDetailSelection.id) : null
  const detailIsCurrent = detailIsSteam ? isSteamCurrent : Boolean(detailFrozen?.isActive)
  const detailHealthy = detailIsSteam ? Boolean(steam?.detected) : Boolean(detailFrozen?.isHealthy)
  const detailName = detailIsSteam ? 'Steam 原版' : detailFrozen?.name ?? '版本未知'
  const detailTechnicalVersion = detailIsSteam ? steam?.version : detailFrozen?.version
  const detailBuildId = detailIsSteam ? steam?.buildId : detailFrozen?.buildId
  const detailRoot = detailIsSteam ? steam?.gamePath : detailFrozen?.freezeRoot
  const detailQuarantined = detailFrozen?.shareInstallStatus === 'Quarantined'
  const detailHealthTitle = detailQuarantined ? '共享版本已隔离' : detailHealthy ? '版本检查通过' : '版本不可用'
  const detailHealthText = detailQuarantined
    ? '安装后的游戏或 MOD 指纹与共享清单不一致，管理器已禁止切换和启动。'
    : detailIsSteam
      ? steam?.issue ?? 'Steam 原版、Workshop 与用户目录已识别。'
      : detailHealthy ? '游戏、缓存和版本路径均可访问。' : '该冻结版本缺少必要的游戏、缓存目录或基础依赖。'
  const detailBuildKind = detailIsSteam ? 'STEAM MANAGED' : detailFrozen?.shareInstallStatus === 'Verified' ? 'VERIFIED SHARE BUILD' : detailQuarantined ? 'QUARANTINED SHARE BUILD' : 'FROZEN BUILD'
  const openCurrentVersionPath = (): void => {
    if (detailRoot) void window.vault.openPath(detailRoot)
  }
  const openVersionData = (kind: 'saves' | 'backups'): void => {
    const cachePath = isSteamCurrent ? steam?.cachePath : snapshot?.config?.CachePath
    const target = kind === 'saves'
      ? cachePath ? `${cachePath}\\Saves` : null
      : isSteamCurrent ? null : snapshot?.config?.BackupPath
    if (target) void window.vault.openPath(target)
  }

  const openMods = async (): Promise<void> => {
    setDrawerOpen(false)
    setDetailSelection(null)
    setModsDrawerOpen(true)
    setModsLoading(true)
    try {
      setCurrentMods(await window.vault.listCurrentMods())
    } catch (error) {
      setCurrentMods([])
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '无法读取当前版本的模组列表。' })
    } finally {
      setModsLoading(false)
    }
  }

  useEffect(() => {
    if (previewMode?.get('mods') === 'open') void openMods()
  }, [])

  const environmentButton = (
    <button className="environment-button" onClick={openEnvironment}>
      <FolderOpen /><span><b>{snapshot ? currentDisplayName : '正在读取当前版本'}</b><small>{snapshot?.activeSource === 'Steam' ? steam?.gamePath ?? 'Steam 原版' : snapshot?.config?.FreezeRoot ?? snapshot?.managerRoot ?? '尚未选择版本库'}</small></span>
      {snapshot?.isConfigured ? <PanelRightOpen /> : <ChevronRight />}
    </button>
  )
  const consoleVersionTools = <section className="console-version-tools single enter delay-3"><button onClick={() => openVersionData('saves')}><div className="console-tool-icon blue"><Database /></div><span><b>存档信息</b><small>查看当前版本独立 Saves</small></span><ChevronRight /></button></section>
  const steamMetricGrid = steam?.detected ? <section className="metric-grid enter delay-2">
    <article className="metric-card"><div className="metric-icon safe"><ShieldCheck /></div><div><span>环境状态</span><strong>Steam 托管</strong><small>游戏、Workshop 与用户目录已识别</small></div><CheckCircle2 className="ok" /></article>
    <button className="metric-card interactive" onClick={() => void openMods()}><div className="metric-icon"><Database /></div><div><span>Workshop 项目</span><strong>{steam.workshopProjectCount ?? '—'}</strong><small>点击查看当前可识别模组</small></div><Gamepad2 className="muted" /></button>
    <article className="metric-card"><div className="metric-icon amber"><HardDrive /></div><div><span>版本来源</span><strong>Steam 原版</strong><small>{formatDate(steam.installedAt)} · 实时更新</small></div><RefreshCw className="muted" /></article>
  </section> : null
  const selectedHelpTutorial = helpTutorials.find((topic) => topic.id === activeHelpTopic) ?? null
  const selectedHelpIndex = selectedHelpTutorial ? helpTutorials.findIndex((topic) => topic.id === selectedHelpTutorial.id) : -1

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand-mark"><VaultMark /></div>
        <div className="brand-copy"><strong>ZOMBOID VAULT</strong><span>ISOLATED BUILD MANAGER</span></div>
        <div className="titlebar-spacer" />
        <button className="window-button" onClick={() => void window.vault.minimizeWindow()} aria-label="最小化"><Minus /></button>
        <button className="window-button" onClick={() => void window.vault.toggleMaximizeWindow()} aria-label="最大化"><Maximize2 /></button>
        <button className="window-button close" onClick={() => void window.vault.closeWindow()} aria-label="关闭"><X /></button>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="nav-section-label">工作区</div>
          <nav>
            <button className={`nav-item ${activeView === 'console' ? 'active' : ''}`} onClick={() => setActiveView('console')}><LayoutDashboard /><span>控制台</span></button>
            <button className={`nav-item ${activeView === 'versions' ? 'active' : ''}`} onClick={() => setActiveView('versions')}><Boxes /><span>版本管理</span></button>
            <button className={`nav-item ${activeView === 'maintenance' ? 'active' : ''}`} onClick={() => setActiveView('maintenance')}><Wrench /><span>维护工具</span></button>
          </nav>
          <div className="nav-section-label utility-label">快捷入口</div>
          <nav>
            <button className={`nav-item ${activeView === 'help' ? 'active' : ''}`} onClick={() => setActiveView('help')}><BookOpen /><span>帮助</span></button>
            <button className="nav-item" onClick={openEnvironment}><FolderCog /><span>版本详情</span></button>
          </nav>
          <div className="sidebar-foot">
            <div className="engine-chip"><span className="pulse-dot" /><div><b>ENGINE ONLINE</b><span>{snapshot?.enginePath ? 'PowerShell + Native' : 'Native Vault Core'}</span></div></div>
            <button className={`icon-button ${activeView === 'settings' ? 'active' : ''}`} aria-label="设置" onClick={() => setActiveView('settings')}><Settings2 /></button>
          </div>
        </aside>

        <main className="main-content">
          {activeView === 'console' ? (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">PROJECT ZOMBOID / BUILD VAULT</span><h1>幸存者控制台</h1><p>查看当前隔离环境，并从这里开始游戏。</p></div>{environmentButton}</section>
              {!snapshot ? (
                <div className="loading-state"><LoaderCircle className="spin" />正在读取环境</div>
              ) : snapshot.activeSource === 'Steam' ? steam?.detected ? (
                <><section className="hero-panel enter delay-1"><div className="hero-glow" /><div className="hero-content"><div className="status-pill success"><span />当前版本 · STEAM</div><h2>Steam 原版</h2><div className="build-line"><span>版本 {steam.version}</span><i /><span>Build {steam.buildId}</span></div><p className="hero-description">从统一版本集合启动；游戏文件由 Steam 管理，模组、存档和兼容性工具仍围绕当前版本工作。</p><div className="hero-actions"><button className="launch-button" disabled={isBusy} onClick={() => void perform('Launch')}>{busyAction === 'Launch' ? <LoaderCircle className="spin" /> : <Play fill="currentColor" />}<span><b>启动当前版本</b><small>STEAM MANAGED</small></span></button><button className="secondary-button" onClick={() => setDrawerOpen(true)}><PanelRightOpen />版本详情</button></div></div><ConsoleVersionRadar versions={versions} steam={steam} activeSource={snapshot.activeSource} onFrozenActivate={(id) => void activateVersion(id)} onSteamActivate={() => void activateSteam()} /></section>{steamMetricGrid}{consoleVersionTools}</>
              ) : (
                <section className="empty-state enter delay-1"><div className="radar"><span /><span /><span /><ShieldAlert /></div><span className="eyebrow">STEAM NOT DETECTED</span><h2>没有找到 Project Zomboid 原版</h2><p>{steam?.issue ?? '正在检测 Steam 与 AppID 108600。'}</p><button className="primary-button" onClick={() => void refresh()}><RefreshCw />重新检测</button></section>
              ) : (
                <>
                  <section className="hero-panel enter delay-1">
                    <div className="hero-glow" /><div className="hero-content"><div className={`status-pill ${status.tone}`}><span />{status.text}</div><VersionName name={currentDisplayName} variant="hero" /><div className="build-line"><span>版本 {snapshot.config?.Version ?? '未知'}</span><i /><span>Build {snapshot.config?.BuildID ?? '—'}</span></div><p className="hero-description">从隔离目录启动，保留独立游戏文件、模组、配置与存档。</p>{snapshot.issue && <div className="issue-line"><CircleAlert />{snapshot.issue}</div>}<div className="hero-actions"><button className="launch-button" disabled={!snapshot.isHealthy || isBusy} onClick={() => void perform('Launch')}>{busyAction === 'Launch' ? <LoaderCircle className="spin" /> : <Play fill="currentColor" />}<span><b>启动当前版本</b><small>ISOLATED MODE</small></span></button><button className="secondary-button" onClick={() => setDrawerOpen(true)}><PanelRightOpen />版本详情</button></div></div>
                    <ConsoleVersionRadar versions={versions} steam={steam} activeSource={snapshot.activeSource} onFrozenActivate={(id) => void activateVersion(id)} onSteamActivate={() => void activateSteam()} />
                  </section>
                  <section className="metric-grid enter delay-2">
                    <article className="metric-card"><div className="metric-icon safe"><ShieldCheck /></div><div><span>环境状态</span><strong>{snapshot.isHealthy ? '安全隔离' : '配置异常'}</strong><small>{snapshot.isHealthy ? '核心路径检查通过' : '需要重新定位环境'}</small></div><CheckCircle2 className={snapshot.isHealthy ? 'ok' : 'muted'} /></article>
                    <button className="metric-card interactive" onClick={() => void openMods()}><div className="metric-icon"><Database /></div><div><span>有效模组</span><strong>{snapshot.config?.EffectiveModCount ?? '—'}</strong><small>点击查看模组名称与标识</small></div><Gamepad2 className="muted" /></button>
                    <button className="metric-card interactive" disabled={!snapshot.config?.BackupPath} onClick={() => openVersionData('backups')}><div className="metric-icon amber"><Archive /></div><div><span>备份信息</span><strong>{formatDate(snapshot.lastBackup?.createdAt)}</strong><small>{snapshot.lastBackup ? formatBytes(snapshot.lastBackup.size) : '打开当前版本备份目录'}</small></div><FileClock className="muted" /></button>
                  </section>
                  {consoleVersionTools}
                </>
              )}
            </>
          ) : activeView === 'versions' ? (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">GLOBAL VERSION REGISTRY</span><h1>版本集合</h1><p>集中登记 Steam 原版、所有管理器制作版本和外部导入版本；迁移目标目录不再限制这里的可见范围。</p></div><div className="page-heading-actions"><button className="secondary-button" disabled={versionImportBusy} onClick={() => void importExternalVersion()}>{versionImportBusy ? <LoaderCircle className="spin" /> : <PackageOpen />}导入外部版本</button><button className="secondary-button" onClick={() => void chooseRoot()}><FolderCog />设置迁移目标目录</button></div></section>
              {showVersionRadar ? <VersionRadar versions={versions} steam={steam} activeSource={snapshot?.activeSource ?? 'Steam'} onFrozenActivate={(id) => void activateVersion(id)} onSteamActivate={() => void activateSteam()} /> : <section className="version-grid enter delay-1">
                <article className={`version-card version-list-card ${steam?.detected ? '' : 'unavailable'} ${snapshot?.activeSource === 'Steam' ? 'active' : ''}`} role={steam?.detected ? 'button' : undefined} tabIndex={steam?.detected ? 0 : -1} aria-disabled={!steam?.detected} onClick={steam?.detected ? () => openVersionDetails({ kind: 'Steam' }) : undefined} onKeyDown={steam?.detected ? (event) => { if (event.key === 'Enter') openVersionDetails({ kind: 'Steam' }) } : undefined}><div className="version-list-main"><div className="version-badge">ST</div><div className="version-identity"><VersionName name="Steam 原版" /><div className="version-build">版本 {steam?.version ?? '未知'} · Build {steam?.buildId ?? '—'}</div></div><div className="version-hover-details"><span>来源 <b>Steam 自动登记</b></span><span>Workshop <b>{steam?.workshopProjectCount ?? '—'}</b></span><span>更新时间 <b>{formatDate(steam?.installedAt)}</b></span></div><button className={`tool-action ${snapshot?.activeSource === 'Steam' ? '' : 'primary'}`} disabled={!steam?.detected || snapshot?.activeSource === 'Steam' || switchingId !== null} onClick={(event) => { event.stopPropagation(); void activateSteam() }}>{switchingId === 'steam-original' ? <LoaderCircle className="spin" /> : snapshot?.activeSource === 'Steam' ? <CheckCircle2 /> : <RefreshCw />}{snapshot?.activeSource === 'Steam' ? '当前' : '切换'}</button><ChevronRight className="version-open-icon" /></div></article>
                {versions.map((version) => <article className={`version-card version-list-card ${version.isActive ? 'active' : ''} ${version.isHealthy ? '' : 'unavailable'} ${version.shareInstallStatus === 'Quarantined' ? 'quarantined' : ''}`} key={version.id} role="button" tabIndex={0} onClick={() => openVersionDetails({ kind: 'Frozen', id: version.id })} onKeyDown={(event) => { if (event.key === 'Enter') openVersionDetails({ kind: 'Frozen', id: version.id }) }}><div className="version-list-main"><div className="version-badge">PZ</div><div className="version-identity"><VersionName name={version.name} /><div className="version-build">版本 {version.version} · Build {version.buildId ?? '—'}</div></div><div className="version-hover-details"><span>来源 <b>{version.shareInstallStatus === 'Verified' ? '共享包验证安装' : version.shareInstallStatus === 'Quarantined' ? '共享包隔离' : version.origin === 'External' ? '外部导入' : '管理器制作'}</b></span><span>有效模组 <b>{version.effectiveModCount ?? '—'}</b></span><span>登记时间 <b>{formatDate(version.registeredAt ?? version.created)}</b></span></div><button className={`tool-action ${version.isActive ? '' : 'primary'}`} disabled={version.isActive || !version.isHealthy || switchingId !== null} onClick={(event) => { event.stopPropagation(); void activateVersion(version.id) }}>{switchingId === version.id ? <LoaderCircle className="spin" /> : version.isActive ? <CheckCircle2 /> : <RefreshCw />}{version.shareInstallStatus === 'Quarantined' ? '已隔离' : version.isActive ? '当前' : '切换'}</button><ChevronRight className="version-open-icon" /></div></article>)}
                {!versions.length && <div className="version-empty compact"><Boxes /><h2>还没有登记冻结版本</h2><p>可以从 Steam 创建第一个版本，或导入包含 metadata\\freeze.json 的外部冻结版本目录。</p><div className="version-empty-actions"><button className="primary-button" onClick={() => { setMaintenanceSection('version-control'); setActiveView('maintenance') }}><ArrowRight />开始版本控制</button><button className="secondary-button" onClick={() => void importExternalVersion()}><PackageOpen />导入外部版本</button></div></div>}
              </section>}
            </>
          ) : activeView === 'maintenance' ? (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">VAULT OPERATIONS</span><h1>维护工具</h1><p>创建受管版本、检查兼容性或导入玩家共享包。</p></div><button className="secondary-button" onClick={() => void chooseRoot()}><FolderCog />{snapshot?.managerRoot ? '更换管理目录' : '选择管理目录'}</button></section>
              <div className="maintenance-mode-tabs enter delay-1"><button className={maintenanceSection === 'version-control' ? 'active' : ''} onClick={() => setMaintenanceSection('version-control')}><Boxes />版本控制</button><button className={maintenanceSection === 'integrity' ? 'active' : ''} onClick={() => setMaintenanceSection('integrity')}><ClipboardCheck />完整性与兼容性</button><button className={maintenanceSection === 'share' ? 'active' : ''} onClick={() => setMaintenanceSection('share')}><PackageOpen />共享包</button></div>
              {maintenanceSection === 'version-control' ? <section className="migration-workflow enter delay-2">
                <div className="workflow-header"><div><span className="eyebrow">NEW MANAGED VERSION</span><h2>创建受管版本</h2><p>明确选择来源、迁移模式和目标库。每次执行都会创建新的版本目录，不要求目标中预先存在文件。</p></div><div className={`workflow-ready ${migrationPreview?.canRun ? 'ready' : ''}`}><span />{migrationPreview?.canRun ? '可以执行' : '等待配置'}</div></div>
                <div className="workflow-step"><div className="step-index">1</div><div className="step-body"><h3>选择迁移来源</h3><p>来源可以是实时 Steam 原版，也可以是版本库中的任意冻结版本。</p><div className="choice-grid source-choices"><button className={migrationSourceType === 'Steam' ? 'selected' : ''} onClick={() => { setMigrationSourceType('Steam'); setMigrationSourceId('') }}><div className="choice-icon steam"><span>ST</span></div><div><b>Steam 原版</b><small>{steam?.detected ? `${steam.version} · Build ${steam.buildId}` : steam?.issue ?? '正在检测'}</small></div>{migrationSourceType === 'Steam' && <CheckCircle2 />}</button><button className={migrationSourceType === 'Frozen' ? 'selected' : ''} disabled={!versions.length} onClick={() => { setMigrationSourceType('Frozen'); setMigrationSourceId((current) => current || versions[0]?.id || '') }}><div className="choice-icon"><Boxes /></div><div><b>已有冻结版本</b><small>{versions.length ? `${versions.length} 个版本可选` : '版本库为空'}</small></div>{migrationSourceType === 'Frozen' && <CheckCircle2 />}</button></div>{migrationSourceType === 'Frozen' && <label className="field-label">具体来源<select value={migrationSourceId} onChange={(event) => setMigrationSourceId(event.target.value)}><option value="">请选择冻结版本</option>{versions.map((version) => <option value={version.id} key={version.id}>{version.name} · {version.version} · Build {version.buildId ?? '—'}{version.isActive ? '（当前）' : ''}</option>)}</select></label>}</div></div>
                <div className="workflow-step"><div className="step-index">2</div><div className="step-body"><h3>选择迁移模式</h3><p>完整复制可独立移动；快速薄版本依赖一个不可变冻结版，只新增当前版本真正需要的文件。</p><div className="choice-grid mode-choices"><button className={migrationMode === 'SafeCopy' ? 'selected' : ''} onClick={() => setMigrationMode('SafeCopy')}><div className="choice-icon"><Copy /></div><div><b>安全完整复制</b><small>游戏、MOD、配置和存档全部独立</small><em>可独立归档</em></div>{migrationMode === 'SafeCopy' && <CheckCircle2 />}</button><button className={migrationMode === 'FastLink' ? 'selected risk' : 'risk'} onClick={() => setMigrationMode('FastLink')}><div className="choice-icon amber"><Zap /></div><div><b>快速薄版本</b><small>引用游戏核心与启用 MOD，仅复制存档和配置</small><em>低空间占用</em></div>{migrationMode === 'FastLink' && <CheckCircle2 />}</button></div></div></div>
                <div className="workflow-step"><div className="step-index">3</div><div className="step-body"><h3>命名并确认迁移位置</h3><p>名称是所有页面显示的主标题；游戏版本号和 Build 只作为技术信息。完成后会自动登记并切换到新版本。</p><div className="destination-row"><div><span>版本管理目录</span><code>{snapshot?.managerRoot ?? '尚未选择'}</code></div><button className="secondary-button" onClick={() => void chooseRoot()}><FolderCog />更换</button></div><label className="field-label">版本名称（必填）<input value={migrationLabel} onChange={(event) => setMigrationLabel(event.target.value)} placeholder="例如：长期生存主档、怀旧模组服" required /></label>{migrationPreview && <div className={`migration-preview ${migrationPreview.canRun ? 'ready' : 'blocked'}`}><div className="preview-path"><span>计划目标</span><code>{migrationPreview.targetPath ?? '尚未生成'}</code></div>{migrationPreview.analysis && <div className="migration-storage-analysis"><div><span>预计新增</span><b>{formatBytes(migrationPreview.analysis.estimatedWriteBytes)}</b><small>{migrationPreview.analysis.copiedMutableFiles} 个独立文件</small></div><div><span>引用游戏核心</span><b>{formatBytes(migrationPreview.analysis.sourceGameBytes)}</b><small>{migrationPreview.analysis.sourceGameFiles} 个文件</small></div><div><span>挂接启用 MOD</span><b>{formatBytes(migrationPreview.analysis.referencedModBytes)}</b><small>{migrationPreview.analysis.referencedModRoots} 个根目录</small></div><div className="saved"><span>预计节省</span><b>{formatBytes(migrationPreview.analysis.estimatedSavedBytes)}</b><small>相对完整复制</small></div></div>}{migrationPreview.steps.map((step, index) => <div className="preview-step" key={step}><span>{index + 1}</span>{step}</div>)}{migrationPreview.warnings.map((warning) => <div className="preview-warning" key={warning}><ShieldAlert />{warning}</div>)}</div>}<button className="migration-execute" disabled={!migrationPreview?.canRun || migrationBusy} onClick={() => void migrateVersion()}>{migrationBusy ? <LoaderCircle className="spin" /> : <ArrowRight />}开始创建受管版本</button></div></div>
              </section> : maintenanceSection === 'integrity' ? <div className="compatibility-workspace enter delay-2">
                <div className="analysis-workspace-heading">
                  <div><span className="eyebrow">VERSION READINESS</span><h2>完整性与兼容性</h2><p>先确认版本实体可信，再判断当前 MOD 组合能否协同运行。</p></div>
                  <div className="analysis-responsibility-help">
                    <button className={`analysis-help-button ${showAnalysisResponsibilities ? 'active' : ''}`} onClick={() => setShowAnalysisResponsibilities((value) => !value)} aria-expanded={showAnalysisResponsibilities}><CircleAlert />职责说明</button>
                    {showAnalysisResponsibilities && <div className="analysis-help-popover" role="dialog" aria-label="完整性与兼容性职责说明"><button className="icon-button" onClick={() => setShowAnalysisResponsibilities(false)} aria-label="关闭职责说明"><X /></button><span className="eyebrow">ANALYSIS BOUNDARY</span><h3>两种分析回答不同问题</h3><div><ClipboardCheck /><p><b>完整性分析</b><span>文件是不是登记时的内容，基线、哈希、目录和快速版引用是否完整。</span></p></div><div><ShieldCheck /><p><b>兼容性分析</b><span>确定版本下，MOD 的版本变体、依赖、顺序和文件覆盖能否协同工作。</span></p></div><small>完整性通过不代表 MOD 兼容；兼容性通过也不能证明文件未损坏。</small></div>}
                  </div>
                </div>
                <section className="maintenance-grid analysis-selectors" role="tablist" aria-label="分析类型">
                  <article className={`tool-card analysis-selector ${analysisMode === 'integrity' ? 'selected featured' : ''}`} role="tab" tabIndex={0} aria-selected={analysisMode === 'integrity'} onClick={() => setAnalysisMode('integrity')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setAnalysisMode('integrity') }}><div className="tool-card-head"><div className="tool-icon"><ClipboardCheck /></div><span>SHA-256 · 文件结构</span></div><h3>完整性校验</h3><p>核对游戏、MOD、冻结基线和快速版引用，回答“这个版本实体是否仍然完整”。</p><button className={`tool-action ${analysisMode === 'integrity' ? 'primary' : ''}`} disabled={integrityLoading || compatibilityLoading || (snapshot?.activeSource === 'Steam' ? !steam?.detected : !snapshot?.isHealthy)} onClick={(event) => { event.stopPropagation(); void runIntegrityAnalysis() }}>{integrityLoading ? <LoaderCircle className="spin" /> : <RefreshCw />}{integrityLoading ? '正在核对文件与引用' : '开始完整性分析'}</button></article>
                  <article className={`tool-card analysis-selector ${analysisMode === 'compatibility' ? 'selected featured' : ''}`} role="tab" tabIndex={0} aria-selected={analysisMode === 'compatibility'} onClick={() => setAnalysisMode('compatibility')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setAnalysisMode('compatibility') }}><div className="tool-card-head"><div className="tool-icon blue"><ShieldCheck /></div><span>B42 · MOD 关系</span></div><h3>兼容性分析</h3><p>解析版本变体、依赖图、存档/服务器清单与语义覆盖，回答“当前组合能否协同运行”。</p><button className={`tool-action ${analysisMode === 'compatibility' ? 'primary' : ''}`} disabled={compatibilityLoading || integrityLoading || (snapshot?.activeSource === 'Steam' ? !steam?.detected : !snapshot?.isHealthy)} onClick={(event) => { event.stopPropagation(); void runCompatibilityAnalysis() }}>{compatibilityLoading ? <LoaderCircle className="spin" /> : <Wrench />}{compatibilityLoading ? '正在扫描 MOD 与依赖' : '开始兼容性分析'}</button></article>
                </section>
                <section className={`analysis-result-workspace ${analysisMode}`} role="tabpanel">
                  <div className="analysis-result-heading"><div className={`tool-icon ${analysisMode === 'compatibility' ? 'blue' : ''}`}>{analysisMode === 'integrity' ? <ClipboardCheck /> : <ShieldCheck />}</div><div><span>{analysisMode === 'integrity' ? 'INTEGRITY WORKSPACE' : 'COMPATIBILITY WORKSPACE'}</span><h3>{analysisMode === 'integrity' ? '完整性分析结果' : '兼容性分析结果'}</h3></div></div>
                  {analysisMode === 'integrity' ? <>{integrityLoading ? <div className="compatibility-loading"><LoaderCircle className="spin" /><div><b>正在核对版本实体</b><span>读取基线清单、计算 SHA-256 并验证快速版引用</span></div></div> : integrityReport ? <IntegrityResults report={integrityReport} /> : <div className="analysis-empty"><ClipboardCheck /><b>尚未分析当前版本的完整性</b><span>运行后，这里只显示文件、基线、目录和引用关系的证据。</span><button className="secondary-button" disabled={snapshot?.activeSource === 'Steam' ? !steam?.detected : !snapshot?.isHealthy} onClick={() => void runIntegrityAnalysis()}><RefreshCw />开始完整性分析</button></div>}</> : <>{compatibilityLoading ? <div className="compatibility-loading"><LoaderCircle className="spin" /><div><b>正在建立 MOD 关系数据库</b><span>扫描版本变体、依赖、存档、服务器和有效文件层</span></div></div> : compatibilityReport ? <CompatibilityResults report={compatibilityReport} /> : <div className="analysis-empty"><ShieldCheck /><b>尚未分析当前 MOD 组合</b><span>运行后，这里只显示版本规则、依赖、顺序、配置和文件覆盖结论。</span><button className="secondary-button" disabled={snapshot?.activeSource === 'Steam' ? !steam?.detected : !snapshot?.isHealthy} onClick={() => void runCompatibilityAnalysis()}><Wrench />开始兼容性分析</button></div>}</>}
                </section>
              </div> : <section className="share-import-panel enter delay-2">
                <div className="share-hero"><div className="share-icon"><PackageOpen /></div><div><span className="eyebrow">PZ SHARE PACKAGE · V1</span><h2>共享清单制作与接收</h2><p>共享的是可审计的版本身份、启用清单和内容指纹；游戏本体、普通 Workshop MOD、本地 MOD 与个人数据都不会进入文件。</p></div></div>
                <div className="share-principles"><div><CheckCircle2 /><span><b>允许进入 v1</b><small>AppID、游戏身份、Workshop ID、Mod ID、版本变体、加载顺序、依赖关系和 SHA-256 内容指纹</small></span></div><div><ShieldAlert /><span><b>明确排除</b><small>游戏文件、MOD 文件、Saves、数据库、账号信息、日志、cache、绝对路径和可执行脚本</small></span></div></div>
                <div className="share-actions-grid">
                  <article className="share-action-card"><div className="share-action-heading"><Archive /><div><span>CREATE</span><h3>制作共享清单</h3></div></div><p>以当前版本的唯一存档或服务器启用上下文为准。制作前自动执行完整性、兼容性和逐 MOD 内容指纹分析。</p><button className="secondary-button" disabled={shareBusy !== null || (snapshot?.activeSource === 'Steam' ? !steam?.detected : !snapshot?.isHealthy)} onClick={() => void createShareManifest()}>{shareBusy === 'create' ? <LoaderCircle className="spin" /> : <Archive />}{shareBusy === 'create' ? '正在分析并计算指纹' : '制作 .pzshare'}</button></article>
                  <article className="share-action-card"><div className="share-action-heading"><PackageOpen /><div><span>RECEIVE</span><h3>接收并隔离验证</h3></div></div><p>先验证格式与摘要，再对比本机游戏身份和每个 MOD 的实际字节；验证期间不会把文件写入版本库。</p><button className="secondary-button" disabled={shareBusy !== null} onClick={() => void inspectSharedManifest()}>{shareBusy === 'inspect' ? <LoaderCircle className="spin" /> : <PackageOpen />}{shareBusy === 'inspect' ? '正在隔离验证' : '选择共享包'}</button></article>
                </div>
                {shareInspection && <div className={`share-inspection ${shareInspection.canInstall ? 'ready' : 'blocked'}`}>
                  <div className="share-inspection-head"><div><span className="eyebrow">VALIDATION RESULT</span><h3>{shareInspection.title ?? '无法识别的共享包'}</h3><p>{shareInspection.message}</p></div><div className={`workflow-ready ${shareInspection.canInstall ? 'ready' : ''}`}><span />{shareInspection.canInstall ? '可以安装' : shareInspection.valid ? '条件不足' : '无效文件'}</div></div>
                  <div className="share-facts"><div><span>游戏版本</span><b>{shareInspection.gameVersion ?? '—'}</b></div><div><span>Build</span><b>{shareInspection.buildId ?? '—'}</b></div><div><span>启用 MOD</span><b>{shareInspection.modCount}</b></div><div><span>Workshop 项目</span><b>{shareInspection.workshopCount}</b></div><div><span>权利模式</span><b>{shareInspection.rights === 'reference-only' ? '零嵌入引用' : '未知'}</b></div><div><span>身份签名</span><b>{shareInspection.trust === 'unsigned' ? 'v1 未签名' : '无效'}</b></div></div>
                  {shareInspection.digest && <div className="share-digest"><span>包内容 SHA-256</span><code>{shareInspection.digest}</code></div>}
                  <div className="share-findings">{shareInspection.findings.map((finding, index) => <div className={finding.severity} key={`${finding.title}-${index}`}>{finding.severity === 'pass' ? <CheckCircle2 /> : <ShieldAlert />}<span><b>{finding.title}</b><small>{finding.detail}</small></span></div>)}</div>
                  <button className="migration-execute" disabled={!shareInspection.canInstall || !shareInspection.filePath || shareBusy !== null} onClick={() => void installSharedManifest()}>{shareBusy === 'install' ? <LoaderCircle className="spin" /> : <ArrowRight />}{shareBusy === 'install' ? '正在复制并执行安装后复核' : '安装为新的受管版本'}</button>
                </div>}
                <p className="share-footnote">v1 的“通过”表示当前机器找到了相同游戏身份和相同字节的 MOD；它不证明制作者身份，也不会把“免费订阅”误判成允许重新分发。</p>
              </section>}
            </>
          ) : activeView === 'help' ? (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">SURVIVOR GUIDE</span><h1>帮助中心</h1><p>选择一个主题打开完整教程，按步骤完成配置、迁移、检查或故障恢复。</p></div></section>
              <section className="help-grid enter delay-1">
                {helpTutorials.map((topic, index) => <button className={`help-card ${index === 0 ? 'featured' : ''}`} key={topic.id} onClick={() => setActiveHelpTopic(topic.id)} aria-haspopup="dialog"><div className="help-number">{topic.number}</div><HelpTopicIcon id={topic.id} /><span className="help-card-eyebrow">{topic.eyebrow}</span><h2>{topic.title}</h2><p>{topic.summary}</p><span className="help-card-action">打开详细教程<ArrowRight /></span></button>)}
              </section>
              <section className="help-note enter delay-2"><CircleAlert /><div><h3>教程不会执行任何操作</h3><p>帮助弹窗只提供说明。切换版本、迁移、校验等操作仍需由你在对应页面明确点击执行。</p></div></section>
            </>
          ) : (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">LAUNCHER PREFERENCES</span><h1>设置</h1><p>调整控制台显示内容和启动器使用偏好。</p></div></section>
              <section className="settings-panel enter delay-1"><div className="settings-heading"><div className="settings-icon"><SlidersHorizontal /></div><div><h2>界面模块</h2><p>选择启动器中需要显示的附加信息。</p></div></div><button className={`setting-row ${showVersionRadar ? 'enabled' : ''}`} onClick={toggleVersionRadar}><div><b>版本管理使用雷达</b><span>开启时显示相对版本雷达；关闭后改用单列版本清单。</span></div><span className="toggle" aria-hidden="true"><i /></span></button><button className={`setting-row ${showTerminal ? 'enabled' : ''}`} onClick={toggleTerminal}><div><b>启用“终端”抽屉</b><span>开启后，左侧会出现二级悬浮入口；悬停预览，点击可固定终端。</span></div><span className="toggle" aria-hidden="true"><i /></span></button></section>
              <section className="settings-panel enter delay-2"><div className="settings-heading"><div className="settings-icon amber"><Archive /></div><div><h2>存档保护</h2><p>控制版本迁移前是否额外保存可恢复的安全快照。</p></div></div><button className={`setting-row ${saveProtection ? 'enabled' : ''}`} onClick={() => updateSaveProtection(!saveProtection)}><div><b>迁移前创建存档安全快照</b><span>开启后，在复制或复用开始前备份 Saves、数据库与根配置。无论是否开启，可变数据都不会参与硬链接或共享。</span></div><span className="toggle" aria-hidden="true"><i /></span></button><div className="retention-note"><ShieldAlert /><span><b>不会在第三次启动后自动删除</b><small>“启动三次即删除”无法证明三次游戏均正常退出。当前版本保留快照，后续加入明确确认后再清理。</small></span></div></section>
              <section className="settings-panel compact enter delay-3"><div className="settings-heading"><div className="settings-icon"><ScrollText /></div><div><h2>操作日志</h2><p>查看创建、校验、启动和备份的历史日志文件。</p></div></div><button className="secondary-button" onClick={() => void window.vault.openLogs()}><FolderOpen />打开日志目录</button></section>
              <section className="settings-panel compact enter delay-3"><div className="settings-heading"><div className="settings-icon neutral"><ShieldCheck /></div><div><h2>版本管理目录</h2><p>当前目录：{snapshot?.managerRoot ?? '尚未配置'}</p></div></div><button className="secondary-button" onClick={() => void chooseRoot()}><FolderCog />重新选择管理器目录</button></section>
            </>
          )}
        </main>
      </div>

      {selectedHelpTutorial && <div className="help-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setActiveHelpTopic(null) }}>
        <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-tutorial-title">
          <aside className="help-modal-nav">
            <div className="help-modal-brand"><BookOpen /><div><span>使用教程</span><b>生存者手册</b></div></div>
            <nav aria-label="教程主题">{helpTutorials.map((topic) => <button className={topic.id === selectedHelpTutorial.id ? 'active' : ''} key={topic.id} onClick={() => setActiveHelpTopic(topic.id)}><span>{topic.number}</span><div><b>{topic.title}</b><small>{topic.eyebrow}</small></div><ChevronRight /></button>)}</nav>
            <div className="help-modal-version"><span>当前教程版本</span><b>v0.8 · B42</b></div>
          </aside>
          <div className="help-modal-main">
            <header className="help-modal-header"><div><span className="eyebrow">{selectedHelpTutorial.eyebrow}</span><h2 id="help-tutorial-title">{selectedHelpTutorial.title}</h2><p>{selectedHelpTutorial.summary}</p></div><button className="icon-button" onClick={() => setActiveHelpTopic(null)} aria-label="关闭教程"><X /></button></header>
            <div className="help-modal-scroll" ref={helpScrollRef} tabIndex={0}>
              <section className="tutorial-prerequisites"><div className="tutorial-section-icon"><ClipboardCheck /></div><div><h3>开始之前</h3><ul>{selectedHelpTutorial.prerequisites.map((item) => <li key={item}><CheckCircle2 />{item}</li>)}</ul></div></section>
              {selectedHelpTutorial.sections.map((section, sectionIndex) => <section className="tutorial-section" key={section.title}><div className="tutorial-section-heading"><span>{String(sectionIndex + 1).padStart(2, '0')}</span><div><h3>{section.title}</h3><p>{section.intro}</p></div></div><ol>{section.steps.map((step, stepIndex) => <li key={step.title}><span>{stepIndex + 1}</span><div><b>{step.title}</b><p>{step.detail}</p></div></li>)}</ol></section>)}
              <section className="tutorial-result"><CheckCircle2 /><div><span>完成标准</span><p>{selectedHelpTutorial.result}</p></div></section>
              {selectedHelpTutorial.warning && <section className="tutorial-warning"><ShieldAlert /><div><span>重要提醒</span><p>{selectedHelpTutorial.warning}</p></div></section>}
            </div>
            <footer className="help-modal-footer"><span>{selectedHelpIndex + 1} / {helpTutorials.length}</span><div><button className="secondary-button" disabled={selectedHelpIndex <= 0} onClick={() => setActiveHelpTopic(helpTutorials[selectedHelpIndex - 1]?.id ?? null)}>上一主题</button>{selectedHelpIndex < helpTutorials.length - 1 ? <button className="primary-button" onClick={() => setActiveHelpTopic(helpTutorials[selectedHelpIndex + 1]?.id ?? null)}>下一主题<ArrowRight /></button> : <button className="primary-button" onClick={() => setActiveHelpTopic(null)}><CheckCircle2 />完成阅读</button>}</div></footer>
          </div>
        </section>
      </div>}

      <div className={`drawer-backdrop ${isDrawerOpen ? 'open' : ''}`} onMouseDown={(event) => { if (event.currentTarget === event.target) { setDrawerOpen(false); setDetailSelection(null) } }}>
        <aside className="environment-drawer" role="dialog" aria-modal="true" aria-label="版本详情">
          <header className="drawer-header"><div><span className="eyebrow">VERSION DETAILS</span><h2>版本详情</h2></div><button className="icon-button" onClick={() => { setDrawerOpen(false); setDetailSelection(null) }} aria-label="关闭详情"><X /></button></header>
          <div className="drawer-scroll"><div className={`drawer-health ${detailHealthy ? 'healthy' : 'warning'}`}><ShieldCheck /><div><b>{detailHealthTitle}</b><span>{detailHealthText}</span></div></div><div className="drawer-version"><div className={`drawer-monogram ${detailIsSteam ? 'steam' : ''}`}>{detailIsSteam ? 'ST' : 'PZ'}</div><div><span>{detailBuildKind}</span><h3>{detailName}</h3><small>版本 {detailTechnicalVersion ?? '未知'} · Build {detailBuildId ?? '—'}</small></div></div><section className="drawer-section"><h4>版本摘要</h4><dl><div><dt>有效模组</dt><dd>{detailIsSteam ? '由 Steam 管理' : detailFrozen?.effectiveModCount ?? '—'}</dd></div><div><dt>Workshop 项目</dt><dd>{detailIsSteam ? steam?.workshopProjectCount ?? '—' : detailFrozen?.workshopProjectCount ?? '—'}</dd></div><div><dt>{detailIsSteam ? '清单更新' : '冻结时间'}</dt><dd>{formatDate(detailIsSteam ? steam?.installedAt : detailFrozen?.created)}</dd></div></dl></section><section className="drawer-section"><h4>文件位置</h4>{detailIsSteam ? <><div className="path-item"><span>Steam 游戏</span><code>{compactPath(steam?.gamePath)}</code></div><div className="path-item"><span>Workshop</span><code>{compactPath(steam?.workshopPath)}</code></div><div className="path-item"><span>用户数据</span><code>{compactPath(steam?.cachePath)}</code></div></> : <><div className="path-item"><span>版本目录</span><code>{compactPath(detailFrozen?.freezeRoot)}</code></div><div className="path-item"><span>{detailFrozen?.storageMode === 'ThinReference' ? '引用游戏' : '冻结游戏'}</span><code>{compactPath(detailFrozen?.gamePath)}</code></div><div className="path-item"><span>独立缓存</span><code>{compactPath(detailFrozen?.cachePath)}</code></div><div className="path-item"><span>备份目录</span><code>{compactPath(detailFrozen?.backupPath)}</code></div></>}</section></div>
          <footer className="drawer-footer"><button className="secondary-button" disabled={!detailHealthy} onClick={openCurrentVersionPath}><FolderOpen />打开版本目录</button><button className="launch-button compact" disabled={!detailHealthy || isBusy || switchingId !== null} onClick={() => { if (detailIsCurrent) void perform('Launch'); else if (detailIsSteam) void activateSteam(); else if (detailFrozen) void activateVersion(detailFrozen.id) }}>{detailIsCurrent ? <Play fill="currentColor" /> : <RefreshCw />}{detailIsCurrent ? '启动当前版本' : '切换到此版本'}</button></footer>
        </aside>
      </div>
      <div className={`drawer-backdrop ${isModsDrawerOpen ? 'open' : ''}`} onMouseDown={(event) => { if (event.currentTarget === event.target) setModsDrawerOpen(false) }}>
        <aside className="environment-drawer mods-drawer" role="dialog" aria-modal="true" aria-label="有效模组">
          <header className="drawer-header"><div><span className="eyebrow">ACTIVE MODS</span><h2>有效模组</h2><small>{currentDisplayName}</small></div><button className="icon-button" onClick={() => setModsDrawerOpen(false)} aria-label="关闭模组列表"><X /></button></header>
          <div className="drawer-scroll mods-drawer-scroll">
            <div className="mods-overview"><div className="drawer-monogram"><Boxes /></div><div><b>{modsLoading ? '正在识别模组…' : `${currentMods.length} 个模组`}</b><span>名称来自模组自身的 mod.info；Workshop 编号仅作为辅助标识。</span></div></div>
            {modsLoading ? <div className="drawer-loading"><LoaderCircle className="spin" />正在读取模组名称</div> : currentMods.length ? <div className="mod-list">{currentMods.map((mod, index) => <article className="mod-list-item" key={mod.key}><div className="mod-index">{String(index + 1).padStart(2, '0')}</div><div className="mod-copy"><b>{mod.name}</b><span>{mod.modId ? `MOD ID · ${mod.modId}` : '未声明 MOD ID'}</span></div><div className={`mod-source ${mod.source === 'Local' ? 'local' : ''}`}>{mod.workshopId ? `WS ${mod.workshopId}` : '本地'}</div></article>)}</div> : <div className="mods-empty"><Boxes /><b>没有识别到模组</b><span>当前版本的模组目录为空，或其中没有可读取的模组。</span></div>}
          </div>
          <footer className="drawer-footer mods-footer"><span>后续的启用、停用、添加和移除操作将从此抽屉接入。</span><button className="secondary-button" onClick={() => void openMods()}><RefreshCw />重新扫描</button></footer>
        </aside>
      </div>
      {showTerminal && <><button className={`terminal-float-button ${isTerminalOpen ? 'open' : ''} ${isTerminalPinned ? 'pinned' : ''}`} onMouseEnter={() => setTerminalOpen(true)} onClick={() => { setTerminalOpen(true); setTerminalPinned((value) => !value) }} aria-label="打开终端"><SquareTerminal /><span>终端</span></button><aside className={`terminal-drawer ${isTerminalOpen ? 'open' : ''}`} onMouseLeave={() => { if (!isTerminalPinned && !isBusy) setTerminalOpen(false) }} aria-label="操作终端"><header><div><span className="eyebrow">VAULT TERMINAL</span><h2>操作终端</h2></div><div className="terminal-header-actions"><button className={`icon-button ${isTerminalPinned ? 'active' : ''}`} onClick={() => setTerminalPinned((value) => !value)} aria-label={isTerminalPinned ? '取消固定终端' : '固定终端'}>{isTerminalPinned ? <PinOff /> : <Pin />}</button><button className="icon-button" onClick={() => { setTerminalOpen(false); setTerminalPinned(false) }} aria-label="关闭终端"><X /></button></div></header><div className="terminal-body"><div className="terminal-status"><span className={`terminal-dot ${isBusy ? 'running' : lastResult?.ok === false ? 'error' : ''}`} /><div><b>{isBusy ? '正在执行' : lastResult ? '操作已结束' : '终端待命'}</b><small>{terminalAction ?? '等待选择操作'}</small></div></div><div className="terminal-screen"><div className="terminal-command"><span className="prompt">pz-vault&gt;</span> {terminalAction ? terminalAction.toLowerCase() : 'idle'}</div>{terminalAction ? <>{terminalPlan.map((step, index) => <div className="terminal-plan" key={step}><span>[PLAN {String(index + 1).padStart(2, '0')}]</span>{step}</div>)}{isBusy && <div className="terminal-running"><span>[RUNNING]</span>PowerShell 引擎正在执行，请等待返回结果……</div>}{lastResult && <><div className={lastResult.ok ? 'terminal-complete' : 'terminal-error'}><span>[{lastResult.ok ? 'DONE' : 'ERROR'}]</span>{lastResult.message} · {formatDate(lastResult.finishedAt)}</div><pre>{lastResult.output || '操作完成，没有额外输出。'}</pre></>}</> : <div className="terminal-idle">[IDLE] 请选择启动、校验或备份操作。</div>}</div></div><footer><button className="secondary-button" onClick={() => void refresh()}><RefreshCw />刷新环境</button><button className="secondary-button" onClick={() => setActiveView('settings')}><Settings2 />终端设置</button></footer></aside></>}
      {showSaveOnboarding && <div className="onboarding-backdrop"><section className="save-onboarding" role="dialog" aria-modal="true" aria-label="存档保护设置"><div className="onboarding-icon"><ShieldAlert /></div><span className="eyebrow">FIRST START / SAVE SAFETY</span><h2>迁移前是否创建存档安全快照？</h2><p>启用后，每次创建受管版本前，启动器会先备份来源的 <code>Saves</code>、数据库与根配置，再开始复制或快速复用。</p><div className="onboarding-warning"><CircleAlert /><span><b>存档属于不可共享的可变数据</b><small>无论是否启用额外快照，存档和运行时缓存都会保持独立，绝不参与硬链接或共享。</small></span></div><p className="onboarding-footnote">建议开启。启动器不会因为“成功启动三次”就自动删除旧文件；在无法确认游戏正常退出前，自动删除不是安全实践。</p><div className="onboarding-actions"><button className="secondary-button" onClick={() => updateSaveProtection(false)}>暂不开启</button><button className="primary-button" onClick={() => updateSaveProtection(true)}><ShieldCheck />开启安全快照</button></div></section></div>}
      {notice && <div className={`toast ${notice.kind}`}>{notice.kind === 'success' ? <CheckCircle2 /> : <CircleAlert />}<span>{notice.text}</span></div>}
    </div>
  )
}
