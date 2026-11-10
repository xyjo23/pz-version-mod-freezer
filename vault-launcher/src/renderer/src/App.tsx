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
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ActionResult, FreezeVersionSummary, LauncherAction, LauncherSnapshot, MigrationMode, MigrationPreview, MigrationSourceType, SteamInstallation } from '../../shared/types'
import { VaultMark } from './VaultMark'

type Notice = { kind: 'success' | 'error'; text: string } | null
type AppView = 'console' | 'versions' | 'maintenance' | 'help' | 'settings'

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

const formatBytes = (value?: number): string => value ? `${(value / 1024 / 1024).toFixed(1)} MB` : '—'
const compactPath = (value?: string | null): string => value || '尚未配置'

const versionScore = (value: string): number => {
  const parts = value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0]
  return (parts[0] ?? 0) * 10000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0)
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
  const current = items.find((item) => item.current) ?? items[0]
  const currentTime = current?.created ? new Date(current.created).getTime() : Date.now()
  const currentVersion = versionScore(current?.version ?? '0')
  const maxTimeDelta = Math.max(1, ...items.map((item) => Math.abs((item.created ? new Date(item.created).getTime() : currentTime) - currentTime)))
  const maxVersionDelta = Math.max(1, ...items.map((item) => Math.abs(versionScore(item.version) - currentVersion)))

  return <section className="version-radar-panel enter delay-2">
    <div className="radar-heading"><div><span className="eyebrow">RELATIVE VERSION RADAR</span><h2>版本相对雷达</h2><p>中心为当前版本；横轴表示创建时间，纵轴表示游戏版本高低。双击光点可直接切换。</p></div><div className="radar-count"><b>{items.length}</b><span>已纳管版本</span></div></div>
    <div className="version-radar" role="group" aria-label="版本相对雷达">
      <div className="radar-grid-ring ring-a" /><div className="radar-grid-ring ring-b" /><div className="radar-grid-ring ring-c" />
      <div className="radar-axis horizontal"><span>更早</span><i /><span>更新</span></div>
      <div className="radar-axis vertical"><span>高版本</span><i /><span>低版本</span></div>
      <div className="radar-sweep" />
      {items.map((item, index) => {
        const timeDelta = (item.created ? new Date(item.created).getTime() : currentTime) - currentTime
        const versionDelta = versionScore(item.version) - currentVersion
        const left = item.current ? 50 : 50 + (timeDelta / maxTimeDelta) * 41
        const top = item.current ? 50 : 50 - (versionDelta / maxVersionDelta) * 37
        return <button
          key={`${item.kind}-${item.id}`}
          className={`radar-blip ${item.current ? 'current' : ''} ${item.kind === 'Steam' ? 'steam' : ''} ${item.healthy ? '' : 'unhealthy'}`}
          style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * 180}ms` }}
          onDoubleClick={() => item.kind === 'Steam' ? onSteamActivate() : onFrozenActivate(item.id)}
          aria-label={`${item.name}，版本 ${item.version}，双击切换`}
        ><span className="radar-dot" /><span className="radar-tooltip"><b>{item.name}</b><small>版本 {item.version}</small><em>{item.current ? '当前中心' : formatDate(item.created)}</em></span></button>
      })}
      {!items.length && <div className="radar-no-versions">尚无可扫描版本</div>}
    </div>
  </section>
}

const ConsoleVersionRadar = ({ versions, steam, activeSource, onFrozenActivate, onSteamActivate }: VersionRadarProps): React.JSX.Element => {
  const items = useMemo(() => {
    const frozen = versions.map((version) => ({ id: version.id, kind: 'Frozen' as const, name: version.name, version: version.version, created: version.created, current: version.isActive }))
    return steam?.detected
      ? [{ id: 'steam-original', kind: 'Steam' as const, name: 'Steam 原版', version: steam.version, created: steam.installedAt ?? undefined, current: activeSource === 'Steam' }, ...frozen]
      : frozen
  }, [activeSource, steam, versions])
  const current = items.find((item) => item.current) ?? items[0]
  const currentTime = current?.created ? new Date(current.created).getTime() : Date.now()
  const currentVersion = versionScore(current?.version ?? '0')
  const maxTimeDelta = Math.max(1, ...items.map((item) => Math.abs((item.created ? new Date(item.created).getTime() : currentTime) - currentTime)))
  const maxVersionDelta = Math.max(1, ...items.map((item) => Math.abs(versionScore(item.version) - currentVersion)))
  return <div className="console-radar-visual"><div className="console-radar-top"><span>VERSION RADAR</span><b>{items.length} 个版本</b></div><div className="console-radar"><div className="radar-grid-ring ring-a" /><div className="radar-grid-ring ring-b" /><div className="radar-axis horizontal"><i /></div><div className="radar-axis vertical"><i /></div><div className="radar-sweep" />{items.map((item, index) => {
    const timeDelta = (item.created ? new Date(item.created).getTime() : currentTime) - currentTime
    const versionDelta = versionScore(item.version) - currentVersion
    const left = item.current ? 50 : 50 + (timeDelta / maxTimeDelta) * 40
    const top = item.current ? 50 : 50 - (versionDelta / maxVersionDelta) * 36
    return <button key={`${item.kind}-${item.id}`} className={`radar-blip ${item.current ? 'current' : ''} ${item.kind === 'Steam' ? 'steam' : ''}`} style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * 180}ms` }} onDoubleClick={() => item.kind === 'Steam' ? onSteamActivate() : onFrozenActivate(item.id)} aria-label={`${item.name}，双击切换`}><span className="radar-dot" /><span className="radar-tooltip"><b>{item.name}</b><small>版本 {item.version}</small><em>{item.current ? '当前中心' : formatDate(item.created)}</em></span></button>
  })}</div><small className="console-radar-hint">悬停识别 · 双击切换</small></div>
}

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
  const [isDrawerOpen, setDrawerOpen] = useState(previewMode?.get('drawer') === 'open')
  const [isTerminalOpen, setTerminalOpen] = useState(previewMode?.get('terminal') === 'open')
  const [isTerminalPinned, setTerminalPinned] = useState(false)
  const [showTerminal, setShowTerminal] = useState(() => previewMode?.get('terminal') === 'open' || window.localStorage.getItem('pz-vault-show-terminal') === 'true' || window.localStorage.getItem('pz-vault-show-recent-activity') === 'true')
  const [steam, setSteam] = useState<SteamInstallation | null>(null)
  const [maintenanceSection, setMaintenanceSection] = useState<'version-control' | 'integrity' | 'share'>('version-control')
  const [migrationMode, setMigrationMode] = useState<MigrationMode>('SafeCopy')
  const [migrationSourceType, setMigrationSourceType] = useState<MigrationSourceType>('Steam')
  const [migrationSourceId, setMigrationSourceId] = useState('')
  const [migrationLabel, setMigrationLabel] = useState('')
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
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
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
        setTerminalOpen(false)
        setTerminalPinned(false)
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

  const activateVersion = async (versionId: string): Promise<void> => {
    setSwitchingVersion(versionId)
    try {
      const next = await window.vault.activateVersion(versionId)
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

  const openEnvironment = (): void => {
    if (snapshot) setDrawerOpen(true)
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
  const currentTechnicalVersion = snapshot?.activeSource === 'Steam' ? steam?.version : snapshot?.config?.Version
  const isSteamCurrent = snapshot?.activeSource === 'Steam'
  const currentVersionHealthy = isSteamCurrent ? Boolean(steam?.detected) : Boolean(snapshot?.isHealthy)
  const openCurrentVersionPath = (): void => {
    const target = isSteamCurrent ? steam?.gamePath : snapshot?.config?.FreezeRoot
    if (target) void window.vault.openPath(target)
  }
  const openVersionData = (kind: 'mods' | 'saves' | 'backups'): void => {
    const cachePath = isSteamCurrent ? steam?.cachePath : snapshot?.config?.CachePath
    const target = kind === 'mods'
      ? (isSteamCurrent ? steam?.workshopPath : cachePath ? `${cachePath}\\mods` : null)
      : kind === 'saves'
        ? cachePath ? `${cachePath}\\Saves` : null
        : isSteamCurrent ? null : snapshot?.config?.BackupPath
    if (target) void window.vault.openPath(target)
  }

  const environmentButton = (
    <button className="environment-button" onClick={openEnvironment}>
      <FolderOpen /><span><b>{snapshot ? currentDisplayName : '正在读取当前版本'}</b><small>{snapshot?.activeSource === 'Steam' ? steam?.gamePath ?? 'Steam 原版' : snapshot?.config?.FreezeRoot ?? snapshot?.managerRoot ?? '尚未选择版本库'}</small></span>
      {snapshot?.isConfigured ? <PanelRightOpen /> : <ChevronRight />}
    </button>
  )
  const consoleVersionTools = <section className="console-version-tools enter delay-3"><button onClick={() => openVersionData('mods')}><div className="console-tool-icon"><Boxes /></div><span><b>模组列表</b><small>{isSteamCurrent ? '查看 Workshop 内容' : '查看当前版本本地模组'}</small></span><ChevronRight /></button><button onClick={() => openVersionData('saves')}><div className="console-tool-icon blue"><Database /></div><span><b>存档信息</b><small>查看当前版本独立 Saves</small></span><ChevronRight /></button><button disabled={isSteamCurrent || !snapshot?.config?.BackupPath} onClick={() => openVersionData('backups')}><div className="console-tool-icon amber"><Archive /></div><span><b>备份信息</b><small>{isSteamCurrent ? 'Steam 原版备份功能待接入' : '查看当前版本备份目录'}</small></span><ChevronRight /></button><button onClick={() => void window.vault.openLogs()}><div className="console-tool-icon neutral"><ScrollText /></div><span><b>操作日志</b><small>查看与当前版本有关的操作记录</small></span><ChevronRight /></button></section>

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
                <><section className="steam-console-card enter delay-1"><div className="hero-glow" /><div className="hero-content"><div className="status-pill success"><span />当前版本 · STEAM</div><h2>Steam 原版</h2><div className="build-line"><span>版本 {steam.version}</span><i /><span>Build {steam.buildId}</span></div><p className="hero-description">控制台当前绑定 Steam 原版；模组、存档、备份和日志功能将围绕这个版本展开。</p><div className="hero-actions"><button className="launch-button" disabled={isBusy} onClick={() => void perform('Launch')}>{busyAction === 'Launch' ? <LoaderCircle className="spin" /> : <Play fill="currentColor" />}<span><b>启动 Steam 原版</b><small>STEAM MANAGED</small></span></button><button className="secondary-button" onClick={() => setDrawerOpen(true)}><PanelRightOpen />版本详情</button></div></div><ConsoleVersionRadar versions={versions} steam={steam} activeSource={snapshot.activeSource} onFrozenActivate={(id) => void activateVersion(id)} onSteamActivate={() => void activateSteam()} /></section>{consoleVersionTools}</>
              ) : (
                <section className="empty-state enter delay-1"><div className="radar"><span /><span /><span /><ShieldAlert /></div><span className="eyebrow">STEAM NOT DETECTED</span><h2>没有找到 Project Zomboid 原版</h2><p>{steam?.issue ?? '正在检测 Steam 与 AppID 108600。'}</p><button className="primary-button" onClick={() => void refresh()}><RefreshCw />重新检测</button></section>
              ) : (
                <>
                  <section className="hero-panel enter delay-1">
                    <div className="hero-glow" /><div className="hero-content"><div className={`status-pill ${status.tone}`}><span />{status.text}</div><h2>{currentDisplayName}</h2><div className="build-line"><span>版本 {snapshot.config?.Version ?? '未知'}</span><i /><span>Build {snapshot.config?.BuildID ?? '—'}</span></div><p className="hero-description">从隔离目录启动，保留独立游戏文件、模组、配置与存档。</p>{snapshot.issue && <div className="issue-line"><CircleAlert />{snapshot.issue}</div>}<div className="hero-actions"><button className="launch-button" disabled={!snapshot.isHealthy || isBusy} onClick={() => void perform('Launch')}>{busyAction === 'Launch' ? <LoaderCircle className="spin" /> : <Play fill="currentColor" />}<span><b>启动当前版本</b><small>ISOLATED MODE</small></span></button><button className="secondary-button" onClick={() => setDrawerOpen(true)}><PanelRightOpen />版本详情</button></div></div>
                    <ConsoleVersionRadar versions={versions} steam={steam} activeSource={snapshot.activeSource} onFrozenActivate={(id) => void activateVersion(id)} onSteamActivate={() => void activateSteam()} />
                  </section>
                  <section className="metric-grid enter delay-2">
                    <article className="metric-card"><div className="metric-icon safe"><ShieldCheck /></div><div><span>环境状态</span><strong>{snapshot.isHealthy ? '安全隔离' : '配置异常'}</strong><small>{snapshot.isHealthy ? '核心路径检查通过' : '需要重新定位环境'}</small></div><CheckCircle2 className={snapshot.isHealthy ? 'ok' : 'muted'} /></article>
                    <article className="metric-card"><div className="metric-icon"><Database /></div><div><span>有效模组</span><strong>{snapshot.config?.EffectiveModCount ?? '—'}</strong><small>{snapshot.config?.WorkshopProjectCount ?? '—'} 个 Workshop 项目</small></div><Gamepad2 className="muted" /></article>
                    <article className="metric-card"><div className="metric-icon amber"><Archive /></div><div><span>最近备份</span><strong>{formatDate(snapshot.lastBackup?.createdAt)}</strong><small>{formatBytes(snapshot.lastBackup?.size)}</small></div><FileClock className="muted" /></article>
                  </section>
                  {consoleVersionTools}
                </>
              )}
            </>
          ) : activeView === 'versions' ? (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">MANAGED BUILDS</span><h1>版本管理</h1><p>统一管理 Steam 原版与冻结版本，并选择控制台当前操作的版本。</p></div><button className="secondary-button" onClick={() => void chooseRoot()}><FolderCog />更换管理器目录</button></section>
              <section className="version-summary enter delay-1"><div className="status-orb ready"><Boxes /></div><div><span className="eyebrow">VERSION LIBRARY</span><h2>当前版本 · {currentDisplayName}</h2><p>技术版本 {currentTechnicalVersion ?? '未知'}；当前共纳管 {(steam?.detected ? 1 : 0) + versions.length} 个版本。</p></div></section>
              <VersionRadar versions={versions} steam={steam} activeSource={snapshot?.activeSource ?? 'Steam'} onFrozenActivate={(id) => void activateVersion(id)} onSteamActivate={() => void activateSteam()} />
              <section className="version-grid enter delay-3">
                <article className={`version-card steam ${steam?.detected ? '' : 'unavailable'} ${snapshot?.activeSource === 'Steam' ? 'active' : ''}`}><div className="version-card-top"><div className="version-badge steam">ST</div><div className="version-state">{snapshot?.activeSource === 'Steam' ? <><CheckCircle2 />当前版本</> : steam?.detected ? 'Steam 管理' : '未检测到'}</div></div><h3>Steam 原版</h3><div className="version-build">{steam?.detected ? `版本 ${steam.version} · Build ${steam.buildId}` : steam?.issue ?? '没有找到 AppID 108600'}</div><dl><div><dt>管理方式</dt><dd>Steam</dd></div><div><dt>Workshop</dt><dd>{steam?.workshopProjectCount ?? '—'}</dd></div><div><dt>状态</dt><dd>{steam?.detected ? '可用' : '不可用'}</dd></div></dl><div className="version-card-actions"><button className={`tool-action ${snapshot?.activeSource === 'Steam' ? '' : 'primary'}`} disabled={!steam?.detected || snapshot?.activeSource === 'Steam' || switchingId !== null} onClick={() => void activateSteam()}>{switchingId === 'steam-original' ? <LoaderCircle className="spin" /> : snapshot?.activeSource === 'Steam' ? <CheckCircle2 /> : <RefreshCw />}{snapshot?.activeSource === 'Steam' ? '正在使用' : '切换版本'}</button><button className="tool-action" disabled={!steam?.gamePath} onClick={() => { if (steam?.gamePath) void window.vault.openPath(steam.gamePath) }}><FolderOpen />目录</button><button className="tool-action" disabled={!steam?.detected} onClick={() => void window.vault.validateSteam()}><ClipboardCheck />校验</button></div></article>
                {versions.map((version) => <article className={`version-card ${version.isActive ? 'active' : ''}`} key={version.id}><div className="version-card-top"><div className="version-badge">PZ</div><div className="version-state">{version.isActive ? <><CheckCircle2 />当前版本</> : version.isHealthy ? '冻结版本' : '文件不完整'}</div></div><h3>{version.name}</h3><div className="version-build">版本 {version.version} · Steam Build {version.buildId ?? '—'}</div><dl><div><dt>有效模组</dt><dd>{version.effectiveModCount ?? '—'}</dd></div><div><dt>Workshop</dt><dd>{version.workshopProjectCount ?? '—'}</dd></div><div><dt>冻结时间</dt><dd>{formatDate(version.created)}</dd></div></dl><button className={`tool-action ${version.isActive ? '' : 'primary'}`} disabled={version.isActive || !version.isHealthy || switchingId !== null} onClick={() => void activateVersion(version.id)}>{switchingId === version.id ? <LoaderCircle className="spin" /> : version.isActive ? <CheckCircle2 /> : <RefreshCw />}{version.isActive ? '正在使用' : '切换到此版本'}</button></article>)}
                {!versions.length && <div className="version-empty compact"><Boxes /><h2>还没有冻结版本</h2><p>进入“维护工具 → 版本控制”，从 Steam 原版创建第一个受管版本。</p><button className="primary-button" onClick={() => { setMaintenanceSection('version-control'); setActiveView('maintenance') }}><ArrowRight />开始版本控制</button></div>}
              </section>
            </>
          ) : activeView === 'maintenance' ? (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">VAULT OPERATIONS</span><h1>维护工具</h1><p>创建受管版本、检查兼容性或导入玩家共享包。</p></div><button className="secondary-button" onClick={() => void chooseRoot()}><FolderCog />{snapshot?.managerRoot ? '更换管理目录' : '选择管理目录'}</button></section>
              <div className="maintenance-mode-tabs enter delay-1"><button className={maintenanceSection === 'version-control' ? 'active' : ''} onClick={() => setMaintenanceSection('version-control')}><Boxes />版本控制</button><button className={maintenanceSection === 'integrity' ? 'active' : ''} onClick={() => setMaintenanceSection('integrity')}><ClipboardCheck />完整性与兼容性</button><button className={maintenanceSection === 'share' ? 'active' : ''} onClick={() => setMaintenanceSection('share')}><PackageOpen />共享包导入</button></div>
              {maintenanceSection === 'version-control' ? <section className="migration-workflow enter delay-2">
                <div className="workflow-header"><div><span className="eyebrow">NEW MANAGED VERSION</span><h2>创建受管版本</h2><p>明确选择来源、迁移模式和目标库。每次执行都会创建新的版本目录，不要求目标中预先存在文件。</p></div><div className={`workflow-ready ${migrationPreview?.canRun ? 'ready' : ''}`}><span />{migrationPreview?.canRun ? '可以执行' : '等待配置'}</div></div>
                <div className="workflow-step"><div className="step-index">1</div><div className="step-body"><h3>选择迁移来源</h3><p>来源可以是实时 Steam 原版，也可以是版本库中的任意冻结版本。</p><div className="choice-grid source-choices"><button className={migrationSourceType === 'Steam' ? 'selected' : ''} onClick={() => { setMigrationSourceType('Steam'); setMigrationSourceId('') }}><div className="choice-icon steam"><span>ST</span></div><div><b>Steam 原版</b><small>{steam?.detected ? `${steam.version} · Build ${steam.buildId}` : steam?.issue ?? '正在检测'}</small></div>{migrationSourceType === 'Steam' && <CheckCircle2 />}</button><button className={migrationSourceType === 'Frozen' ? 'selected' : ''} disabled={!versions.length} onClick={() => { setMigrationSourceType('Frozen'); setMigrationSourceId((current) => current || versions[0]?.id || '') }}><div className="choice-icon"><Boxes /></div><div><b>已有冻结版本</b><small>{versions.length ? `${versions.length} 个版本可选` : '版本库为空'}</small></div>{migrationSourceType === 'Frozen' && <CheckCircle2 />}</button></div>{migrationSourceType === 'Frozen' && <label className="field-label">具体来源<select value={migrationSourceId} onChange={(event) => setMigrationSourceId(event.target.value)}><option value="">请选择冻结版本</option>{versions.map((version) => <option value={version.id} key={version.id}>{version.name} · {version.version} · Build {version.buildId ?? '—'}{version.isActive ? '（当前）' : ''}</option>)}</select></label>}</div></div>
                <div className="workflow-step"><div className="step-index">2</div><div className="step-body"><h3>选择迁移模式</h3><p>安全复制占用更多空间；实验性快速复用仅适用于已有冻结版本。</p><div className="choice-grid mode-choices"><button className={migrationMode === 'SafeCopy' ? 'selected' : ''} onClick={() => setMigrationMode('SafeCopy')}><div className="choice-icon"><Copy /></div><div><b>安全完整复制</b><small>游戏、MOD、配置和存档全部独立</small><em>推荐</em></div>{migrationMode === 'SafeCopy' && <CheckCircle2 />}</button><button className={migrationMode === 'FastLink' ? 'selected risk' : 'risk'} onClick={() => setMigrationMode('FastLink')}><div className="choice-icon amber"><Zap /></div><div><b>实验性快速复用</b><small>硬链接复用只读资源，可变内容保持独立</small><em>兼容风险</em></div>{migrationMode === 'FastLink' && <CheckCircle2 />}</button></div></div></div>
                <div className="workflow-step"><div className="step-index">3</div><div className="step-body"><h3>命名并确认迁移位置</h3><p>名称是所有页面显示的主标题；游戏版本号和 Build 只作为技术信息。完成后会自动登记并切换到新版本。</p><div className="destination-row"><div><span>版本管理目录</span><code>{snapshot?.managerRoot ?? '尚未选择'}</code></div><button className="secondary-button" onClick={() => void chooseRoot()}><FolderCog />更换</button></div><label className="field-label">版本名称（必填）<input value={migrationLabel} onChange={(event) => setMigrationLabel(event.target.value)} placeholder="例如：长期生存主档、怀旧模组服" required /></label>{migrationPreview && <div className={`migration-preview ${migrationPreview.canRun ? 'ready' : 'blocked'}`}><div className="preview-path"><span>计划目标</span><code>{migrationPreview.targetPath ?? '尚未生成'}</code></div>{migrationPreview.steps.map((step, index) => <div className="preview-step" key={step}><span>{index + 1}</span>{step}</div>)}{migrationPreview.warnings.map((warning) => <div className="preview-warning" key={warning}><ShieldAlert />{warning}</div>)}</div>}<button className="migration-execute" disabled={!migrationPreview?.canRun || migrationBusy} onClick={() => void migrateVersion()}>{migrationBusy ? <LoaderCircle className="spin" /> : <ArrowRight />}开始创建受管版本</button></div></div>
              </section> : maintenanceSection === 'integrity' ? <section className="maintenance-grid enter delay-2"><article className="tool-card featured"><div className="tool-card-head"><div className="tool-icon"><ClipboardCheck /></div><span>SHA-256</span></div><h3>完整性校验</h3><p>重新计算当前冻结游戏和本地 MOD 的 SHA-256，并与创建时基线逐项比较。</p><button className="tool-action primary" disabled={!snapshot?.isHealthy || isBusy} onClick={() => void perform('Verify')}>{busyAction === 'Verify' ? <LoaderCircle className="spin" /> : <RefreshCw />}校验当前版本</button></article><article className="tool-card"><div className="tool-card-head"><div className="tool-icon blue"><ShieldCheck /></div><span>结构识别</span></div><h3>兼容性分析</h3><p>检查版本、Build、MOD 目录、依赖和可变文件边界，为后续智能迁移与共享仓库建立依据。</p><button className="tool-action" disabled><Wrench />规则库建设中</button></article></section> : <section className="share-import-panel enter delay-2"><div className="share-hero"><div className="share-icon"><PackageOpen /></div><div><span className="eyebrow">PZ SHARE PACKAGE</span><h2>共享包导入</h2><p>目标格式只保存版本清单、内容哈希和用户允许分享的资源，不包含个人存档、账号信息或运行时配置。</p></div></div><div className="share-principles"><div><CheckCircle2 /><span><b>可共享</b><small>游戏只读资源、已验证 MOD、内容哈希清单</small></span></div><div><ShieldAlert /><span><b>必须隔离</b><small>Saves、数据库、options.ini、日志、启用配置与 cache</small></span></div></div><button className="migration-execute" disabled><PackageOpen />共享包格式 v1 设计中</button><p className="share-footnote">下一阶段将先实现包清单验证与缺失内容分析，再开放正式导入，避免未经识别的文件直接进入版本库。</p></section>}
            </>
          ) : activeView === 'help' ? (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">SURVIVOR GUIDE</span><h1>帮助</h1><p>查看完整工作流、功能边界和常见问题；后续将在这里接入日志反馈。</p></div></section>
              <section className="help-grid enter delay-1">
                <article className="help-card featured"><div className="help-number">01</div><BookOpen /><h2>控制台</h2><p>围绕当前单个版本启动游戏，并查看它的模组、存档、备份和日志；后续的模组增删也将在这里完成。</p></article>
                <article className="help-card"><div className="help-number">02</div><Boxes /><h2>版本管理</h2><p>统一管理 Steam 原版和冻结版。可以通过版本卡或相对雷达切换当前版本，切换后控制台立即跟随。</p></article>
                <article className="help-card"><div className="help-number">03</div><Wrench /><h2>维护工具</h2><p>负责制作新冻结版、导入共享包以及执行完整性与兼容性检查；过程输出统一显示在“终端”抽屉。</p></article>
              </section>
              <section className="help-note enter delay-2"><CircleAlert /><div><h3>切换版本不会删除文件</h3><p>启动器只更新当前版本指向，并为原来的 current-freeze.json 留下备份。冻结目录中的游戏、模组和存档不会被移动或删除。</p></div></section>
            </>
          ) : (
            <>
              <section className="page-heading enter"><div><span className="eyebrow">LAUNCHER PREFERENCES</span><h1>设置</h1><p>调整控制台显示内容和启动器使用偏好。</p></div></section>
              <section className="settings-panel enter delay-1"><div className="settings-heading"><div className="settings-icon"><SlidersHorizontal /></div><div><h2>界面模块</h2><p>选择启动器中需要显示的附加信息。</p></div></div><button className={`setting-row ${showTerminal ? 'enabled' : ''}`} onClick={toggleTerminal}><div><b>启用“终端”抽屉</b><span>开启后，左侧会出现二级悬浮入口；悬停预览，点击可固定终端。</span></div><span className="toggle" aria-hidden="true"><i /></span></button></section>
              <section className="settings-panel enter delay-2"><div className="settings-heading"><div className="settings-icon amber"><Archive /></div><div><h2>存档保护</h2><p>控制版本迁移前是否额外保存可恢复的安全快照。</p></div></div><button className={`setting-row ${saveProtection ? 'enabled' : ''}`} onClick={() => updateSaveProtection(!saveProtection)}><div><b>迁移前创建存档安全快照</b><span>开启后，在复制或复用开始前备份 Saves、数据库与根配置。无论是否开启，可变数据都不会参与硬链接或共享。</span></div><span className="toggle" aria-hidden="true"><i /></span></button><div className="retention-note"><ShieldAlert /><span><b>不会在第三次启动后自动删除</b><small>“启动三次即删除”无法证明三次游戏均正常退出。当前版本保留快照，后续加入明确确认后再清理。</small></span></div></section>
              <section className="settings-panel compact enter delay-3"><div className="settings-heading"><div className="settings-icon"><ScrollText /></div><div><h2>操作日志</h2><p>查看创建、校验、启动和备份的历史日志文件。</p></div></div><button className="secondary-button" onClick={() => void window.vault.openLogs()}><FolderOpen />打开日志目录</button></section>
              <section className="settings-panel compact enter delay-3"><div className="settings-heading"><div className="settings-icon neutral"><ShieldCheck /></div><div><h2>版本管理目录</h2><p>当前目录：{snapshot?.managerRoot ?? '尚未配置'}</p></div></div><button className="secondary-button" onClick={() => void chooseRoot()}><FolderCog />重新选择管理器目录</button></section>
            </>
          )}
        </main>
      </div>

      <div className={`drawer-backdrop ${isDrawerOpen ? 'open' : ''}`} onMouseDown={(event) => { if (event.currentTarget === event.target) setDrawerOpen(false) }}>
        <aside className="environment-drawer" role="dialog" aria-modal="true" aria-label="版本详情">
          <header className="drawer-header"><div><span className="eyebrow">VERSION DETAILS</span><h2>版本详情</h2></div><button className="icon-button" onClick={() => setDrawerOpen(false)} aria-label="关闭详情"><X /></button></header>
          <div className="drawer-scroll"><div className={`drawer-health ${currentVersionHealthy ? 'healthy' : 'warning'}`}><ShieldCheck /><div><b>{currentVersionHealthy ? '版本检查通过' : '版本需要处理'}</b><span>{isSteamCurrent ? steam?.issue ?? 'Steam 原版、Workshop 与用户目录已识别。' : snapshot?.issue ?? '游戏、缓存和版本路径均可访问。'}</span></div></div><div className="drawer-version"><div className={`drawer-monogram ${isSteamCurrent ? 'steam' : ''}`}>{isSteamCurrent ? 'ST' : 'PZ'}</div><div><span>{isSteamCurrent ? 'STEAM MANAGED' : 'FROZEN BUILD'}</span><h3>{currentDisplayName}</h3><small>版本 {currentTechnicalVersion ?? '未知'} · Build {isSteamCurrent ? steam?.buildId ?? '—' : snapshot?.config?.BuildID ?? '—'}</small></div></div><section className="drawer-section"><h4>版本摘要</h4><dl><div><dt>有效模组</dt><dd>{isSteamCurrent ? '由 Steam 管理' : snapshot?.config?.EffectiveModCount ?? '—'}</dd></div><div><dt>Workshop 项目</dt><dd>{isSteamCurrent ? steam?.workshopProjectCount ?? '—' : snapshot?.config?.WorkshopProjectCount ?? '—'}</dd></div><div><dt>最近备份</dt><dd>{isSteamCurrent ? '用户目录' : formatDate(snapshot?.lastBackup?.createdAt)}</dd></div></dl></section><section className="drawer-section"><h4>文件位置</h4>{isSteamCurrent ? <><div className="path-item"><span>Steam 游戏</span><code>{compactPath(steam?.gamePath)}</code></div><div className="path-item"><span>Workshop</span><code>{compactPath(steam?.workshopPath)}</code></div><div className="path-item"><span>用户数据</span><code>{compactPath(steam?.cachePath)}</code></div></> : <><div className="path-item"><span>版本库</span><code>{compactPath(snapshot?.managerRoot)}</code></div><div className="path-item"><span>冻结游戏</span><code>{compactPath(snapshot?.config?.GamePath)}</code></div><div className="path-item"><span>独立缓存</span><code>{compactPath(snapshot?.config?.CachePath)}</code></div><div className="path-item"><span>备份目录</span><code>{compactPath(snapshot?.config?.BackupPath)}</code></div></>}</section></div>
          <footer className="drawer-footer"><button className="secondary-button" disabled={!currentVersionHealthy} onClick={openCurrentVersionPath}><FolderOpen />打开版本目录</button><button className="launch-button compact" disabled={!currentVersionHealthy || isBusy} onClick={() => void perform('Launch')}><Play fill="currentColor" />启动当前版本</button></footer>
        </aside>
      </div>
      {showTerminal && <><button className={`terminal-float-button ${isTerminalOpen ? 'open' : ''} ${isTerminalPinned ? 'pinned' : ''}`} onMouseEnter={() => setTerminalOpen(true)} onClick={() => { setTerminalOpen(true); setTerminalPinned((value) => !value) }} aria-label="打开终端"><SquareTerminal /><span>终端</span></button><aside className={`terminal-drawer ${isTerminalOpen ? 'open' : ''}`} onMouseLeave={() => { if (!isTerminalPinned && !isBusy) setTerminalOpen(false) }} aria-label="操作终端"><header><div><span className="eyebrow">VAULT TERMINAL</span><h2>操作终端</h2></div><div className="terminal-header-actions"><button className={`icon-button ${isTerminalPinned ? 'active' : ''}`} onClick={() => setTerminalPinned((value) => !value)} aria-label={isTerminalPinned ? '取消固定终端' : '固定终端'}>{isTerminalPinned ? <PinOff /> : <Pin />}</button><button className="icon-button" onClick={() => { setTerminalOpen(false); setTerminalPinned(false) }} aria-label="关闭终端"><X /></button></div></header><div className="terminal-body"><div className="terminal-status"><span className={`terminal-dot ${isBusy ? 'running' : lastResult?.ok === false ? 'error' : ''}`} /><div><b>{isBusy ? '正在执行' : lastResult ? '操作已结束' : '终端待命'}</b><small>{terminalAction ?? '等待选择操作'}</small></div></div><div className="terminal-screen"><div className="terminal-command"><span className="prompt">pz-vault&gt;</span> {terminalAction ? terminalAction.toLowerCase() : 'idle'}</div>{terminalAction ? <>{terminalPlan.map((step, index) => <div className="terminal-plan" key={step}><span>[PLAN {String(index + 1).padStart(2, '0')}]</span>{step}</div>)}{isBusy && <div className="terminal-running"><span>[RUNNING]</span>PowerShell 引擎正在执行，请等待返回结果……</div>}{lastResult && <><div className={lastResult.ok ? 'terminal-complete' : 'terminal-error'}><span>[{lastResult.ok ? 'DONE' : 'ERROR'}]</span>{lastResult.message} · {formatDate(lastResult.finishedAt)}</div><pre>{lastResult.output || '操作完成，没有额外输出。'}</pre></>}</> : <div className="terminal-idle">[IDLE] 请选择启动、校验或备份操作。</div>}</div></div><footer><button className="secondary-button" onClick={() => void refresh()}><RefreshCw />刷新环境</button><button className="secondary-button" onClick={() => setActiveView('settings')}><Settings2 />终端设置</button></footer></aside></>}
      {showSaveOnboarding && <div className="onboarding-backdrop"><section className="save-onboarding" role="dialog" aria-modal="true" aria-label="存档保护设置"><div className="onboarding-icon"><ShieldAlert /></div><span className="eyebrow">FIRST START / SAVE SAFETY</span><h2>迁移前是否创建存档安全快照？</h2><p>启用后，每次创建受管版本前，启动器会先备份来源的 <code>Saves</code>、数据库与根配置，再开始复制或快速复用。</p><div className="onboarding-warning"><CircleAlert /><span><b>存档属于不可共享的可变数据</b><small>无论是否启用额外快照，存档和运行时缓存都会保持独立，绝不参与硬链接或共享。</small></span></div><p className="onboarding-footnote">建议开启。启动器不会因为“成功启动三次”就自动删除旧文件；在无法确认游戏正常退出前，自动删除不是安全实践。</p><div className="onboarding-actions"><button className="secondary-button" onClick={() => updateSaveProtection(false)}>暂不开启</button><button className="primary-button" onClick={() => updateSaveProtection(true)}><ShieldCheck />开启安全快照</button></div></section></div>}
      {notice && <div className={`toast ${notice.kind}`}>{notice.kind === 'success' ? <CheckCircle2 /> : <CircleAlert />}<span>{notice.text}</span></div>}
    </div>
  )
}
