import assert from 'node:assert/strict'
import test from 'node:test'

import type { ModProfile } from '../shared/types'
import { digestModProfile, rewriteSaveMods, rewriteServerLoadout, validateModProfile } from './mod-profile-format'

const signedProfile = (): ModProfile => {
  const base: Omit<ModProfile, 'profileDigest'> = {
    format: 'pz-vault-mod-profile', schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', name: 'Fixture',
    createdAt: '2026-11-27T00:00:00.000Z', updatedAt: '2026-11-27T00:00:00.000Z',
    game: { source: 'Frozen', sourceLabel: 'Fixture', version: '42.21.0', buildId: 'fixture', revision: 'revision', jarSha256: 'A'.repeat(64) },
    binding: { kind: 'save', name: 'Save', sourcePath: null },
    loadout: { modIds: ['Base.Mod', 'Vehicle Mod'], workshopIds: ['123456789'] },
    catalog: { digest: 'B'.repeat(64), completeness: 'complete' }, digestAlgorithm: 'SHA-256'
  }
  return { ...base, profileDigest: digestModProfile(base) }
}

test('存档 mods.txt 只替换 mods 区块并保留其他内容、BOM 和换行', () => {
  const source = '\uFEFFVERSION = 1,\r\n\r\nmods\r\n{\r\n    # retained comment\r\n    mod = Old.One,\r\n    mod = Old.Two,\r\n}\r\n\r\nmaps\r\n{\r\n    map = Existing,\r\n}\r\n'
  const next = rewriteSaveMods(source, ['New.One', 'New Two'])
  assert(next.startsWith('\uFEFF'))
  assert(next.includes('\r\n'))
  assert.match(next, /# retained comment/)
  assert.match(next, /mod = New\.One,\r\n\s*mod = New Two,/)
  assert.doesNotMatch(next, /Old\.One|Old\.Two/)
  assert.match(next, /maps\r\n\{\r\n    map = Existing,/)
})

test('服务器配置只替换 Mods 与 WorkshopItems', () => {
  const source = 'PublicName=Fixture\r\nMods=Old.One;Old.Two\r\nPauseEmpty=true\r\nWorkshopItems=111;222\r\n'
  const next = rewriteServerLoadout(source, ['New.One', 'New Two'], ['333', '444'])
  assert.equal(next, 'PublicName=Fixture\r\nMods=New.One;New Two\r\nPauseEmpty=true\r\nWorkshopItems=333;444\r\n')
  assert.throws(() => rewriteServerLoadout('Mods=A\nMods=B\nWorkshopItems=1', ['C'], ['2']), /多个 Mods/)
})

test('配置档案拒绝隐藏字段、摘要篡改和换行注入', () => {
  const valid = signedProfile()
  assert.equal(validateModProfile(valid).id, valid.id)
  assert.throws(() => validateModProfile({ ...valid, hidden: true }), /字段不符合/)
  assert.throws(() => validateModProfile({ ...valid, name: 'Changed' }), /摘要校验失败/)
  const injected = { ...valid, loadout: { ...valid.loadout, modIds: ['Safe\nWorkshopItems=evil'] } }
  assert.throws(() => validateModProfile(injected), /Mod ID 清单.*无效/)
})
