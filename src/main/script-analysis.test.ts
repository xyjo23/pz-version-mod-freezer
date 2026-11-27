import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { analyzeScriptCollection, analyzeScriptSemantics, parseScriptText } from './script-analysis.ts'

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

test('支持匿名 module、嵌套块注释、短横线注释和纯注释文件', () => {
  const anonymous = parseScriptText('module { -- sounds\n sound Pen { clip { file = pen.ogg, } } }')
  assert.equal(anonymous.complete, true)
  assert.equal(anonymous.definitions[0]?.key, '<anonymous>.sound Pen')
  const nested = parseScriptText('/* outer /* inner */ still outer */ module Base { item Tool { Type = Normal, } }')
  assert.equal(nested.complete, true)
  assert.equal(parseScriptText('/* TBD */').complete, true)
  assert.equal(parseScriptText('').complete, true)
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

test('全局索引发现不同文件路径中的同名实体并保留不完整覆盖率', async () => {
  await withFiles([
    { modId: 'one', value: 'module Base { item Shared { Type = Normal, Weight = 1.0, } }' },
    { modId: 'two', value: 'module Base { item Shared { Type = Normal, Weight = 2.0, } }' },
    { modId: 'broken', value: 'module Base { item Broken {' }
  ], async (rawSources) => {
    const sources = rawSources.map((source, index) => ({ ...source, relativePath: `media/scripts/${index}.txt` }))
    const result = await analyzeScriptCollection(sources)
    assert.equal(result.files, 3)
    assert.equal(result.parsedFiles, 2)
    assert.equal(result.partialFiles, 1)
    assert.equal(result.crossPathConflicts.length, 1)
    assert.equal(result.crossPathConflicts[0]?.key, 'Base.item Shared')
    assert.equal(result.owners['Base.item Shared']?.length, 2)
  })
})

test('附件模型和 XUI 皮肤的扩展式定义不混入替换警告', async () => {
  await withFiles([
    { modId: 'one', value: 'module Base { model MaleBody { mesh = Skinned/MaleBody, attachment One { bone = Spine, } } }' },
    { modId: 'two', value: 'module Base { model MaleBody { mesh = Skinned/MaleBody, attachment Two { bone = Head, } } }' }
  ], async (rawSources) => {
    const sources = rawSources.map((source, index) => ({ ...source, relativePath: `media/scripts/attachments-${index}.txt` }))
    const result = await analyzeScriptCollection(sources)
    assert.equal(result.crossPathConflicts.length, 0)
    assert.equal(result.composableVariations.length, 1)
  })
})
