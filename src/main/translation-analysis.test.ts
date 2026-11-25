import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { analyzeTranslationSemantics } from './translation-analysis.ts'

const withFiles = async (contents: Array<{ name: string; value: string }>, run: (paths: string[]) => Promise<void>): Promise<void> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-translation-'))
  try {
    const paths: string[] = []
    for (const item of contents) {
      const filePath = path.join(root, item.name)
      await fs.writeFile(filePath, item.value, 'utf8')
      paths.push(filePath)
    }
    await run(paths)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('不同 JSON 翻译键不会被误报为冲突', async () => {
  await withFiles([{ name: 'one.json', value: '{"OnlyOne":"One"}' }, { name: 'two.json', value: '{"OnlyTwo":"Two"}' }], async (paths) => {
    const result = await analyzeTranslationSemantics(paths)
    assert.equal(result.status, 'keys-disjoint')
  })
})

test('同一翻译键使用不同值时报告明确冲突键', async () => {
  await withFiles([{ name: 'one.txt', value: 'Label = "One",' }, { name: 'two.txt', value: 'Label = "Two",' }], async (paths) => {
    const result = await analyzeTranslationSemantics(paths)
    assert.equal(result.status, 'keys-conflict')
    assert.deepEqual(result.evidence, ['同键不同值：Label'])
  })
})

test('同一翻译键和值相同时语义通过', async () => {
  await withFiles([{ name: 'one.json', value: '{"Nested":{"Label":"Same"}}' }, { name: 'two.json', value: '{ "Nested": { "Label": "Same" } }' }], async (paths) => {
    const result = await analyzeTranslationSemantics(paths)
    assert.equal(result.status, 'keys-disjoint')
  })
})

test('无法解析的翻译文件保持待验证', async () => {
  await withFiles([{ name: 'one.txt', value: 'not a translation table' }, { name: 'two.txt', value: 'also invalid' }], async (paths) => {
    const result = await analyzeTranslationSemantics(paths)
    assert.equal(result.status, 'unparsed')
  })
})
