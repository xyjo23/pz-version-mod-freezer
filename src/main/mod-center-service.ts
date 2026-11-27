import { promises as fs } from 'node:fs'

import type { ModCatalog, ModCenterSnapshot } from '../shared/types'
import { analyzeCompatibility } from './compatibility-service'
import { buildModCenterSnapshot } from './mod-center-model'

const MAX_CATALOG_BYTES = 256 * 1024 * 1024

export const loadModCenter = async (): Promise<ModCenterSnapshot> => {
  const report = await analyzeCompatibility()
  const stats = await fs.stat(report.modCatalog.path)
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_CATALOG_BYTES) throw new Error('统一 MOD 数据库为空或超过安全读取上限。')
  const parsed = JSON.parse((await fs.readFile(report.modCatalog.path, 'utf8')).replace(/^\uFEFF/, '')) as Partial<ModCatalog>
  if (
    parsed.schemaVersion !== 1 || parsed.catalogPath !== report.modCatalog.path ||
    parsed.catalogDigest !== report.modCatalog.digest || parsed.source !== report.source ||
    !parsed.game || parsed.game.jarSha256 !== report.identity.jarSha256 ||
    !parsed.summary || !parsed.indexes || !Array.isArray(parsed.mods) ||
    !Array.isArray(parsed.methodology) || !Array.isArray(parsed.limitations)
  ) throw new Error('统一 MOD 数据库与刚完成的兼容性分析不一致，拒绝显示过期结果。')
  return buildModCenterSnapshot(parsed as ModCatalog, report.activeContext, report.serverContexts)
}
