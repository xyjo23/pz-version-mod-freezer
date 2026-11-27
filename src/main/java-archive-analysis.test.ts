import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import test from 'node:test'

import { ZipFile } from 'yazl'

import { analyzeJavaArchive, parseJavaClass, readJavaRuntimeEvidence, selectEffectiveJavaClassOwners } from './java-archive-analysis'

const u2 = (value: number): Buffer => { const result = Buffer.alloc(2); result.writeUInt16BE(value); return result }
const u4 = (value: number): Buffer => { const result = Buffer.alloc(4); result.writeUInt32BE(value); return result }
const utf8 = (value: string): Buffer => { const bytes = Buffer.from(value, 'utf8'); return Buffer.concat([Buffer.from([1]), u2(bytes.length), bytes]) }
const classRef = (nameIndex: number): Buffer => Buffer.concat([Buffer.from([7]), u2(nameIndex)])

const fixtureClass = (): Buffer => Buffer.concat([
  Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]), u2(0), u2(61), u2(6),
  utf8('fixture/Test'), classRef(1), utf8('zombie/characters/IsoPlayer'), classRef(3), utf8('org/spongepowered/asm/mixin/Mixin'),
  u2(0x0001), u2(2), u2(4), u2(0),
  u2(0),
  u2(1), u2(0x0101), u2(1), u2(1), u2(0),
  u2(0)
])

const writeJar = async (filePath: string, classBuffer: Buffer): Promise<void> => {
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from('Manifest-Version: 1.0\r\nMulti-Release: true\r\nImplementation-Version: fixture\r\n\r\n'), 'META-INF/MANIFEST.MF')
  zip.addBuffer(classBuffer, 'fixture/Test.class')
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(filePath))
}

test('Class 常量池解析保留版本、PZ 引用和 native 方法证据', () => {
  const parsed = parseJavaClass(fixtureClass())
  assert.equal(parsed.name, 'fixture/Test')
  assert.equal(parsed.majorVersion, 61)
  assert.equal(parsed.nativeMethods, 1)
  assert.deepEqual(parsed.referencedClasses, ['zombie/characters/IsoPlayer'])
  assert(parsed.utf8Values.includes('org/spongepowered/asm/mixin/Mixin'))
})

test('JAR 受限读取生成类哈希、PZ API 与 Mixin 静态证据', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-java-analysis-'))
  try {
    const jarPath = path.join(root, 'fixture.jar')
    await writeJar(jarPath, fixtureClass())
    const bytes = await fs.readFile(jarPath)
    const archiveSha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase()
    const result = await analyzeJavaArchive(jarPath, 'media/java/client/fixture.jar', archiveSha256)
    assert.equal(result.completeness, 'complete')
    assert.equal(result.classes, 1)
    assert.equal(result.maximumClassMajor, 61)
    assert.equal(result.nativeMethods, 1)
    assert.equal(result.manifest.multiRelease, true)
    assert.deepEqual(result.projectZomboidClasses, ['zombie/characters/IsoPlayer'])
    assert.deepEqual(result.mixinFrameworks, ['SpongePowered Mixin'])
    assert.deepEqual(result.mixinTargets, ['zombie/characters/IsoPlayer'])
    assert.match(result.definedClasses[0].sha256, /^[A-F0-9]{64}$/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('损坏的 Class 保留为 partial 而不是把 JAR 误报为完整', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-java-analysis-bad-'))
  try {
    const jarPath = path.join(root, 'broken.jar')
    await writeJar(jarPath, Buffer.from('not-a-class'))
    const bytes = await fs.readFile(jarPath)
    const result = await analyzeJavaArchive(jarPath, 'broken.jar', createHash('sha256').update(bytes).digest('hex').toUpperCase())
    assert.equal(result.completeness, 'partial')
    assert.equal(result.classes, 0)
    assert.equal(result.errors.length, 1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('游戏自带 Java release 文件转换为可比较的 Class 上限', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-java-runtime-'))
  try {
    await fs.mkdir(path.join(root, 'jre64'), { recursive: true })
    await fs.writeFile(path.join(root, 'jre64', 'release'), 'IMPLEMENTOR="Fixture JVM"\nJAVA_VERSION="25.0.5"\n', 'utf8')
    const runtime = await readJavaRuntimeEvidence(root)
    assert.equal(runtime?.version, '25.0.5')
    assert.equal(runtime?.major, 25)
    assert.equal(runtime?.classMajor, 69)
    assert.equal(runtime?.implementor, 'Fixture JVM')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('多版本 JAR 只选择当前 Java 会采用的最高版本类', () => {
  const owners = [
    { catalogId: 'a', archivePath: 'a.jar', sha256: 'BASE', release: null, multiRelease: true },
    { catalogId: 'a', archivePath: 'a.jar', sha256: 'JAVA30', release: 30, multiRelease: true },
    { catalogId: 'b', archivePath: 'b.jar', sha256: 'BASE', release: null, multiRelease: false }
  ]
  assert.deepEqual(selectEffectiveJavaClassOwners(owners, 25).map((owner) => owner.sha256), ['BASE', 'BASE'])
  assert.deepEqual(selectEffectiveJavaClassOwners(owners, 30).map((owner) => owner.sha256), ['JAVA30', 'BASE'])
})
