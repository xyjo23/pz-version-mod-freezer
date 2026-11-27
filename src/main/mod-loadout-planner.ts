import type { CompatibilityModRecord } from '../shared/types'
import { gameVersionKey } from './mod-resolver'

export type PlannedLoadout = {
  requestedModIds: string[]
  orderedModIds: string[]
  workshopIds: string[]
  autoAddedDependencies: string[]
  addedModIds: string[]
  removedModIds: string[]
  orderChanged: boolean
  workshopOrderChanged: boolean
  blockers: string[]
  warnings: string[]
}

const unique = (values: string[]): string[] => [...new Set(values)]
const sequenceEqual = (left: string[], right: string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index])

export const planModLoadout = (mods: CompatibilityModRecord[], currentModIds: string[], rawRequestedModIds: string[], currentWorkshopIds: string[] | null = null, targetVersion?: string): PlannedLoadout => {
  const requestedModIds = unique(rawRequestedModIds.map((id) => id.trim()).filter(Boolean))
  const blockers: string[] = []
  const warnings: string[] = []
  if (requestedModIds.length !== rawRequestedModIds.length) blockers.push('目标清单包含空白或重复 Mod ID。')
  const byId = new Map<string, CompatibilityModRecord[]>()
  for (const mod of mods) {
    if (!mod.modId) continue
    const records = byId.get(mod.modId) ?? []
    records.push(mod)
    byId.set(mod.modId, records)
  }
  const desired = new Set(requestedModIds)
  const autoAddedDependencies: string[] = []
  const queue = [...requestedModIds]
  const inspected = new Set<string>()
  while (queue.length) {
    const modId = queue.shift()!
    if (inspected.has(modId)) continue
    inspected.add(modId)
    const records = byId.get(modId) ?? []
    if (!records.length) {
      blockers.push(`Mod ID “${modId}”当前未安装。`)
      continue
    }
    if (records.length > 1) {
      blockers.push(`Mod ID “${modId}”存在 ${records.length} 个来源，不能确定应使用哪一个。`)
      continue
    }
    for (const required of records[0].require) {
      if (!byId.has(required)) {
        blockers.push(`“${modId}”缺少必需依赖“${required}”。`)
        continue
      }
      if (!desired.has(required)) {
        desired.add(required)
        autoAddedDependencies.push(required)
        queue.push(required)
      }
    }
  }
  if (autoAddedDependencies.length) warnings.push(`已自动补入 ${autoAddedDependencies.length} 个必需依赖。`)

  const selectedIds = [...desired]
  const targetVersionKey = targetVersion ? gameVersionKey(targetVersion) : -1
  for (const modId of selectedIds) {
    const record = byId.get(modId)?.length === 1 ? byId.get(modId)![0] : null
    if (!record) continue
    if (record.variants.length > 0 && !record.selectedVersion) {
      blockers.push(`“${modId}”没有适用于游戏 ${targetVersion ?? '当前版本'} 的 B42 内容层。`)
    }
    if (!record.versionMin && !record.versionMax) continue
    const minimum = record.versionMin ? gameVersionKey(record.versionMin) : -1
    const maximum = record.versionMax ? gameVersionKey(record.versionMax) : -1
    if (targetVersionKey < 0 || (record.versionMin && minimum < 0) || (record.versionMax && maximum < 0)) {
      blockers.push(`“${modId}”的游戏版本范围无法验证。`)
      continue
    }
    if ((record.versionMin && targetVersionKey < minimum) || (record.versionMax && targetVersionKey > maximum)) {
      blockers.push(`“${modId}”声明支持 ${record.versionMin ?? '不限'} ～ ${record.versionMax ?? '不限'}，不包含当前游戏 ${targetVersion}。`)
    }
  }
  const conflictPairs = new Set<string>()
  for (const modId of selectedIds) {
    const record = byId.get(modId)?.length === 1 ? byId.get(modId)![0] : null
    if (!record) continue
    for (const incompatible of record.incompatible) {
      if (!desired.has(incompatible)) continue
      const pair = [modId, incompatible].sort((left, right) => left.localeCompare(right, 'en')).join('\u0000')
      if (!conflictPairs.has(pair)) {
        conflictPairs.add(pair)
        blockers.push(`“${modId}”与“${incompatible}”声明互斥，不能同时启用。`)
      }
    }
  }

  const currentRank = new Map(currentModIds.map((id, index) => [id, index]))
  const requestedRank = new Map(requestedModIds.map((id, index) => [id, index]))
  const rank = (id: string): number => currentRank.get(id) ?? currentModIds.length + (requestedRank.get(id) ?? requestedModIds.length)
  const compareIds = (left: string, right: string): number => rank(left) - rank(right) || left.localeCompare(right, 'en')
  const adjacency = new Map(selectedIds.map((id) => [id, new Set<string>()]))
  const indegree = new Map(selectedIds.map((id) => [id, 0]))
  const addEdge = (before: string, after: string): void => {
    if (before === after || !desired.has(before) || !desired.has(after)) return
    const targets = adjacency.get(before)!
    if (targets.has(after)) return
    targets.add(after)
    indegree.set(after, (indegree.get(after) ?? 0) + 1)
  }
  for (const modId of selectedIds) {
    const record = byId.get(modId)?.length === 1 ? byId.get(modId)![0] : null
    if (!record) continue
    for (const required of record.require) addEdge(required, modId)
    for (const after of record.loadAfter) addEdge(after, modId)
    for (const before of record.loadBefore) addEdge(modId, before)
  }
  const ready = selectedIds.filter((id) => indegree.get(id) === 0).sort(compareIds)
  const orderedModIds: string[] = []
  while (ready.length) {
    const modId = ready.shift()!
    orderedModIds.push(modId)
    for (const target of [...(adjacency.get(modId) ?? [])].sort(compareIds)) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) {
        ready.push(target)
        ready.sort(compareIds)
      }
    }
  }
  if (orderedModIds.length !== selectedIds.length) {
    const cycleIds = selectedIds.filter((id) => !orderedModIds.includes(id)).sort(compareIds)
    blockers.push(`加载顺序存在循环：${cycleIds.join('、')}。`)
    orderedModIds.push(...cycleIds)
  }

  const workshopIds = unique(orderedModIds.flatMap((modId) => {
    const record = byId.get(modId)?.length === 1 ? byId.get(modId)![0] : null
    return record?.workshopId ? [record.workshopId] : []
  }))
  const currentSet = new Set(currentModIds)
  const desiredSet = new Set(orderedModIds)
  const addedModIds = orderedModIds.filter((id) => !currentSet.has(id))
  const removedModIds = currentModIds.filter((id) => !desiredSet.has(id))
  return {
    requestedModIds,
    orderedModIds,
    workshopIds,
    autoAddedDependencies: unique(autoAddedDependencies),
    addedModIds,
    removedModIds,
    orderChanged: !sequenceEqual(orderedModIds, currentModIds),
    workshopOrderChanged: currentWorkshopIds !== null && !sequenceEqual(workshopIds, currentWorkshopIds),
    blockers: unique(blockers),
    warnings: unique(warnings)
  }
}
