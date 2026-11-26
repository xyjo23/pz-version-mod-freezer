import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

type AtomicWriteOptions = {
  backupPath?: string
}

const writeQueues = new Map<string, Promise<void>>()

export const normalizeRoot = (value: string): string => path.resolve(value).replace(/[\\/]+$/, '')

export const isPathWithin = (parent: string, candidate: string): boolean => {
  const relative = path.relative(normalizeRoot(parent), normalizeRoot(candidate))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const existingRealPath = async (value: string): Promise<string> => {
  try {
    return normalizeRoot(await fs.realpath(value))
  } catch {
    return normalizeRoot(value)
  }
}

export const assertPathWithin = async (parent: string, candidate: string, description: string): Promise<void> => {
  if (!await isRealPathWithin(parent, candidate)) {
    const [resolvedParent, resolvedCandidate] = await Promise.all([
      existingRealPath(parent),
      existingRealPath(candidate)
    ])
    throw new Error(`${description}：${resolvedCandidate} 不属于 ${resolvedParent}`)
  }
}

export const isRealPathWithin = async (parent: string, candidate: string): Promise<boolean> => {
  const [resolvedParent, resolvedCandidate] = await Promise.all([
    existingRealPath(parent),
    existingRealPath(candidate)
  ])
  return isPathWithin(resolvedParent, resolvedCandidate)
}

const sameContents = async (filePath: string, contents: string | Buffer): Promise<boolean> => {
  try {
    const current = await fs.readFile(filePath)
    const next = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')
    return current.equals(next)
  } catch {
    return false
  }
}

const withWriteQueue = async <T>(filePath: string, operation: () => Promise<T>): Promise<T> => {
  const key = normalizeRoot(filePath).toLowerCase()
  const previous = writeQueues.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.catch(() => undefined).then(() => current)
  writeQueues.set(key, tail)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (writeQueues.get(key) === tail) writeQueues.delete(key)
  }
}

const syncFile = async (filePath: string): Promise<void> => {
  const handle = await fs.open(filePath, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const replaceFile = async (temporaryPath: string, filePath: string): Promise<void> => {
  try {
    await fs.rename(temporaryPath, filePath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(code ?? '')) throw error
  }

  const rollbackPath = `${filePath}.pzvault-rollback`
  try {
    await fs.rm(rollbackPath, { force: true })
    await fs.rename(filePath, rollbackPath)
    try {
      await fs.rename(temporaryPath, filePath)
      await fs.rm(rollbackPath, { force: true })
    } catch (error) {
      try {
        await fs.access(filePath)
      } catch {
        await fs.rename(rollbackPath, filePath)
      }
      throw error
    }
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

const recoverInterruptedReplace = async (filePath: string): Promise<void> => {
  const rollbackPath = `${filePath}.pzvault-rollback`
  try {
    await fs.access(rollbackPath)
  } catch {
    return
  }
  try {
    await fs.access(filePath)
    await fs.rm(rollbackPath, { force: true })
  } catch {
    await fs.rename(rollbackPath, filePath)
  }
}

export const atomicWriteFileIfChanged = async (
  filePath: string,
  contents: string | Buffer,
  options: AtomicWriteOptions = {}
): Promise<boolean> => withWriteQueue(filePath, async () => {
  await recoverInterruptedReplace(filePath)
  if (await sameContents(filePath, contents)) return false

  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporaryPath, contents)
    await syncFile(temporaryPath)
    if (options.backupPath) {
      try {
        await fs.copyFile(filePath, options.backupPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await replaceFile(temporaryPath, filePath)
    return true
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
})

export const atomicWriteJsonIfChanged = async (
  filePath: string,
  value: unknown,
  options: AtomicWriteOptions & { trailingNewline?: boolean } = {}
): Promise<boolean> => {
  const contents = `${JSON.stringify(value, null, 2)}${options.trailingNewline ? '\n' : ''}`
  return atomicWriteFileIfChanged(filePath, contents, options)
}
