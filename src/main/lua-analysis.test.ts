import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { analyzeLuaSemantics, analyzeLuaText } from './lua-analysis.ts'

const withFiles = async (contents: Array<{ modId: string; value: string }>, run: (sources: Array<{ modId: string; filePath: string }>) => Promise<void>): Promise<void> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pz-lua-'))
  try {
    const sources = await Promise.all(contents.map(async (item, index) => {
      const filePath = path.join(root, `${index}.lua`)
      await fs.writeFile(filePath, item.value, 'utf8')
      return { modId: item.modId, filePath }
    }))
    await run(sources)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('注释和字符串不会制造 require、事件或全局写入证据', () => {
  const result = analyzeLuaText(`-- require "Fake"\nlocal note = "Events.OnTick.Add(Fake)"\nlocal value = { type = "Slot", attachments = { Hammer = "Belt" } }`)
  assert.deepEqual(result.requires, [])
  assert.deepEqual(result.eventHooks, [])
  assert.deepEqual(result.globalWrites, [])
})

test('提取 require、事件挂接、全局函数和直接注册键', () => {
  const result = analyzeLuaText(`
require "Hotbar/ISHotbarAttachDefinition"
function Shared.patch() end
Events.OnGameStart.Add(Shared.patch)
ItemBodyLocation.register("Example:Slot")
`)
  assert.deepEqual(result.requires, ['Hotbar/ISHotbarAttachDefinition'])
  assert.deepEqual(result.eventHooks, ['OnGameStart.Add:Shared.patch'])
  assert.deepEqual(result.globalWrites, ['Shared.patch'])
  assert.equal(result.registrations[0]?.key, 'ItemBodyLocation.register:Example:Slot')
})

test('惯用的全局表按需初始化不误报为共同覆盖', async () => {
  await withFiles([
    { modId: 'one', value: 'Shared = Shared or {}\nShared.one = 1' },
    { modId: 'two', value: 'Shared = Shared or {}\nShared.two = 2' }
  ], async (sources) => {
    const result = await analyzeLuaSemantics(sources)
    assert.equal(result.status, 'lua-static-disjoint')
  })
})

test('多个 MOD 写入同一全局符号时给出明确警告证据', async () => {
  await withFiles([
    { modId: 'one', value: 'Shared.patch = function() return 1 end' },
    { modId: 'two', value: 'Shared.patch = function() return 2 end' }
  ], async (sources) => {
    const result = await analyzeLuaSemantics(sources)
    assert.equal(result.status, 'lua-symbol-conflict')
    assert.match(result.evidence.join('\n'), /Shared\.patch.*one、two/)
  })
})

test('同一表注册键内容不同会被识别，局部变量名不影响比较', async () => {
  await withFiles([
    { modId: 'one', value: 'local First = { type = "Slot", attachments = { A = "One" } }\ntable.insert(ISHotbarAttachDefinition, First)' },
    { modId: 'two', value: 'local Second = { type = "Slot", attachments = { A = "Two" } }\ntable.insert(ISHotbarAttachDefinition, Second)' }
  ], async (sources) => {
    const result = await analyzeLuaSemantics(sources)
    assert.equal(result.status, 'lua-symbol-conflict')
    assert.match(result.evidence.join('\n'), /ISHotbarAttachDefinition:type=Slot/)
  })
})

test('同一注册键内容相同时保留为待验证而不误报冲突', async () => {
  const body = 'local Entry = { type = "Slot", attachments = { A = "Same" } }\ntable.insert(ISHotbarAttachDefinition, Entry)'
  await withFiles([{ modId: 'one', value: body }, { modId: 'two', value: body }], async (sources) => {
    const result = await analyzeLuaSemantics(sources)
    assert.equal(result.status, 'lua-registration-repeat')
    assert.match(result.evidence.join('\n'), /重复注册相同内容/)
  })
})

test('未结束的长注释不会产生虚假结论', async () => {
  await withFiles([
    { modId: 'one', value: '--[[ unfinished' },
    { modId: 'two', value: 'LocalOnly = 1' }
  ], async (sources) => {
    const result = await analyzeLuaSemantics(sources)
    assert.equal(result.status, 'lua-unparsed')
  })
})
