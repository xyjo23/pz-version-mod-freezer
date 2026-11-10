export type LauncherAction = 'Launch' | 'Verify' | 'BackupSave' | 'MigrateSafe' | 'MigrateFast'

export type SteamInstallation = {
  detected: boolean
  issue: string | null
  steamPath: string | null
  libraryPath: string | null
  manifestPath: string | null
  gamePath: string | null
  executablePath: string | null
  workshopPath: string | null
  cachePath: string | null
  version: string
  fullVersion: string
  buildId: string
  installedAt: string | null
  workshopProjectCount: number
}

export type MigrationMode = 'SafeCopy' | 'FastLink'
export type MigrationSourceType = 'Steam' | 'Frozen'

export type MigrationRequest = {
  sourceType: MigrationSourceType
  sourceId?: string
  mode: MigrationMode
  label?: string
  protectSaves: boolean
}

export type MigrationPreview = {
  canRun: boolean
  sourceLabel: string
  sourcePath: string | null
  targetPath: string | null
  mode: MigrationMode
  warnings: string[]
  steps: string[]
}

export type FreezeConfig = {
  ManagerRoot: string
  FreezeRoot: string
  GamePath: string
  CachePath: string
  ReportPath: string
  BackupPath: string
  ManifestPath?: string
  LaunchArguments?: string[]
  Version?: string
  FullVersion?: string
  BuildID?: string
  Created?: string
  DisplayName?: string
  WorkshopProjectCount?: number
  EffectiveModCount?: number
  LatestSaveActiveModCount?: number
}

export type FreezeVersionSummary = {
  id: string
  name: string
  freezeRoot: string
  version: string
  fullVersion?: string
  buildId?: string
  created?: string
  workshopProjectCount?: number
  effectiveModCount?: number
  isActive: boolean
  isHealthy: boolean
}

export type LauncherSnapshot = {
  activeSource: 'Steam' | 'Frozen'
  isConfigured: boolean
  isHealthy: boolean
  managerRoot: string | null
  enginePath: string | null
  config: FreezeConfig | null
  lastBackup: { name: string; createdAt: string; size: number } | null
  issue: string | null
}

export type ActionResult = {
  ok: boolean
  action: LauncherAction
  message: string
  output: string
  finishedAt: string
}

export type VaultApi = {
  getSnapshot: () => Promise<LauncherSnapshot>
  detectSteam: () => Promise<SteamInstallation>
  launchSteam: () => Promise<boolean>
  validateSteam: () => Promise<boolean>
  openPath: (targetPath: string) => Promise<boolean>
  listVersions: () => Promise<FreezeVersionSummary[]>
  activateVersion: (versionId: string) => Promise<LauncherSnapshot>
  activateSteam: () => Promise<LauncherSnapshot>
  previewMigration: (request: MigrationRequest) => Promise<MigrationPreview>
  executeMigration: (request: MigrationRequest) => Promise<ActionResult>
  chooseManagerRoot: () => Promise<LauncherSnapshot>
  runAction: (action: LauncherAction) => Promise<ActionResult>
  openLogs: () => Promise<boolean>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
}
