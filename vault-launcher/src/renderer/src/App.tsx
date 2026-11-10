import { useCallback, useEffect, useState } from 'react'

import type { FreezeVersionSummary, LauncherSnapshot, SteamInstallation } from '../../shared/types'

export const App = (): React.JSX.Element => {
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null)
  const [steam, setSteam] = useState<SteamInstallation | null>(null)
  const [versions, setVersions] = useState<FreezeVersionSummary[]>([])
  const [message, setMessage] = useState('正在读取版本库…')

  const refresh = useCallback(async () => {
    const [nextSnapshot, nextSteam, nextVersions] = await Promise.all([
      window.vault.getSnapshot(), window.vault.detectSteam(), window.vault.listVersions()
    ])
    setSnapshot(nextSnapshot)
    setSteam(nextSteam)
    setVersions(nextVersions)
    setMessage('版本库已刷新')
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const activateFrozen = async (id: string): Promise<void> => {
    setSnapshot(await window.vault.activateVersion(id))
    await refresh()
  }

  const activateSteam = async (): Promise<void> => {
    setSnapshot(await window.vault.activateSteam())
    await refresh()
  }

  const launch = async (): Promise<void> => {
    const result = await window.vault.runAction('Launch')
    setMessage(result.message)
  }

  return <main className="shell">
    <header><div><span>PZ VAULT / NATIVE CORE</span><h1>Project Zomboid 版本库</h1><p>Steam 原版、冻结版本和迁移服务已统一接入。</p></div><button onClick={() => void refresh()}>刷新</button></header>
    <section className="current"><small>当前版本</small><h2>{snapshot?.activeSource === 'Steam' ? 'Steam 原版' : snapshot?.config?.DisplayName ?? snapshot?.config?.Version ?? '尚未选择'}</h2><p>{snapshot?.activeSource === 'Steam' ? steam?.gamePath : snapshot?.config?.FreezeRoot}</p><button disabled={!snapshot || (snapshot.activeSource === 'Frozen' && !snapshot.isHealthy)} onClick={() => void launch()}>启动当前版本</button></section>
    <section className="library"><h2>版本管理</h2><div className="cards"><article className={snapshot?.activeSource === 'Steam' ? 'active' : ''}><b>Steam 原版</b><span>{steam?.version ?? '未检测到'} · Build {steam?.buildId ?? '—'}</span><button disabled={!steam?.detected || snapshot?.activeSource === 'Steam'} onClick={() => void activateSteam()}>设为当前</button></article>{versions.map((version) => <article className={version.isActive ? 'active' : ''} key={version.id}><b>{version.name}</b><span>{version.version} · Build {version.buildId ?? '—'}</span><button disabled={version.isActive || !version.isHealthy} onClick={() => void activateFrozen(version.id)}>设为当前</button></article>)}</div></section>
    <section className="operations"><h2>版本制作与检查</h2><p>原生服务已经支持 Steam 发现、安全完整复制、实验性硬链接迁移、SHA-256 清单和迁移前存档快照。</p><button onClick={() => void window.vault.chooseManagerRoot()}>选择版本管理目录</button></section>
    <footer>{message}</footer>
  </main>
}
