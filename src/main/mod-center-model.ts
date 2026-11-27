import type { ModCatalog, ModCatalogFileKind, ModCenterSnapshot } from '../shared/types'

const fileKinds: ModCatalogFileKind[] = ['lua', 'pz-script', 'java-archive', 'jvm-bytecode', 'native-binary', 'xml', 'json', 'translation', 'map', 'asset', 'media', 'metadata', 'other']

export const buildModCenterSnapshot = (catalog: ModCatalog): ModCenterSnapshot => {
  const byCatalogId = new Map(catalog.mods.map((mod) => [mod.catalogId, mod]))
  const installedModIds = new Set(Object.keys(catalog.indexes.byModId))
  const mods = catalog.mods.map((mod) => {
    const kindCounts = Object.fromEntries(fileKinds.map((kind) => [kind, 0])) as Record<ModCatalogFileKind, number>
    for (const file of mod.content.files) kindCounts[file.kind] += 1
    const requiredBy = mod.modId
      ? (catalog.indexes.requiredBy[mod.modId] ?? []).flatMap((catalogId) => {
          const dependent = byCatalogId.get(catalogId)
          return dependent ? [{ catalogId, name: dependent.name, modId: dependent.modId }] : []
        })
      : []
    const missingRequired = mod.dependencies.require.filter((modId) => !installedModIds.has(modId))
    const activeIncompatible = mod.active
      ? mod.dependencies.incompatible.filter((modId) => catalog.mods.some((candidate) => candidate.active && candidate.modId === modId))
      : []
    const incompleteEvidence = Boolean(mod.metadata.readError || mod.content.unreadable.length || mod.content.skippedLinks.length)
    return {
      catalogId: mod.catalogId,
      name: mod.name,
      modId: mod.modId,
      workshopId: mod.workshopId,
      source: mod.source,
      rootPath: mod.rootPath,
      active: mod.active,
      version: mod.version,
      dependencies: { ...mod.dependencies, missingRequired, activeIncompatible, requiredBy },
      content: {
        totalFiles: mod.content.totalFiles,
        totalBytes: mod.content.totalBytes,
        contentDigest: mod.content.contentDigest,
        kindCounts,
        layerOverrides: mod.content.layerOverrides.length,
        unreadable: mod.content.unreadable.length + (mod.metadata.readError ? 1 : 0),
        skippedLinks: mod.content.skippedLinks.length,
        jars: mod.content.jars.length,
        classes: mod.content.classes.length,
        nativeBinaries: mod.content.nativeBinaries.length
      },
      flags: {
        duplicateModId: Boolean(mod.modId && (catalog.indexes.byModId[mod.modId]?.length ?? 0) > 1),
        unresolved: Boolean(mod.version.resolutionIssue || !mod.modId),
        hasBinaryCode: Boolean(mod.content.jars.length || mod.content.classes.length || mod.content.nativeBinaries.length),
        incompleteEvidence
      },
      evidence: [...mod.evidence]
    }
  })
  return {
    schemaVersion: 1,
    generatedAt: catalog.generatedAt,
    source: catalog.source,
    sourceLabel: catalog.sourceLabel,
    catalogPath: catalog.catalogPath,
    catalogDigest: catalog.catalogDigest,
    completeness: catalog.completeness,
    game: catalog.game,
    summary: {
      ...catalog.summary,
      missingDependencies: mods.reduce((sum, mod) => sum + mod.dependencies.missingRequired.length, 0),
      activeIncompatibilities: mods.reduce((sum, mod) => sum + mod.dependencies.activeIncompatible.length, 0),
      modsWithBinaryCode: mods.filter((mod) => mod.flags.hasBinaryCode).length
    },
    methodology: [...catalog.methodology],
    limitations: [...catalog.limitations],
    mods
  }
}
