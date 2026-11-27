import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'

import { open, type Entry, type ZipFile } from 'yauzl'

import type { JavaArchiveEvidence, JavaClassEvidence, JavaClassOwner, JavaRuntimeEvidence } from '../shared/types'

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_ENTRIES = 100_000
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
const MAX_CLASS_BYTES = 32 * 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024

const sha256File = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('error', reject)
  stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
})

export const readJavaRuntimeEvidence = async (gamePath: string): Promise<JavaRuntimeEvidence | null> => {
  const releasePath = path.join(gamePath, 'jre64', 'release')
  let raw: string
  try { raw = await fs.readFile(releasePath, 'utf8') } catch { return null }
  const values = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="(.*)"$/)
    if (match) values.set(match[1], match[2])
  }
  const version = values.get('JAVA_VERSION') ?? values.get('JAVA_RUNTIME_VERSION') ?? ''
  const major = Number(version.match(/^(?:1\.)?(\d+)/)?.[1])
  if (!version || !Number.isInteger(major) || major < 1 || major > 100) return null
  return { releasePath, version, major, classMajor: major + 44, implementor: values.get('IMPLEMENTOR') ?? null }
}

export const selectEffectiveJavaClassOwners = (owners: JavaClassOwner[], runtimeMajor: number | null): JavaClassOwner[] => {
  const byArchive = new Map<string, JavaClassOwner[]>()
  for (const owner of owners) {
    const key = `${owner.catalogId}\u0000${owner.archivePath}`
    const group = byArchive.get(key) ?? []
    group.push(owner)
    byArchive.set(key, group)
  }
  return [...byArchive.values()].flatMap((group) => {
    const base = group.find((owner) => owner.release === null)
    if (!group[0].multiRelease || runtimeMajor === null) return base ? [base] : []
    const selected = group.filter((owner) => owner.release !== null && owner.release <= runtimeMajor).sort((left, right) => (right.release ?? -1) - (left.release ?? -1))[0]
    return selected ? [selected] : base ? [base] : []
  })
}

type ParsedClass = {
  name: string
  majorVersion: number
  nativeMethods: number
  referencedClasses: string[]
  utf8Values: string[]
}

const ensure = (buffer: Buffer, offset: number, bytes: number): void => {
  if (offset < 0 || bytes < 0 || offset + bytes > buffer.length) throw new Error('Class 文件结构被截断。')
}

const normalizeClassName = (value: string): string[] => {
  if (!value.startsWith('[')) return value ? [value.replace(/\./g, '/')] : []
  return [...value.matchAll(/L([^;]+);/g)].map((match) => match[1].replace(/\./g, '/'))
}

export const parseJavaClass = (buffer: Buffer): ParsedClass => {
  let offset = 0
  const u1 = (): number => { ensure(buffer, offset, 1); return buffer[offset++] }
  const u2 = (): number => { ensure(buffer, offset, 2); const value = buffer.readUInt16BE(offset); offset += 2; return value }
  const u4 = (): number => { ensure(buffer, offset, 4); const value = buffer.readUInt32BE(offset); offset += 4; return value }
  const skip = (bytes: number): void => { ensure(buffer, offset, bytes); offset += bytes }
  if (u4() !== 0xCAFEBABE) throw new Error('不是有效的 Java Class 文件。')
  u2()
  const majorVersion = u2()
  const count = u2()
  const utf8 = new Map<number, string>()
  const classNames = new Map<number, number>()
  for (let index = 1; index < count; index += 1) {
    const tag = u1()
    if (tag === 1) {
      const length = u2()
      ensure(buffer, offset, length)
      utf8.set(index, buffer.toString('utf8', offset, offset + length))
      offset += length
    } else if (tag === 3 || tag === 4) skip(4)
    else if (tag === 5 || tag === 6) { skip(8); index += 1 }
    else if (tag === 7) classNames.set(index, u2())
    else if (tag === 8 || tag === 16 || tag === 19 || tag === 20) skip(2)
    else if ([9, 10, 11, 12, 17, 18].includes(tag)) skip(4)
    else if (tag === 15) skip(3)
    else throw new Error(`不支持的 Class 常量池标签：${tag}。`)
  }
  u2()
  const thisClassIndex = u2()
  u2()
  const interfaceCount = u2()
  skip(interfaceCount * 2)
  const skipAttributes = (): void => {
    const attributeCount = u2()
    for (let index = 0; index < attributeCount; index += 1) { u2(); skip(u4()) }
  }
  const skipMembers = (countValue: number, countNative: boolean): number => {
    let nativeMethods = 0
    for (let index = 0; index < countValue; index += 1) {
      const access = u2()
      u2(); u2()
      if (countNative && (access & 0x0100)) nativeMethods += 1
      skipAttributes()
    }
    return nativeMethods
  }
  skipMembers(u2(), false)
  const nativeMethods = skipMembers(u2(), true)
  skipAttributes()
  const resolveClass = (classIndex: number): string[] => normalizeClassName(utf8.get(classNames.get(classIndex) ?? -1) ?? '')
  const name = resolveClass(thisClassIndex)[0]
  if (!name) throw new Error('Class 文件缺少自身类名。')
  const referencedClasses = [...new Set([...classNames.keys()].flatMap(resolveClass).filter((candidate) => candidate !== name))].sort((left, right) => left.localeCompare(right, 'en'))
  return { name, majorVersion, nativeMethods, referencedClasses, utf8Values: [...utf8.values()] }
}

const readEntry = (zipFile: ZipFile, entry: Entry, limit: number): Promise<Buffer> => new Promise((resolve, reject) => {
  if (entry.uncompressedSize > limit) return reject(new Error(`条目超过安全读取上限：${entry.fileName}`))
  zipFile.openReadStream(entry, (error, stream) => {
    if (error || !stream) return reject(error ?? new Error(`无法读取 ${entry.fileName}`))
    const chunks: Buffer[] = []
    let bytes = 0
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > limit) stream.destroy(new Error(`条目解压后超过安全读取上限：${entry.fileName}`))
      else chunks.push(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
})

const parseManifest = (raw: string): Map<string, string> => {
  const unfolded = raw.replace(/\r?\n /g, '')
  const fields = new Map<string, string>()
  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    fields.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
  }
  return fields
}

const mixinFrameworkFor = (values: string[]): string[] => {
  const joined = values.join('\n')
  return [
    joined.includes('org/spongepowered/asm/mixin') ? 'SpongePowered Mixin' : null,
    joined.includes('com/llamalad7/mixinextras') ? 'MixinExtras' : null
  ].filter((value): value is string => value !== null)
}

const inferredMixinTargets = (values: string[]): string[] => [...new Set(values.flatMap((value) => {
  const normalized = value.replace(/\./g, '/')
  return [...normalized.matchAll(/(?:L)?(zombie\/[A-Za-z0-9_$/]+)(?:;)?/g)].map((match) => match[1])
}))].sort((left, right) => left.localeCompare(right, 'en'))

export const analyzeJavaArchive = async (sourcePath: string, relativePath: string, archiveSha256: string): Promise<JavaArchiveEvidence> => {
  const stats = await fs.stat(sourcePath)
  if (!stats.isFile() || stats.size > MAX_ARCHIVE_BYTES) throw new Error('JAR 不是普通文件或超过 512 MiB 安全上限。')
  if (await sha256File(sourcePath) !== archiveSha256) throw new Error('JAR 在文件登记后发生变化，拒绝采用不一致的内部证据。')
  return new Promise((resolve, reject) => {
    open(sourcePath, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (openError, zipFile) => {
      if (openError || !zipFile) return reject(openError ?? new Error('无法打开 JAR。'))
      let entries = 0
      let uncompressedBytes = 0
      let manifest = new Map<string, string>()
      const definitions: JavaClassEvidence[] = []
      const references = new Set<string>()
      const frameworks = new Set<string>()
      const targets = new Set<string>()
      const errors: string[] = []
      let settled = false
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        zipFile.close()
        reject(error)
      }
      zipFile.on('error', fail)
      zipFile.on('entry', (entry: Entry) => {
        void (async () => {
          entries += 1
          uncompressedBytes += entry.uncompressedSize
          if (entries > MAX_ENTRIES) throw new Error('JAR 条目数量超过 100000 安全上限。')
          if (uncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error('JAR 解压总量超过 1 GiB 安全上限。')
          if ((entry.generalPurposeBitFlag & 1) !== 0) {
            errors.push(`加密条目未读取：${entry.fileName}`)
          } else if (entry.fileName.toUpperCase() === 'META-INF/MANIFEST.MF') {
            try { manifest = parseManifest((await readEntry(zipFile, entry, MAX_MANIFEST_BYTES)).toString('utf8')) } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
          } else if (entry.fileName.toLowerCase().endsWith('.class') && !entry.fileName.endsWith('/')) {
            try {
              const buffer = await readEntry(zipFile, entry, MAX_CLASS_BYTES)
              const parsed = parseJavaClass(buffer)
              const release = Number(entry.fileName.match(/^META-INF\/versions\/(\d+)\//i)?.[1])
              definitions.push({ name: parsed.name, entryPath: entry.fileName, sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(), majorVersion: parsed.majorVersion, release: Number.isInteger(release) ? release : null, nativeMethods: parsed.nativeMethods })
              parsed.referencedClasses.forEach((value) => references.add(value))
              mixinFrameworkFor(parsed.utf8Values).forEach((value) => frameworks.add(value))
              inferredMixinTargets(parsed.utf8Values).forEach((value) => targets.add(value))
            } catch (error) {
              errors.push(`${entry.fileName}：${error instanceof Error ? error.message : String(error)}`)
            }
          }
          zipFile.readEntry()
        })().catch(fail)
      })
      zipFile.on('end', () => {
        void (async () => {
        if (settled) return
        const after = await fs.stat(sourcePath)
        if (after.size !== stats.size || after.mtimeMs !== stats.mtimeMs) throw new Error('JAR 在内部解析期间发生变化。')
        settled = true
        const defined = new Set(definitions.map((entry) => entry.name))
        const majors = definitions.map((entry) => entry.majorVersion)
        const projectZomboidClasses = [...references].filter((name) => name.startsWith('zombie/') || name.startsWith('se/krka/kahlua/')).sort((left, right) => left.localeCompare(right, 'en'))
        resolve({
          relativePath,
          sourcePath,
          archiveSha256,
          completeness: errors.length ? 'partial' : 'complete',
          entries,
          classes: definitions.length,
          uncompressedBytes,
          minimumClassMajor: majors.length ? Math.min(...majors) : null,
          maximumClassMajor: majors.length ? Math.max(...majors) : null,
          nativeMethods: definitions.reduce((sum, entry) => sum + entry.nativeMethods, 0),
          manifest: {
            mainClass: manifest.get('main-class') ?? null,
            classPath: (manifest.get('class-path') ?? '').split(/\s+/).filter(Boolean),
            implementationVersion: manifest.get('implementation-version') ?? null,
            multiRelease: manifest.get('multi-release')?.toLowerCase() === 'true'
          },
          definedClasses: definitions.sort((left, right) => left.name.localeCompare(right.name, 'en')),
          externalClasses: [...references].filter((name) => !defined.has(name)).sort((left, right) => left.localeCompare(right, 'en')),
          projectZomboidClasses,
          mixinFrameworks: [...frameworks].sort(),
          mixinTargets: [...targets].sort((left, right) => left.localeCompare(right, 'en')),
          errors
        })
        })().catch(fail)
      })
      zipFile.readEntry()
    })
  })
}
