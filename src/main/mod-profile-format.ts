import { createHash } from 'node:crypto'

import type { ModProfile } from '../shared/types'
import { canonicalizeShareValue } from './share-package-format'

export const MOD_PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i
export const MOD_PROFILE_SHA256 = /^[A-F0-9]{64}$/i
const LOADOUT_ID = /^[^\r\n,;{}=]{1,512}$/

const exactKeys = (value: object, expected: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, 'en'))
  const wanted = [...expected].sort((left, right) => left.localeCompare(right, 'en'))
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label} 字段不符合 MOD 配置档案 v1。`)
}

const validText = (value: unknown, label: string, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} 无效。`)
  return value
}

export const validateModProfileName = (value: unknown): string => validText(value, '配置档案名称', 80).trim()
const nullableText = (value: unknown, label: string, max: number): string | null => value === null ? null : validText(value, label, max)

const loadoutIds = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.length > 5000 || value.some((entry) => typeof entry !== 'string' || !LOADOUT_ID.test(entry))) throw new Error(`${label} 无效或超过数量限制。`)
  if (new Set(value).size !== value.length) throw new Error(`${label} 包含重复项。`)
  return value as string[]
}

export const digestModProfile = (profile: Omit<ModProfile, 'profileDigest'> | ModProfile): string => {
  const { profileDigest: _ignored, ...value } = profile as ModProfile
  return createHash('sha256').update(canonicalizeShareValue(value), 'utf8').digest('hex').toUpperCase()
}

export const validateModProfile = (value: unknown): ModProfile => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件不是 MOD 配置档案对象。')
  const profile = value as ModProfile
  exactKeys(profile, ['format', 'schemaVersion', 'id', 'name', 'createdAt', 'updatedAt', 'game', 'binding', 'loadout', 'catalog', 'digestAlgorithm', 'profileDigest'], '配置档案')
  if (profile.format !== 'pz-vault-mod-profile' || profile.schemaVersion !== 1) throw new Error('不支持的 MOD 配置档案格式。')
  if (!MOD_PROFILE_ID.test(profile.id)) throw new Error('配置档案 ID 无效。')
  validateModProfileName(profile.name)
  if (!Number.isFinite(Date.parse(profile.createdAt)) || !Number.isFinite(Date.parse(profile.updatedAt))) throw new Error('配置档案时间无效。')
  if (!profile.game || typeof profile.game !== 'object') throw new Error('缺少游戏身份。')
  exactKeys(profile.game, ['source', 'sourceLabel', 'version', 'buildId', 'revision', 'jarSha256'], '游戏身份')
  if (profile.game.source !== 'Steam' && profile.game.source !== 'Frozen') throw new Error('游戏来源无效。')
  validText(profile.game.sourceLabel, '游戏来源名称', 240)
  validText(profile.game.version, '游戏版本', 80)
  validText(profile.game.buildId, 'Build ID', 80)
  nullableText(profile.game.revision, 'revision', 160)
  if (profile.game.jarSha256 !== null && !MOD_PROFILE_SHA256.test(profile.game.jarSha256)) throw new Error('游戏 JAR SHA-256 无效。')
  if (!profile.binding || typeof profile.binding !== 'object') throw new Error('缺少上下文绑定。')
  exactKeys(profile.binding, ['kind', 'name', 'sourcePath'], '上下文绑定')
  if (profile.binding.kind !== 'save' && profile.binding.kind !== 'server') throw new Error('上下文类型无效。')
  validText(profile.binding.name, '上下文名称', 240)
  nullableText(profile.binding.sourcePath, '本机上下文路径', 4096)
  if (!profile.loadout || typeof profile.loadout !== 'object') throw new Error('缺少启用清单。')
  exactKeys(profile.loadout, ['modIds', 'workshopIds'], '启用清单')
  loadoutIds(profile.loadout.modIds, 'Mod ID 清单')
  loadoutIds(profile.loadout.workshopIds, 'Workshop ID 清单')
  if (!profile.catalog || typeof profile.catalog !== 'object') throw new Error('缺少数据库证据。')
  exactKeys(profile.catalog, ['digest', 'completeness'], '数据库证据')
  if (!MOD_PROFILE_SHA256.test(profile.catalog.digest) || !['complete', 'partial'].includes(profile.catalog.completeness)) throw new Error('数据库证据无效。')
  if (profile.digestAlgorithm !== 'SHA-256' || !MOD_PROFILE_SHA256.test(profile.profileDigest)) throw new Error('配置档案摘要无效。')
  if (digestModProfile(profile) !== profile.profileDigest.toUpperCase()) throw new Error('配置档案摘要校验失败，文件可能被修改。')
  return profile
}

export const rewriteSaveMods = (raw: string, modIds: string[]): string => {
  loadoutIds(modIds, 'Mod ID 清单')
  const hasBom = raw.startsWith('\uFEFF')
  const body = hasBom ? raw.slice(1) : raw
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const lines = body.split(/\r?\n/)
  const heading = lines.findIndex((line) => /^\s*mods\s*$/i.test(line))
  if (heading < 0) throw new Error('mods.txt 缺少 mods 区块。')
  const nextContent = lines.findIndex((line, index) => index > heading && line.trim().length > 0)
  if (nextContent < 0 || !/^\s*\{\s*$/.test(lines[nextContent])) throw new Error('mods.txt 的 mods 区块缺少开始括号。')
  const opening = nextContent
  const closing = lines.findIndex((line, index) => index > opening && /^\s*\}\s*$/.test(line))
  if (closing < 0) throw new Error('mods.txt 的 mods 区块缺少结束括号。')
  const modLines = lines.slice(opening + 1, closing)
  const firstMod = modLines.findIndex((line) => /^\s*mod\s*=.*?,?\s*$/i.test(line))
  const indent = firstMod >= 0 ? modLines[firstMod].match(/^\s*/)?.[0] ?? '    ' : `${lines[opening].match(/^\s*/)?.[0] ?? ''}    `
  const preserved = modLines.filter((line) => !/^\s*mod\s*=.*?,?\s*$/i.test(line))
  const prefixLength = firstMod >= 0 ? modLines.slice(0, firstMod).filter((line) => !/^\s*mod\s*=.*?,?\s*$/i.test(line)).length : preserved.length
  const replacement = [...preserved.slice(0, prefixLength), ...modIds.map((id) => `${indent}mod = ${id},`), ...preserved.slice(prefixLength)]
  lines.splice(opening + 1, closing - opening - 1, ...replacement)
  return `${hasBom ? '\uFEFF' : ''}${lines.join(eol)}`
}

const replaceIniKey = (raw: string, key: string, values: string[]): string => {
  loadoutIds(values, `${key} 清单`)
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const indexes = lines.flatMap((line, index) => new RegExp(`^\\s*${key}\\s*=`, 'i').test(line) ? [index] : [])
  if (indexes.length > 1) throw new Error(`服务器配置包含多个 ${key}= 项，拒绝猜测。`)
  const next = `${key}=${values.join(';')}`
  if (indexes.length === 1) lines[indexes[0]] = next
  else if (lines.at(-1) === '') lines.splice(lines.length - 1, 0, next)
  else lines.push(next)
  return lines.join(eol)
}

export const rewriteServerLoadout = (raw: string, modIds: string[], workshopIds: string[]): string => {
  const hasBom = raw.startsWith('\uFEFF')
  let body = hasBom ? raw.slice(1) : raw
  body = replaceIniKey(body, 'Mods', modIds)
  body = replaceIniKey(body, 'WorkshopItems', workshopIds)
  return `${hasBom ? '\uFEFF' : ''}${body}`
}
