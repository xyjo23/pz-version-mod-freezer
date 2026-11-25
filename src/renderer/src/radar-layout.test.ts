import assert from 'node:assert/strict'
import test from 'node:test'

import { layoutRadarItems } from './radar-layout.ts'

const sameIdentity = Array.from({ length: 4 }, (_, index) => ({
  key: `version-${index}`,
  version: '42.22.2',
  created: '2026-11-24T08:00:00.000Z',
  current: index === 0
}))

test('相同版本与时间仍会获得不同雷达位置', () => {
  const positions = layoutRadarItems(sameIdentity)
  assert.equal(positions.length, sameIdentity.length)
  assert.equal(new Set(positions.map(({ left, top }) => `${left.toFixed(4)},${top.toFixed(4)}`)).size, sameIdentity.length)
  assert.deepEqual(positions[0], { left: 50, top: 50 })
})

test('所有常规版本点都保留在安全边界内', () => {
  const items = Array.from({ length: 24 }, (_, index) => ({
    key: `version-${index}`,
    version: `42.${index}.${index % 5}`,
    created: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    current: index === 7
  }))
  const positions = layoutRadarItems(items)
  for (const position of positions) {
    assert.ok(position.left >= 13 && position.left <= 87, `left=${position.left}`)
    assert.ok(position.top >= 13 && position.top <= 87, `top=${position.top}`)
  }
})

test('布局输入不变时坐标保持稳定', () => {
  assert.deepEqual(layoutRadarItems(sameIdentity), layoutRadarItems(sameIdentity))
})
