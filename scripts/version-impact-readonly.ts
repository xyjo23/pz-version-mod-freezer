import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { GameIdentity, ModCatalog } from '../src/shared/types'
import { analyzeVersionImpact } from '../src/main/version-impact-analysis'

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

const main = async (): Promise<void> => {
  const managerRoot = required('PZ_VERSION_IMPACT_MANAGER_ROOT')
  const currentGamePath = required('PZ_VERSION_IMPACT_CURRENT_GAME')
  const catalog = JSON.parse(await fs.readFile(required('PZ_VERSION_IMPACT_CATALOG'), 'utf8')) as ModCatalog
  const scriptIndex = JSON.parse(await fs.readFile(required('PZ_VERSION_IMPACT_SCRIPT_INDEX'), 'utf8')) as {
    definitionOwners: Array<{ key: string; owners: Array<{ modId: string }> }>
  }
  const current = catalog.game as GameIdentity
  const scoped = catalog.mods.some((mod) => mod.active) ? catalog.mods.filter((mod) => mod.active) : catalog.mods
  const keys = new Map<string, string[]>()
  for (const entry of scriptIndex.definitionOwners) for (const owner of entry.owners) keys.set(owner.modId, [...new Set([...(keys.get(owner.modId) ?? []), entry.key])])
  const report = await analyzeVersionImpact({
    managerRoot,
    currentGamePath,
    current,
    reportPath: path.resolve(required('PZ_VERSION_IMPACT_OUTPUT')),
    mods: scoped.map((mod) => ({
      id: mod.modId ?? mod.name,
      files: mod.content.files.map((file) => ({ relativePath: file.relativePath, sha256: file.sha256, kind: file.kind })),
      scriptDefinitionKeys: keys.get(mod.modId ?? mod.name) ?? [],
      projectZomboidClasses: [...new Set(mod.content.javaArchives.flatMap((archive) => archive.projectZomboidClasses))]
    }))
  })
  if (!report) throw new Error('No older frozen baseline was found.')
  console.log(`VERSION_IMPACT=${JSON.stringify({ reportPath: report.reportPath, digest: report.reportDigest, completeness: report.completeness, baseline: report.baseline, current: report.current, summary: report.summary })}`)
}

void main().catch((error) => {
  console.error(`VERSION_IMPACT_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
