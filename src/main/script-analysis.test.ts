import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { analyzeScriptSemantics, parseScriptText } from './script-analysis.ts'

const withFiles = async (contents: Array<{ modId: string; value: string }>, run: (sources: Array<{ modId: string; filePath: string }>) => Promise<void>): Promise<void> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-script-'))
  try {
    const sources = await Promise.all(contents.map(async (item, index) => {
      const filePath = path.join(root, `${index}.txt`)
      await fs.writeFile(filePath, item.value, 'utf8')
      return { modId: item.modId, filePath }
    }))
    await run(sources)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('解析 module 下的命名定义并忽略注释与排版差异', () => {
  const parsed = parseScriptText(`
/* header */ module Base {
  item Example // line comment
  { Type = Normal, DisplayName = "Example Item", }
  recipe Make Example { Result:Example, Time:10.0, }
}
`)
  assert.equal(parsed.complete, true)
  assert.deepEqual(parsed.definitions.map((definition) => definition.key), ['Base.item Example', 'Base.recipe Make Example'])
})

test('不同模块或定义名不会被误报为覆盖', async () => {
  await withFiles([
    { modId: 'one', value: 'module One { item Tool { Type = Normal, } }' },
    { modId: 'two', value: 'module Two { item Tool { Type = Normal, } }' }
  ], async (sources) => {
    const result = await analyzeScriptSemantics(sources)
    assert.equal(result.status, 'script-definitions-disjoint')
  })
})

test('同一完整定义键内容不同时给出实体和结构证据', async () => {
  await withFiles([
    { modId: 'base-car', value: 'module Base { vehicle Car { template! = CarTemplate, skin { texture = Car_1, } skin { texture = Car_2, } } }' },
    { modId: 'skin-pack', value: 'module Base { vehicle Car { template! = CarTemplate, skin { texture = Car_1, } skin { texture = Car_2, } skin { texture = Car_3, } } }' }
  ], async (sources) => {
    const result = await analyzeScriptSemantics(sources)
    assert.equal(result.status, 'script-definition-conflict')
    assert.match(result.evidence.join('\n'), /Base\.vehicle Car/)
    assert.match(result.evidence.join('\n'), /skin×2/)
    assert.match(result.evidence.join('\n'), /skin×3/)
  })
})

test('注释和空白不同但定义内容相同时识别为相同', async () => {
  await withFiles([
    { modId: 'one', value: 'module Base { item Tool { Type = Normal, Weight = 1.0, } }' },
    { modId: 'two', value: 'module Base\n{\n item Tool /* note */ { Type=Normal, Weight=1.0, }\n}' }
  ], async (sources) => {
    const result = await analyzeScriptSemantics(sources)
    assert.equal(result.status, 'script-definitions-identical')
  })
})

test('字符串转义不同不会被归并成相同定义', async () => {
  await withFiles([
    { modId: 'one', value: 'module Base { item Tool { Tooltip = "Line\\nBreak", } }' },
    { modId: 'two', value: 'module Base { item Tool { Tooltip = "LinenBreak", } }' }
  ], async (sources) => {
    const result = await analyzeScriptSemantics(sources)
    assert.equal(result.status, 'script-definition-conflict')
  })
})

test('未闭合注释或大括号保持待验证', async () => {
  await withFiles([
    { modId: 'one', value: 'module Base { item Tool { Type = Normal, }' },
    { modId: 'two', value: '/* unfinished' }
  ], async (sources) => {
    const result = await analyzeScriptSemantics(sources)
    assert.equal(result.status, 'script-unparsed')
  })
})
