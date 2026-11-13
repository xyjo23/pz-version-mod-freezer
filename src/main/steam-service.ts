import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { shell } from 'electron'

import type { SteamInstallation } from '../shared/types'

const execFileAsync = promisify(execFile)
const APP_ID = '108600'

const queryRegistryValue = async (key: string, value: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', value], { windowsHide: true })
    const match = stdout.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)$`, 'im'))
    return match?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

const getSteamCandidates = async (): Promise<string[]> => {
  const candidates = [
    await queryRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await queryRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    await queryRegistryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam'
  ]
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate && existsSync(candidate))).map((candidate) => path.resolve(candidate)))]
}

const getLibraries = async (steamPath: string): Promise<string[]> => {
  const libraries = new Set<string>([path.resolve(steamPath)])
  try {
    const raw = await fs.readFile(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    for (const match of raw.matchAll(/^\s*"path"\s+"([^"]+)"/gim)) {
      const candidate = match[1].replace(/\\\\/g, '\\')
      if (existsSync(candidate)) libraries.add(path.resolve(candidate))
    }
  } catch {
    // The primary Steam library is still a valid candidate.
  }
  return [...libraries]
}

const countDirectories = async (directory: string): Promise<number> => {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length
  } catch {
    return 0
  }
}

export const detectSteamInstallation = async (): Promise<SteamInstallation> => {
  const steamCandidates = await getSteamCandidates()
  for (const steamPath of steamCandidates) {
    for (const libraryPath of await getLibraries(steamPath)) {
      const steamApps = path.join(libraryPath, 'steamapps')
      const manifestPath = path.join(steamApps, `appmanifest_${APP_ID}.acf`)
      if (!existsSync(manifestPath)) continue
      try {
        const manifest = await fs.readFile(manifestPath, 'utf8')
        const manifestStats = await fs.stat(manifestPath)
        const installName = manifest.match(/"installdir"\s+"([^"]+)"/i)?.[1]
        const buildId = manifest.match(/"buildid"\s+"([^"]+)"/i)?.[1] ?? 'unknown'
        if (!installName) continue
        const gamePath = path.join(steamApps, 'common', installName)
        const executablePath = path.join(gamePath, 'ProjectZomboid64.exe')
        if (!existsSync(executablePath)) continue
        const workshopPath = path.join(steamApps, 'workshop', 'content', APP_ID)
        const cachePath = path.join(os.homedir(), 'Zomboid')
        let fullVersion = ''
        try { fullVersion = (await fs.readFile(path.join(cachePath, 'version.txt'), 'utf8')).trim() } catch { /* optional */ }
        const version = fullVersion.match(/^(\d+\.\d+\.\d+)/m)?.[1] ?? 'unknown'
        return {
          detected: true,
          issue: null,
          steamPath,
          libraryPath,
          manifestPath,
          gamePath,
          executablePath,
          workshopPath,
          cachePath,
          version,
          fullVersion,
          buildId,
          installedAt: manifestStats.mtime.toISOString(),
          workshopProjectCount: await countDirectories(workshopPath)
        }
      } catch {
        continue
      }
    }
  }
  return {
    detected: false,
    issue: steamCandidates.length ? '已检测到 Steam，但没有找到 AppID 108600 的完整安装。' : '未检测到 Steam 安装目录。',
    steamPath: steamCandidates[0] ?? null,
    libraryPath: null,
    manifestPath: null,
    gamePath: null,
    executablePath: null,
    workshopPath: null,
    cachePath: path.join(os.homedir(), 'Zomboid'),
    version: 'unknown',
    fullVersion: '',
    buildId: 'unknown',
    installedAt: null,
    workshopProjectCount: 0
  }
}

export const launchSteamGame = async (): Promise<boolean> => {
  await shell.openExternal(`steam://run/${APP_ID}`)
  return true
}

export const validateSteamGame = async (): Promise<boolean> => {
  await shell.openExternal(`steam://validate/${APP_ID}`)
  return true
}

export const openLocalPath = async (targetPath: string): Promise<boolean> => {
  if (!targetPath || !existsSync(targetPath)) return false
  return (await shell.openPath(targetPath)) === ''
}
