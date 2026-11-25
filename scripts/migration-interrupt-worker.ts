import { existsSync } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { executeMigration } from '../src/main/migration-service'
import { listVersions } from '../src/main/vault-service'

const testRoot = process.env.PZ_MIGRATION_INTERRUPT_ROOT
if (!testRoot) throw new Error('PZ_MIGRATION_INTERRUPT_ROOT is required.')

const main = async (): Promise<void> => {
  const userData = path.join(testRoot, '.launcher-user-data')
  if (!existsSync(userData)) throw new Error(`Missing worker user data: ${userData}`)
  app.setPath('userData', userData)
  await app.whenReady()
  const baseRoot = path.join(testRoot, 'frozen', 'interrupt-base')
  const baseVersion = (await listVersions()).find((version) => path.resolve(version.freezeRoot) === path.resolve(baseRoot))
  if (!baseVersion) throw new Error('Interrupt fixture base version was not registered.')
  const result = await executeMigration({ sourceType: 'Frozen', sourceId: baseVersion.id, mode: 'SafeCopy', label: 'Round6 Forced Stop', protectSaves: false })
  console.log(`MIGRATION_INTERRUPT_WORKER=${JSON.stringify(result)}`)
  if (!result.ok) throw new Error(result.output)
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`MIGRATION_INTERRUPT_WORKER_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
