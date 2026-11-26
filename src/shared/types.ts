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
  revision: string | null
  gameJarSha256: string | null
  identityStatus: GameIdentityStatus
  cachedVersion: string | null
  cachedRevision: string | null
  buildId: string
  installedAt: string | null
  workshopProjectCount: number
}

export type GameIdentityStatus = 'verified' | 'stale-cache' | 'binary-only' | 'cache-only' | 'unknown'

export type GameIdentity = {
  version: string
  revision: string | null
  buildId: string
  jarSha256: string | null
  status: GameIdentityStatus
  source: 'binary' | 'cache' | 'metadata' | 'unknown'
  cachedVersion: string | null
  cachedRevision: string | null
  evidence: string[]
}

export type MigrationMode = 'SafeCopy' | 'FastLink'
export type MigrationSourceType = 'Steam' | 'Frozen'
export type FreezeStorageMode = 'FullCopy' | 'ThinReference'

export type ReferencedModRoot = {
  name: string
  sourcePath: string
  targetPath: string
  modIds: string[]
  workshopId: string | null
  files: number
  bytes: number
  linkMode?: 'junction' | 'hardlink'
  linkedFiles?: number
  copiedFiles?: number
}

export type MigrationStorageAnalysis = {
  strategy: FreezeStorageMode
  sourceGameFiles: number
  sourceGameBytes: number
  sourceCacheFiles: number
  sourceCacheBytes: number
  copiedMutableFiles: number
  copiedMutableBytes: number
  referencedModRoots: number
  referencedModFiles: number
  referencedModBytes: number
  omittedFiles: number
  omittedBytes: number
  estimatedWriteBytes: number
  estimatedSavedBytes: number
  activeModIds: string[]
  missingModIds: string[]
  contextPath: string | null
  fallbackToAllMods: boolean
}

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
  analysis?: MigrationStorageAnalysis
  space?: {
    requiredBytes: number
    reserveBytes: number
    availableBytes: number
    sufficient: boolean
  }
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
  Revision?: string
  GameJarSHA256?: string
  IdentityStatus?: GameIdentityStatus
  Created?: string
  DisplayName?: string
  WorkshopProjectCount?: number
  EffectiveModCount?: number
  LatestSaveActiveModCount?: number
  StorageMode?: FreezeStorageMode
  BaseFreezeRoot?: string
  BaseGamePath?: string
  BaseRevision?: string
  BaseGameJarSHA256?: string
  SourceFreezeRoot?: string
  MigrationMode?: MigrationMode
  MutableCachePolicyVersion?: number
  ReferencedMods?: ReferencedModRoot[]
  ShareInstallStatus?: 'Verified' | 'Quarantined'
  SharePackageID?: string
  SharePackageDigest?: string
}

export type FreezeVersionSummary = {
  id: string
  name: string
  freezeRoot: string
  gamePath?: string
  cachePath?: string
  backupPath?: string
  version: string
  fullVersion?: string
  buildId?: string
  created?: string
  workshopProjectCount?: number
  effectiveModCount?: number
  storageMode?: FreezeStorageMode
  origin: 'Managed' | 'External'
  managerRoot?: string
  registeredAt?: string
  shareInstallStatus?: 'Verified' | 'Quarantined'
  isActive: boolean
  isHealthy: boolean
}

export type VersionImportResult = {
  canceled: boolean
  imported: number
  skipped: number
  message: string
}

export type SharePackageMod = {
  name: string
  modId: string
  workshopId: string | null
  source: 'Workshop' | 'Local'
  selectedVersion: string | null
  variants: string[]
  require: string[]
  incompatible: string[]
  loadAfter: string[]
  loadBefore: string[]
  contentFingerprint: string
  files: number
  bytes: number
  delivery: 'steam-workshop-reference' | 'local-reference'
  embedded: false
}

export type SharePackageManifestV1 = {
  packageId: string
  createdAt: string
  producer: { name: 'Project Zomboid Vault'; version: string }
  title: string
  source: 'Steam' | 'Frozen'
  game: {
    appId: '108600'
    version: string
    fullVersion: string
    buildId: string
    revision: string | null
    jarSha256: string | null
    identityStatus: GameIdentityStatus
  }
  loadout: {
    contextKind: 'save' | 'server'
    contextName: string
    modIds: string[]
    workshopIds: string[]
  }
  mods: SharePackageMod[]
  analysis: {
    integrityVerdict: CompatibilitySeverity
    compatibilityVerdict: CompatibilitySeverity
    integritySummary: string
    compatibilitySummary: string
    warnings: string[]
  }
  rights: {
    policy: 'reference-only-v1'
    embeddedFiles: 0
    statement: string
  }
  exclusions: string[]
}

export type SharePackageEnvelopeV1 = {
  format: 'pz-vault-share'
  schemaVersion: 1
  manifest: SharePackageManifestV1
  integrity: { algorithm: 'SHA-256'; digest: string }
  signature: { status: 'unsigned'; reason: string }
}

export type SharePackageFinding = {
  severity: 'blocker' | 'warning' | 'pass'
  title: string
  detail: string
}

export type SharePackageCreateResult = {
  canceled: boolean
  ok: boolean
  filePath: string | null
  packageId: string | null
  digest: string | null
  message: string
}

export type SharePackageInspection = {
  canceled: boolean
  valid: boolean
  canInstall: boolean
  filePath: string | null
  packageId: string | null
  title: string | null
  createdAt: string | null
  source: 'Steam' | 'Frozen' | null
  gameVersion: string | null
  buildId: string | null
  modCount: number
  workshopCount: number
  digest: string | null
  trust: 'unsigned' | 'invalid'
  rights: 'reference-only' | 'unknown'
  findings: SharePackageFinding[]
  message: string
}

export type SharePackageInstallResult = {
  ok: boolean
  message: string
  output: string
  installedRoot: string | null
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

export type ModSummary = {
  key: string
  name: string
  modId: string | null
  workshopId: string | null
  source: 'Workshop' | 'Local'
}

export type CompatibilitySeverity = 'blocker' | 'warning' | 'unknown' | 'pass'
export type AnalysisConfidence = 'confirmed' | 'inferred' | 'unverified'

export type IntegrityFinding = {
  id: string
  severity: CompatibilitySeverity
  confidence: AnalysisConfidence
  category: 'identity' | 'baseline' | 'game' | 'mods' | 'reference' | 'external'
  title: string
  summary: string
  impact: string
  action: string
  rule: string
  evidence: string[]
}

export type IntegrityReport = {
  schemaVersion: 1
  generatedAt: string
  source: 'Steam' | 'Frozen'
  sourceLabel: string
  plainSummary: string
  reportPath: string | null
  verdict: CompatibilitySeverity
  storageMode?: FreezeStorageMode
  methodology: string[]
  limitations: string[]
  summary: {
    checkedFiles: number
    missingFiles: number
    changedFiles: number
    addedFiles: number
    unreadableFiles: number
    brokenReferences: number
    findings: number
  }
  findings: IntegrityFinding[]
  rawOutput: string
}

export type CompatibilityIssue = {
  id: string
  severity: CompatibilitySeverity
  confidence: AnalysisConfidence
  appliesToScope: boolean
  category: 'identity' | 'version' | 'dependency' | 'load-order' | 'conflict' | 'files' | 'save' | 'server' | 'security'
  title: string
  summary: string
  impact: string
  action: string
  rule: string
  evidence: string[]
  modIds: string[]
}

export type CompatibilityModRecord = {
  key: string
  name: string
  modId: string | null
  workshopId: string | null
  source: 'Workshop' | 'Local'
  rootPath: string
  selectedVersion: string | null
  variants: string[]
  versionMin: string | null
  versionMax: string | null
  require: string[]
  incompatible: string[]
  loadAfter: string[]
  loadBefore: string[]
  active: boolean
}

export type ModCatalogFileKind = 'lua' | 'pz-script' | 'java-archive' | 'jvm-bytecode' | 'native-binary' | 'xml' | 'json' | 'translation' | 'map' | 'asset' | 'media' | 'metadata' | 'other'

export type ModCatalogFile = {
  relativePath: string
  sourcePath: string
  layerPath: string
  bytes: number
  modifiedAt: string
  sha256: string
  kind: ModCatalogFileKind
}

export type ModCatalogEntry = {
  catalogId: string
  key: string
  name: string
  modId: string | null
  workshopId: string | null
  source: 'Workshop' | 'Local'
  rootPath: string
  active: boolean
  version: {
    target: string
    selected: string | null
    variants: string[]
    layers: string[]
    minimum: string | null
    maximum: string | null
    resolutionIssue: string | null
  }
  dependencies: {
    require: string[]
    incompatible: string[]
    loadAfter: string[]
    loadBefore: string[]
  }
  metadata: {
    path: string | null
    sha256: string | null
    readError: string | null
  }
  content: {
    files: ModCatalogFile[]
    totalFiles: number
    totalBytes: number
    contentDigest: string
    layerOverrides: Array<{ relativePath: string; replacedLayer: string; effectiveLayer: string }>
    skippedLinks: string[]
    unreadable: Array<{ path: string; error: string }>
    jars: string[]
    classes: string[]
    nativeBinaries: string[]
  }
  evidence: string[]
}

export type ModCatalog = {
  schemaVersion: 1
  generatedAt: string
  source: 'Steam' | 'Frozen'
  sourceLabel: string
  catalogPath: string
  game: GameIdentity
  digestAlgorithm: 'SHA-256'
  catalogDigest: string
  completeness: 'complete' | 'partial'
  summary: {
    discoveredMods: number
    resolvedMods: number
    unresolvedMods: number
    activeMods: number
    uniqueModIds: number
    workshopProjects: number
    duplicateModIds: number
    files: number
    bytes: number
    jars: number
    classes: number
    nativeBinaries: number
    unreadable: number
    skippedLinks: number
  }
  indexes: {
    byModId: Record<string, string[]>
    byWorkshopId: Record<string, string[]>
    requiredBy: Record<string, string[]>
  }
  methodology: string[]
  limitations: string[]
  mods: ModCatalogEntry[]
}

export type CompatibilityContext = {
  kind: 'save' | 'server'
  name: string
  path: string
  modIds: string[]
  workshopIds: string[]
  missingModIds: string[]
  missingWorkshopIds: string[]
}

export type FileOverlapClassification = 'lua' | 'scripts' | 'map' | 'tile-definition' | 'translation' | 'binary' | 'asset' | 'metadata' | 'other'

export type FileOverlap = {
  relativePath: string
  classification: FileOverlapClassification
  severity: CompatibilitySeverity
  modIds: string[]
  overridesBaseGame: boolean
  contentIdentical: boolean | null
  semanticStatus?: 'keys-disjoint' | 'keys-conflict' | 'unparsed'
  semanticEvidence?: string[]
}

export type CompatibilityReport = {
  schemaVersion: 1
  generatedAt: string
  source: 'Steam' | 'Frozen'
  sourceLabel: string
  scopeLabel: string
  plainSummary: string
  reportPath: string | null
  modCatalog: {
    path: string
    digest: string
    completeness: ModCatalog['completeness']
    files: number
    jars: number
    classes: number
    nativeBinaries: number
  }
  identity: GameIdentity
  verdict: CompatibilitySeverity
  methodology: string[]
  limitations: string[]
  summary: {
    installedMods: number
    activeMods: number
    workshopProjects: number
    blockers: number
    warnings: number
    unknowns: number
    passes: number
    overlapPaths: number
    identicalOverlapPaths: number
    baseGameOverrides: number
  }
  analysisContext: CompatibilityContext | null
  activeContext: CompatibilityContext | null
  serverContexts: CompatibilityContext[]
  issues: CompatibilityIssue[]
  overlaps: FileOverlap[]
  mods: CompatibilityModRecord[]
}

export type VaultApi = {
  getSnapshot: () => Promise<LauncherSnapshot>
  detectSteam: () => Promise<SteamInstallation>
  launchSteam: () => Promise<boolean>
  validateSteam: () => Promise<boolean>
  openPath: (targetPath: string) => Promise<boolean>
  listCurrentMods: () => Promise<ModSummary[]>
  analyzeIntegrity: () => Promise<IntegrityReport>
  analyzeCompatibility: () => Promise<CompatibilityReport>
  listVersions: () => Promise<FreezeVersionSummary[]>
  importVersion: () => Promise<VersionImportResult>
  createSharePackage: () => Promise<SharePackageCreateResult>
  inspectSharePackage: () => Promise<SharePackageInspection>
  installSharePackage: (filePath: string) => Promise<SharePackageInstallResult>
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
