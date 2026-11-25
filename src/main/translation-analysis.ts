import { promises as fs } from 'node:fs'
import path from 'node:path'

export type TranslationSemanticResult = {
  status: 'keys-disjoint' | 'keys-conflict' | 'unparsed'
  evidence: string[]
}

const flattenTranslationJson = (value: unknown, prefix: string, result: Map<string, string>): void => {
  if (value === null || typeof value !== 'object') {
    if (prefix) result.set(prefix, JSON.stringify(value))
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenTranslationJson(item, prefix ? `${prefix}.${index}` : String(index), result))
    return
  }
  for (const [key, item] of Object.entries(value)) flattenTranslationJson(item, prefix ? `${prefix}.${key}` : key, result)
}

const translationEntries = async (filePath: string): Promise<Map<string, string> | null> => {
  try {
    const raw = (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')
    const result = new Map<string, string>()
    if (path.extname(filePath).toLowerCase() === '.json') {
      flattenTranslationJson(JSON.parse(raw), '', result)
    } else {
      for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z0-9_.+\-]+)\s*=\s*(.*?)\s*,?\s*$/)
        if (!match || !match[2].trim()) continue
        const rawValue = match[2].trim().replace(/,\s*$/, '')
        let normalizedValue = rawValue.replace(/\s+/g, ' ')
        try { normalizedValue = JSON.stringify(JSON.parse(rawValue)) } catch { /* PZ translation syntax is not always strict JSON. */ }
        result.set(match[1], normalizedValue)
      }
    }
    return result.size ? result : null
  } catch {
    return null
  }
}

export const analyzeTranslationSemantics = async (files: string[]): Promise<TranslationSemanticResult> => {
  const parsed = await Promise.all(files.map(translationEntries))
  if (parsed.some((entries) => entries === null)) return { status: 'unparsed', evidence: ['至少一个翻译文件无法解析为 JSON 或键值表。'] }
  const valuesByKey = new Map<string, Set<string>>()
  for (const entries of parsed as Map<string, string>[]) for (const [key, value] of entries) {
    const values = valuesByKey.get(key) ?? new Set<string>()
    values.add(value)
    valuesByKey.set(key, values)
  }
  const conflictingKeys = [...valuesByKey].filter(([, values]) => values.size > 1).map(([key]) => key).sort((left, right) => left.localeCompare(right, 'en'))
  return conflictingKeys.length
    ? { status: 'keys-conflict', evidence: conflictingKeys.slice(0, 20).map((key) => `同键不同值：${key}`) }
    : { status: 'keys-disjoint', evidence: [`解析 ${valuesByKey.size} 个翻译键，没有发现同键不同值。`] }
}
