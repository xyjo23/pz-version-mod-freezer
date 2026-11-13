import { contextBridge, ipcRenderer } from 'electron'

import type { LauncherAction, VaultApi } from '../shared/types'

const api: VaultApi = {
  getSnapshot: () => ipcRenderer.invoke('vault:get-snapshot'),
  detectSteam: () => ipcRenderer.invoke('vault:detect-steam'),
  launchSteam: () => ipcRenderer.invoke('vault:launch-steam'),
  validateSteam: () => ipcRenderer.invoke('vault:validate-steam'),
  openPath: (targetPath: string) => ipcRenderer.invoke('vault:open-path', targetPath),
  listCurrentMods: () => ipcRenderer.invoke('vault:list-current-mods'),
  listVersions: () => ipcRenderer.invoke('vault:list-versions'),
  activateVersion: (versionId: string) => ipcRenderer.invoke('vault:activate-version', versionId),
  activateSteam: () => ipcRenderer.invoke('vault:activate-steam'),
  previewMigration: (request) => ipcRenderer.invoke('vault:preview-migration', request),
  executeMigration: (request) => ipcRenderer.invoke('vault:execute-migration', request),
  chooseManagerRoot: () => ipcRenderer.invoke('vault:choose-root'),
  runAction: (action: LauncherAction) => ipcRenderer.invoke('vault:run-action', action),
  openLogs: () => ipcRenderer.invoke('vault:open-logs'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close')
}

contextBridge.exposeInMainWorld('vault', api)
