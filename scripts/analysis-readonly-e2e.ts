import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { analyzeCompatibility } from '../src/main/compatibility-service'
import { analyzeIntegrity } from '../src/main/integrity-service'

const testRoot = process.env.PZ_ANALYSIS_E2E_ROOT
if (!testRoot) throw new Error('PZ_ANALYSIS_E2E_ROOT is required.')

const main = async (): Promise<void> => {
  const userData = path.join(testRoot, 'user-data')
  await fs.mkdir(userData, { recursive: true })
  await fs.writeFile(path.join(userData, 'launcher-settings.json'), JSON.stringify({ managerRoot: testRoot, activeSource: 'Steam' }, null, 2), 'utf8')
  app.setPath('userData', userData)
  await app.whenReady()

  const integrity = await analyzeIntegrity({ submitSteamValidation: false })
  if (integrity.source !== 'Steam' || integrity.verdict !== 'unknown') throw new Error('Steam read-only integrity result did not preserve the unknown boundary.')
  if (!integrity.plainSummary.includes('没有触发 Steam 官方文件验证')) throw new Error('Steam integrity analysis unexpectedly submitted validation.')
  if (!integrity.methodology.some((item) => item.includes('只读模式不向 Steam 提交验证请求'))) throw new Error('Read-only methodology contradicts the executed Steam validation mode.')
  if (!integrity.limitations.some((item) => item.includes('不能宣告文件完整性通过'))) throw new Error('Read-only limitations overstate Steam integrity evidence.')
  if (!integrity.reportPath || !path.resolve(integrity.reportPath).startsWith(path.resolve(testRoot))) throw new Error('Integrity report escaped the isolated test root.')

  const compatibility = await analyzeCompatibility()
  if (compatibility.source !== 'Steam') throw new Error('Compatibility analysis did not use Steam.')
  if (!compatibility.summary.installedMods) throw new Error('No installed MOD was resolved from the real Workshop/cache data.')
  if (!compatibility.reportPath || !path.resolve(compatibility.reportPath).startsWith(path.resolve(testRoot))) throw new Error('Compatibility report escaped the isolated test root.')
  if (!existsSync(compatibility.reportPath)) throw new Error('Compatibility report was not persisted.')

  console.log(`ANALYSIS_E2E=${JSON.stringify({
    identity: compatibility.identity,
    installedMods: compatibility.summary.installedMods,
    activeMods: compatibility.summary.activeMods,
    workshopProjects: compatibility.summary.workshopProjects,
    verdict: compatibility.verdict,
    blockers: compatibility.summary.blockers,
    warnings: compatibility.summary.warnings,
    unknowns: compatibility.summary.unknowns,
    overlaps: compatibility.summary.overlapPaths,
    scope: compatibility.scopeLabel,
    integrityReport: integrity.reportPath,
    compatibilityReport: compatibility.reportPath
  })}`)
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`ANALYSIS_E2E_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
