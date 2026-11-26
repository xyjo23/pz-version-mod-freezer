import { contextBridge, ipcRenderer } from 'electron'

import type { LauncherAction, VaultApi } from '../shared/types'

const api: VaultApi = {
  getSnapshot: () => ipcRenderer.invoke('vault:get-snapshot'),
  detectSteam: () => ipcRenderer.invoke('vault:detect-steam'),
  launchSteam: () => ipcRenderer.invoke('vault:launch-steam'),
  validateSteam: () => ipcRenderer.invoke('vault:validate-steam'),
  openPath: (targetPath: string) => ipcRenderer.invoke('vault:open-path', targetPath),
  listCurrentMods: () => ipcRenderer.invoke('vault:list-current-mods'),
  analyzeIntegrity: () => ipcRenderer.invoke('vault:analyze-integrity'),
  analyzeCompatibility: () => ipcRenderer.invoke('vault:analyze-compatibility'),
  listModProfiles: () => ipcRenderer.invoke('vault:list-mod-profiles'),
  createModProfile: (name: string, contextPath?: string) => ipcRenderer.invoke('vault:create-mod-profile', name, contextPath),
  compareModProfile: (profileId: string, contextPath?: string) => ipcRenderer.invoke('vault:compare-mod-profile', profileId, contextPath),
  applyModProfile: (profileId: string, previewToken: string, contextPath?: string) => ipcRenderer.invoke('vault:apply-mod-profile', profileId, previewToken, contextPath),
  undoModProfile: () => ipcRenderer.invoke('vault:undo-mod-profile'),
  exportModProfile: (profileId: string) => ipcRenderer.invoke('vault:export-mod-profile', profileId),
  importModProfile: () => ipcRenderer.invoke('vault:import-mod-profile'),
  listVersions: () => ipcRenderer.invoke('vault:list-versions'),
  importVersion: () => ipcRenderer.invoke('vault:import-version'),
  createSharePackage: () => ipcRenderer.invoke('vault:create-share-package'),
  inspectSharePackage: () => ipcRenderer.invoke('vault:inspect-share-package'),
  installSharePackage: (filePath: string) => ipcRenderer.invoke('vault:install-share-package', filePath),
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
