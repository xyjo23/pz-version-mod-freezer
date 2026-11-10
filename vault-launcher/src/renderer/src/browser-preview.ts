import type { FreezeVersionSummary, LauncherSnapshot, VaultApi } from '../../shared/types'

const previewSnapshot: LauncherSnapshot = {
  activeSource: 'Frozen',
  isConfigured: true,
  isHealthy: true,
  managerRoot: 'D:\\PZ_Freeze_Manager',
  enginePath: 'D:\\PZ_Freeze_Manager\\tools\\PZ-Freeze-Manager.ps1',
  config: {
    ManagerRoot: 'D:\\PZ_Freeze_Manager',
    FreezeRoot: 'D:\\PZ_Freeze_Manager\\frozen\\B42.12.3',
    GamePath: 'D:\\PZ_Freeze_Manager\\frozen\\B42.12.3\\game',
    CachePath: 'D:\\PZ_Freeze_Manager\\frozen\\B42.12.3\\cache',
    ReportPath: 'D:\\PZ_Freeze_Manager\\frozen\\B42.12.3\\reports',
    BackupPath: 'D:\\PZ_Freeze_Manager\\frozen\\B42.12.3\\backups',
    Version: '42.12.3',
    DisplayName: '长期生存主档',
    BuildID: '20489167',
    WorkshopProjectCount: 154,
    EffectiveModCount: 287
  },
  lastBackup: {
    name: 'cache-snapshot_20261110_102300.zip',
    createdAt: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    size: 48758784
  },
  issue: null
}

export const installBrowserPreviewApi = (): void => {
  if (!import.meta.env.DEV || window.vault) return

  const api: VaultApi = {
    getSnapshot: async () => previewSnapshot,
    detectSteam: async () => ({ detected: true, issue: null, steamPath: 'E:\\apps\\games', libraryPath: 'E:\\apps\\games', manifestPath: 'E:\\apps\\games\\steamapps\\appmanifest_108600.acf', gamePath: 'E:\\apps\\games\\steamapps\\common\\ProjectZomboid', executablePath: 'E:\\apps\\games\\steamapps\\common\\ProjectZomboid\\ProjectZomboid64.exe', workshopPath: 'E:\\apps\\games\\steamapps\\workshop\\content\\108600', cachePath: 'C:\\Users\\victor\\Zomboid', version: '42.21.0', fullVersion: '42.21.0 preview', buildId: '25485521', installedAt: new Date(Date.now() - 86400000 * 4).toISOString(), workshopProjectCount: 154 }),
    launchSteam: async () => true,
    validateSteam: async () => true,
    openPath: async () => true,
    listVersions: async (): Promise<FreezeVersionSummary[]> => [
      { id: 'B42.12.3_build20489167', name: '长期生存主档', freezeRoot: previewSnapshot.config!.FreezeRoot, version: '42.12.3', buildId: '20489167', created: new Date().toISOString(), workshopProjectCount: 154, effectiveModCount: 287, isActive: true, isHealthy: true },
      { id: 'B41.78.16_buildLegacy', name: '怀旧模组服', freezeRoot: 'D:\\PZ_Freeze_Manager\\frozen\\B41.78.16', version: '41.78.16', buildId: 'legacy', created: new Date(Date.now() - 86400000 * 30).toISOString(), workshopProjectCount: 128, effectiveModCount: 164, isActive: false, isHealthy: true },
      { id: 'B42.10.0_challenge', name: '冬季挑战', freezeRoot: 'D:\\PZ_Freeze_Manager\\frozen\\B42.10.0', version: '42.10.0', buildId: '20311801', created: new Date(Date.now() - 86400000 * 12).toISOString(), workshopProjectCount: 141, effectiveModCount: 202, isActive: false, isHealthy: true }
    ],
    activateVersion: async () => previewSnapshot,
    activateSteam: async () => ({ ...previewSnapshot, activeSource: 'Steam' }),
    previewMigration: async (request) => ({ canRun: !(request.sourceType === 'Steam' && request.mode === 'FastLink'), sourceLabel: request.sourceType === 'Steam' ? 'Steam 原版 42.21.0' : '冻结版本 42.12.3', sourcePath: request.sourceType === 'Steam' ? 'E:\\apps\\games\\steamapps\\common\\ProjectZomboid' : previewSnapshot.config!.FreezeRoot, targetPath: 'D:\\PZ_Freeze_Manager\\frozen\\B42.21.0_build25485521', mode: request.mode, warnings: request.mode === 'FastLink' ? ['实验性快速模式仅复用只读游戏与 MOD；存档和配置保持独立。'] : [], steps: ['验证来源与目标', '迁移游戏、MOD 与缓存', '登记新版本'] }),
    executeMigration: async (request) => ({ ok: true, action: request.mode === 'SafeCopy' ? 'MigrateSafe' : 'MigrateFast', message: '版本迁移完成。', output: '[PASS] Browser preview migration completed.', finishedAt: new Date().toISOString() }),
    chooseManagerRoot: async () => previewSnapshot,
    runAction: async (action) => ({
      ok: true,
      action,
      message: `${action} completed.`,
      output: '[PASS] Browser preview action completed.',
      finishedAt: new Date().toISOString()
    }),
    openLogs: async () => true,
    minimizeWindow: async () => undefined,
    toggleMaximizeWindow: async () => undefined,
    closeWindow: async () => undefined
  }

  window.vault = api
}
