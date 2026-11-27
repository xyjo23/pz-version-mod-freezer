import assert from 'node:assert/strict'
import test from 'node:test'

import type { CompatibilityModRecord } from '../shared/types'
import { planModLoadout } from './mod-loadout-planner'

const mod = (modId: string, value: Partial<CompatibilityModRecord> = {}): CompatibilityModRecord => ({
  key: modId, name: modId, modId, workshopId: null, source: 'Local', rootPath: `C:\\mods\\${modId}`,
  selectedVersion: '42.21', variants: ['42.21'], versionMin: null, versionMax: null,
  require: [], incompatible: [], loadAfter: [], loadBefore: [], active: false, ...value
})

test('规划器递归补齐依赖并按约束生成稳定顺序', () => {
  const result = planModLoadout([
    mod('Core', { workshopId: '100' }),
    mod('Library', { require: ['Core'], workshopId: '200' }),
    mod('Feature', { require: ['Library'], loadAfter: ['Library'], workshopId: '300' })
  ], ['Core'], ['Feature'])
  assert.deepEqual(result.autoAddedDependencies, ['Library', 'Core'])
  assert.deepEqual(result.orderedModIds, ['Core', 'Library', 'Feature'])
  assert.deepEqual(result.workshopIds, ['100', '200', '300'])
  assert.deepEqual(result.addedModIds, ['Library', 'Feature'])
  assert.equal(result.blockers.length, 0)
})

test('规划器阻断缺失依赖、互斥、重复来源和循环顺序', () => {
  const result = planModLoadout([
    mod('A', { require: ['Missing'], incompatible: ['B'], loadAfter: ['B'] }),
    mod('B', { loadAfter: ['A'] }),
    mod('Duplicate'), mod('Duplicate', { rootPath: 'C:\\mods\\Duplicate2' })
  ], [], ['A', 'B', 'Duplicate'])
  assert(result.blockers.some((entry) => entry.includes('缺少必需依赖')))
  assert(result.blockers.some((entry) => entry.includes('声明互斥')))
  assert(result.blockers.some((entry) => entry.includes('2 个来源')))
  assert(result.blockers.some((entry) => entry.includes('加载顺序存在循环')))
})

test('规划器不把仅安装但未选中的互斥项误报为冲突', () => {
  const result = planModLoadout([mod('A', { incompatible: ['B'] }), mod('B')], [], ['A'])
  assert.equal(result.blockers.length, 0)
  assert.deepEqual(result.orderedModIds, ['A'])
})

test('规划器阻断无可用 B42 层和不兼容或无法解析的版本范围', () => {
  const result = planModLoadout([
    mod('FutureOnly', { selectedVersion: null, variants: ['42.30'] }),
    mod('TooOld', { versionMax: '42.21' }),
    mod('BadRange', { versionMin: 'next' }),
    mod('Compatible', { versionMin: '42.20', versionMax: '42.23' })
  ], [], ['FutureOnly', 'TooOld', 'BadRange', 'Compatible'], null, '42.22.2')
  assert(result.blockers.some((entry) => entry.includes('没有适用于游戏 42.22.2')))
  assert(result.blockers.some((entry) => entry.includes('不包含当前游戏 42.22.2')))
  assert(result.blockers.some((entry) => entry.includes('版本范围无法验证')))
  assert(!result.blockers.some((entry) => entry.includes('Compatible')))
})
