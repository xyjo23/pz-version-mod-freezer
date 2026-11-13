import { join } from 'node:path'

import { app, BrowserWindow, ipcMain, shell } from 'electron'

import type { LauncherAction } from '../shared/types'
import { executeMigration, previewMigration } from './migration-service'
import { detectSteamInstallation, launchSteamGame, validateSteamGame } from './steam-service'
import { activateSteam, activateVersion, chooseManagerRoot, getSnapshot, listCurrentMods, listVersions, openLogs, runAction } from './vault-service'

let mainWindow: BrowserWindow | null = null
const iconPath = join(__dirname, '../../assets/app-icon.png')

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    icon: iconPath,
    backgroundColor: '#090d0c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.pzvault.launcher')
  ipcMain.handle('vault:get-snapshot', getSnapshot)
  ipcMain.handle('vault:detect-steam', detectSteamInstallation)
  ipcMain.handle('vault:launch-steam', launchSteamGame)
  ipcMain.handle('vault:validate-steam', validateSteamGame)
  ipcMain.handle('vault:open-path', async (_event, targetPath: string) => (await shell.openPath(targetPath)) === '')
  ipcMain.handle('vault:list-current-mods', listCurrentMods)
  ipcMain.handle('vault:list-versions', listVersions)
  ipcMain.handle('vault:activate-version', (_event, versionId: string) => activateVersion(versionId))
  ipcMain.handle('vault:activate-steam', activateSteam)
  ipcMain.handle('vault:preview-migration', (_event, request) => previewMigration(request))
  ipcMain.handle('vault:execute-migration', (_event, request) => executeMigration(request))
  ipcMain.handle('vault:choose-root', chooseManagerRoot)
  ipcMain.handle('vault:run-action', (_event, action: LauncherAction) => runAction(action))
  ipcMain.handle('vault:open-logs', openLogs)
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggle-maximize', () =>
    mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()
  )
  ipcMain.handle('window:close', () => mainWindow?.close())
  if (hasSingleInstanceLock) createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
