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
    DisplayName: 'B42.21.0_build25485521_20261104_195505_长期生存主档',
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
    detectSteam: async () => ({ detected: true, issue: null, steamPath: 'E:\\apps\\games', libraryPath: 'E:\\apps\\games', manifestPath: 'E:\\apps\\games\\steamapps\\appmanifest_108600.acf', gamePath: 'E:\\apps\\games\\steamapps\\common\\ProjectZomboid', executablePath: 'E:\\apps\\games\\steamapps\\common\\ProjectZomboid\\ProjectZomboid64.exe', workshopPath: 'E:\\apps\\games\\steamapps\\workshop\\content\\108600', cachePath: 'C:\\Users\\victor\\Zomboid', version: '42.22.2', fullVersion: '42.22.2 3d39148846', revision: '3d39148846', gameJarSha256: 'PREVIEW', identityStatus: 'verified', cachedVersion: '42.22.2', cachedRevision: '3d39148846', buildId: '26486631', installedAt: new Date(Date.now() - 86400000 * 4).toISOString(), workshopProjectCount: 154 }),
    launchSteam: async () => true,
    validateSteam: async () => true,
    openPath: async () => true,
    listCurrentMods: async () => [
      { key: 'WS2392709985__CommonSense', name: 'Common Sense', modId: 'CommonSense', workshopId: '2392709985', source: 'Workshop' },
      { key: 'WS2169435993__ModOptions', name: 'Mod Options', modId: 'modoptions', workshopId: '2169435993', source: 'Workshop' },
      { key: 'LocalSurvivorTools', name: '幸存者工具扩展', modId: 'SurvivorTools', workshopId: null, source: 'Local' }
    ],
    analyzeIntegrity: async () => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), source: 'Frozen', sourceLabel: '长期生存主档', plainSummary: '检查完成：18432 个文件均与登记状态一致。', reportPath: 'D:\\PZ_Freeze_Manager\\reports\\integrity\\latest-frozen.json', verdict: 'pass', storageMode: 'FullCopy', methodology: ['逐文件计算 SHA-256'], limitations: ['不判断 MOD 兼容性'], summary: { checkedFiles: 18432, missingFiles: 0, changedFiles: 0, addedFiles: 0, unreadableFiles: 0, brokenReferences: 0, findings: 1 }, findings: [{ id: 'integrity-pass', severity: 'pass', confidence: 'confirmed', category: 'baseline', title: '内容与登记基线一致', summary: '游戏和 MOD 文件均通过 SHA-256 比对。', impact: '版本仍保持冻结时内容。', action: '无需处理。', rule: 'FULL-BASELINE-COMPLETE', evidence: ['游戏：检查 17420，缺失 0，变化 0', 'MOD：检查 1012，缺失 0，变化 0'] }], rawOutput: '游戏：检查 17420，缺失 0，变化 0\nMOD：检查 1012，缺失 0，变化 0' }),
    analyzeCompatibility: async () => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), source: 'Frozen', sourceLabel: '长期生存主档', scopeLabel: '最近修改的存档：save', plainSummary: '没有发现明确阻断，但有 2 项需要核对。', reportPath: 'D:\\PZ_Freeze_Manager\\reports\\compatibility\\latest-frozen.json', identity: { version: '42.22.2', revision: '3d39148846', buildId: '26486631', jarSha256: 'PREVIEW', status: 'verified', source: 'binary', cachedVersion: '42.22.2', cachedRevision: '3d39148846', evidence: ['Core.class：42.22.2'] }, verdict: 'warning', methodology: ['解析 B42 MOD 目录和 mod.info'], limitations: ['静态分析不能执行 MOD 代码'], summary: { installedMods: 198, activeMods: 189, workshopProjects: 156, blockers: 0, warnings: 2, unknowns: 1, passes: 3, overlapPaths: 538, identicalOverlapPaths: 42, baseGameOverrides: 694 }, analysisContext: { kind: 'save', name: 'save', path: 'C:\\Users\\victor\\Zomboid\\Saves\\Sandbox\\save\\mods.txt', modIds: ['CommonSense'], workshopIds: [], missingModIds: [], missingWorkshopIds: [] }, activeContext: { kind: 'save', name: 'save', path: 'C:\\Users\\victor\\Zomboid\\Saves\\Sandbox\\save\\mods.txt', modIds: ['CommonSense'], workshopIds: [], missingModIds: [], missingWorkshopIds: [] }, serverContexts: [], issues: [{ id: 'identity-verified', severity: 'pass', confidence: 'confirmed', appliesToScope: true, category: 'identity', title: '游戏身份已从二进制确认', summary: '42.22.2 · Build 26486631', impact: '分析使用了实际游戏版本。', action: '无需处理。', rule: 'GAME-IDENTITY', evidence: ['Core.class'], modIds: [] }, { id: 'overlaps-lua', severity: 'unknown', confidence: 'inferred', appliesToScope: true, category: 'files', title: 'Lua 路径存在不同内容', summary: '需要运行时语义分析。', impact: '无法仅凭路径判断。', action: '结合日志核对。', rule: 'FILE-OVERLAP-LUA', evidence: ['media/lua/client/example.lua'], modIds: ['CommonSense'] }], overlaps: [], mods: [] }),
    listVersions: async (): Promise<FreezeVersionSummary[]> => [
      { id: 'B42.12.3_build20489167', name: 'B42.21.0_build25485521_20261104_195505_长期生存主档', freezeRoot: previewSnapshot.config!.FreezeRoot, version: '42.12.3', buildId: '20489167', created: new Date().toISOString(), workshopProjectCount: 154, effectiveModCount: 287, origin: 'Managed', isActive: true, isHealthy: true },
      { id: 'B41.78.16_buildLegacy', name: '共享包安装复核失败示例', freezeRoot: 'D:\\PZ_Freeze_Manager\\frozen\\B41.78.16', version: '41.78.16', buildId: 'legacy', created: new Date(Date.now() - 86400000 * 30).toISOString(), workshopProjectCount: 128, effectiveModCount: 164, origin: 'External', shareInstallStatus: 'Quarantined', isActive: false, isHealthy: false },
      { id: 'B42.10.0_challenge', name: '极寒冬季长期生存挑战与大型模组兼容性测试专用版本名称', freezeRoot: 'D:\\PZ_Freeze_Manager\\frozen\\B42.10.0', version: '42.10.0', buildId: '20311801', created: new Date(Date.now() - 86400000 * 12).toISOString(), workshopProjectCount: 141, effectiveModCount: 202, origin: 'Managed', isActive: false, isHealthy: true }
    ],
    importVersion: async () => ({ canceled: false, imported: 1, skipped: 0, message: '已登记 1 个外部版本。' }),
    createSharePackage: async () => ({ canceled: false, ok: true, filePath: 'E:\\PZ-share.pzshare', packageId: 'preview-package', digest: 'A'.repeat(64), message: '共享清单已生成。' }),
    inspectSharePackage: async () => ({ canceled: false, valid: true, canInstall: true, filePath: 'E:\\PZ-share.pzshare', packageId: 'preview-package', title: '长期生存主档', createdAt: new Date().toISOString(), source: 'Frozen', gameVersion: '42.22.0', buildId: '10240', modCount: 18, workshopCount: 15, digest: 'A'.repeat(64), trust: 'unsigned', rights: 'reference-only', findings: [{ severity: 'pass', title: '内容摘要一致', detail: 'SHA-256 已验证' }, { severity: 'warning', title: '制作者身份未签名', detail: 'v1 仅验证文件内容。' }], message: '共享包有效，本机内容满足精确重建条件。' }),
    installSharePackage: async () => ({ ok: true, message: '共享清单已安装为新的受管版本。', output: '预览模式', installedRoot: 'E:\\PZVault\\frozen\\preview-share' }),
    activateVersion: async () => previewSnapshot,
    activateSteam: async () => ({ ...previewSnapshot, activeSource: 'Steam' }),
    previewMigration: async (request) => {
      const hasLabel = Boolean(request.label?.trim())
      const steamFastLink = request.sourceType === 'Steam' && request.mode === 'FastLink'
      return {
        canRun: hasLabel && !steamFastLink,
        sourceLabel: request.sourceType === 'Steam' ? 'Steam 原版 42.22.2' : '冻结版本 42.12.3',
        sourcePath: request.sourceType === 'Steam' ? 'E:\\apps\\games\\steamapps\\common\\ProjectZomboid' : previewSnapshot.config!.FreezeRoot,
        targetPath: 'D:\\PZ_Freeze_Manager\\frozen\\B42.22.2_build26486631',
        mode: request.mode,
        warnings: [
          ...(!hasLabel ? ['请为新版本填写一个便于识别的名称；版本号只作为技术信息显示。'] : []),
          ...(steamFastLink ? ['Steam 原版会自动更新，不能作为薄版本的稳定基础；请先创建完整冻结版。'] : [])
        ],
        steps: ['验证来源与目标', '迁移游戏、MOD 与缓存', '登记新版本']
      }
    },
    executeMigration: async (request) => {
      const hasLabel = Boolean(request.label?.trim())
      const blocked = !hasLabel || (request.sourceType === 'Steam' && request.mode === 'FastLink')
      return { ok: !blocked, action: request.mode === 'SafeCopy' ? 'MigrateSafe' : 'MigrateFast', message: blocked ? '迁移条件未满足。' : '版本迁移完成。', output: blocked ? '请检查版本名称、来源和迁移模式。' : '[PASS] Browser preview migration completed.', finishedAt: new Date().toISOString() }
    },
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
