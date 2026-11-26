import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import { listProcessIds } from './launch-monitor'

const execFileAsync = promisify(execFile)

export type SteamClientReadiness = {
  started: boolean
  steamPid: number
  helperPid: number
  message: string
}

type EnsureSteamClientOptions = {
  timeoutMs?: number
  settleMs?: number
  pollMs?: number
  listPids?: (imageName: string) => Promise<number[]>
  getActiveUser?: () => Promise<number>
  start?: (executable: string) => Promise<void>
}

const startSteam = async (executable: string): Promise<void> => {
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

export const readSteamActiveUser = async (): Promise<number> => {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'], { windowsHide: true })
    const value = stdout.match(/ActiveUser\s+REG_DWORD\s+0x([0-9a-f]+)/i)?.[1]
    return value ? Number.parseInt(value, 16) : 0
  } catch {
    return 0
  }
}

export const ensureSteamClientRunning = async (steamPath: string, options: EnsureSteamClientOptions = {}): Promise<SteamClientReadiness> => {
  const executable = path.join(steamPath, 'steam.exe')
  if (!existsSync(executable) && !options.start) throw new Error(`Steam 客户端程序不存在：${executable}`)

  const listPids = options.listPids ?? listProcessIds
  const getActiveUser = options.getActiveUser ?? readSteamActiveUser
  const start = options.start ?? startSteam
  const timeoutMs = options.timeoutMs ?? 60_000
  const settleMs = options.settleMs ?? 5_000
  const pollMs = Math.max(10, options.pollMs ?? 500)
  const initialSteam = await listPids('steam.exe')
  const initialHelpers = await listPids('steamwebhelper.exe')
  const initialActiveUser = await getActiveUser()
  if (initialSteam.length && initialHelpers.length && initialActiveUser > 0) {
    return { started: false, steamPid: initialSteam[0], helperPid: initialHelpers[0], message: 'Steam 客户端已在运行。' }
  }

  if (!initialSteam.length) await start(executable)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [steamPids, helperPids] = await Promise.all([listPids('steam.exe'), listPids('steamwebhelper.exe')])
    const activeUser = await getActiveUser()
    if (steamPids.length && helperPids.length && activeUser > 0) {
      if (settleMs > 0) await delay(settleMs)
      return {
        started: !initialSteam.length,
        steamPid: steamPids[0],
        helperPid: helperPids[0],
        message: initialSteam.length ? 'Steam 客户端已完成启动准备。' : '已启动 Steam 客户端并完成启动准备。'
      }
    }
    await delay(pollMs)
  }
  throw new Error(`Steam 客户端在 ${Math.round(timeoutMs / 1000)} 秒内没有进入已登录状态。请先登录 Steam，再重试冻结版。`)
}
