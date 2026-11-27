import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

export type ScriptSemanticStatus = 'script-definition-conflict' | 'script-definitions-identical' | 'script-definitions-disjoint' | 'script-unparsed'

export type ScriptSemanticResult = {
  status: ScriptSemanticStatus
  evidence: string[]
}

type ScriptSource = { modId: string; filePath: string }
type Token = { kind: 'atom' | 'string' | 'symbol'; value: string; line: number }
type Definition = {
  key: string
  digest: string
  summary: string
}
type ParsedScript = {
  modId: string
  complete: boolean
  errors: string[]
  definitions: Definition[]
}

const MAX_SCRIPT_BYTES = 8 * 1024 * 1024
const MAX_TOKENS = 300_000
const unique = (values: string[]): string[] => [...new Set(values)]
const tokenDigest = (tokens: Token[]): string => createHash('sha256').update(tokens.map((token) => `${token.kind}:${token.value}`).join('\u0000')).digest('hex')

const tokenize = (source: string): { tokens: Token[]; errors: string[] } => {
  const tokens: Token[] = []
  const errors: string[] = []
  let cursor = 0
  let line = 1
  const push = (kind: Token['kind'], value: string): void => {
    if (tokens.length < MAX_TOKENS) tokens.push({ kind, value, line })
    else if (!errors.includes('令牌数量超过安全上限。')) errors.push('令牌数量超过安全上限。')
  }
  while (cursor < source.length && tokens.length < MAX_TOKENS) {
    const char = source[cursor]
    if (/\s/.test(char)) {
      if (char === '\n') line += 1
      cursor += 1
      continue
    }
    if (char === '/' && source[cursor + 1] === '/') {
      const end = source.indexOf('\n', cursor + 2)
      cursor = end < 0 ? source.length : end
      continue
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const startLine = line
      const end = source.indexOf('*/', cursor + 2)
      if (end < 0) {
        errors.push(`第 ${startLine} 行的块注释没有结束。`)
        break
      }
      line += (source.slice(cursor, end + 2).match(/\n/g) ?? []).length
      cursor = end + 2
      continue
    }
    if (char === '"' || char === "'") {
      const quote = char
      const startLine = line
      let value = ''
      let closed = false
      cursor += 1
      while (cursor < source.length) {
        const current = source[cursor]
        if (current === quote) {
          cursor += 1
          closed = true
          break
        }
        if (current === '\\' && cursor + 1 < source.length) {
          value += `\\${source[cursor + 1]}`
          cursor += 2
          continue
        }
        if (current === '\n') line += 1
        value += current
        cursor += 1
      }
      if (!closed) {
        errors.push(`第 ${startLine} 行的字符串没有结束。`)
        break
      }
      push('string', value)
      continue
    }
    if ('{},='.includes(char)) {
      push('symbol', char)
      cursor += 1
      continue
    }
    const start = cursor
    while (cursor < source.length && !/\s/.test(source[cursor]) && !'{},='.includes(source[cursor])) {
      if (source[cursor] === '/' && (source[cursor + 1] === '/' || source[cursor + 1] === '*')) break
      cursor += 1
    }
    if (cursor === start) {
      push('symbol', char)
      cursor += 1
    } else push('atom', source.slice(start, cursor))
  }
  return { tokens, errors }
}

const matchingBrace = (tokens: Token[], open: number): number | null => {
  if (tokens[open]?.value !== '{') return null
  let depth = 0
  for (let cursor = open; cursor < tokens.length; cursor += 1) {
    if (tokens[cursor].value === '{') depth += 1
    else if (tokens[cursor].value === '}') {
      depth -= 1
      if (depth === 0) return cursor
    }
  }
  return null
}

const normalizedHeader = (tokens: Token[]): string => tokens.map((token) => token.value).join(' ').trim()

const blockSummary = (tokens: Token[], open: number, close: number): string => {
  const children = new Map<string, number>()
  const properties = new Map<string, string>()
  let cursor = open + 1
  let segmentStart = cursor
  while (cursor < close) {
    if (tokens[cursor].value === '{') {
      const header = normalizedHeader(tokens.slice(segmentStart, cursor)) || '<anonymous>'
      children.set(header, (children.get(header) ?? 0) + 1)
      const end = matchingBrace(tokens, cursor)
      if (end === null || end > close) break
      cursor = end + 1
      segmentStart = cursor
      continue
    }
    if (tokens[cursor].value === ',') {
      const segment = tokens.slice(segmentStart, cursor)
      const equals = segment.findIndex((token) => token.value === '=')
      if (equals > 0) properties.set(normalizedHeader(segment.slice(0, equals)), normalizedHeader(segment.slice(equals + 1)))
      cursor += 1
      segmentStart = cursor
      continue
    }
    cursor += 1
  }
  const childText = [...children].slice(0, 8).map(([name, count]) => `${name}×${count}`)
  const propertyText = [...properties].slice(0, 5).map(([key, value]) => `${key}=${value}`)
  return [...propertyText, ...childText].join('；') || '空定义块'
}

export const parseScriptText = (source: string, modId = 'fixture'): ParsedScript => {
  const lexical = tokenize(source.replace(/^\uFEFF/, ''))
  const tokens = lexical.tokens
  const errors = [...lexical.errors]
  const definitions: Definition[] = []
  let modulesFound = 0
  let cursor = 0
  while (cursor < tokens.length) {
    while (tokens[cursor]?.value === ',') cursor += 1
    if (cursor >= tokens.length) break
    if (tokens[cursor]?.value.toLowerCase() !== 'module' || tokens[cursor + 1]?.kind === 'symbol' || tokens[cursor + 2]?.value !== '{') {
      errors.push(`第 ${tokens[cursor]?.line ?? '?'} 行不是可识别的 module 声明。`)
      break
    }
    const moduleName = tokens[cursor + 1].value
    modulesFound += 1
    const moduleOpen = cursor + 2
    const moduleClose = matchingBrace(tokens, moduleOpen)
    if (moduleClose === null) {
      errors.push(`module ${moduleName} 的大括号没有结束。`)
      break
    }
    let inner = moduleOpen + 1
    let segmentStart = inner
    while (inner < moduleClose) {
      if (tokens[inner].value === ',') {
        const loose = normalizedHeader(tokens.slice(segmentStart, inner))
        if (loose) errors.push(`module ${moduleName} 中存在无法归类到定义块的内容：${loose.slice(0, 80)}`)
        inner += 1
        segmentStart = inner
        continue
      }
      if (tokens[inner].value === '{') {
        const headerTokens = tokens.slice(segmentStart, inner)
        const header = normalizedHeader(headerTokens)
        const close = matchingBrace(tokens, inner)
        if (!header || close === null || close > moduleClose) {
          errors.push(`module ${moduleName} 中有无法解析的定义块。`)
          break
        }
        definitions.push({
          key: `${moduleName}.${header}`,
          digest: tokenDigest(tokens.slice(inner, close + 1)),
          summary: blockSummary(tokens, inner, close)
        })
        inner = close + 1
        segmentStart = inner
        continue
      }
      inner += 1
    }
    const trailing = normalizedHeader(tokens.slice(segmentStart, moduleClose))
    if (trailing) errors.push(`module ${moduleName} 末尾存在无法归类的内容：${trailing.slice(0, 80)}`)
    cursor = moduleClose + 1
  }
  if (!modulesFound && !errors.length) errors.push('没有找到可识别的 module 声明。')
  return { modId, complete: errors.length === 0, errors: unique(errors), definitions }
}

const readAndParse = async (source: ScriptSource): Promise<ParsedScript> => {
  try {
    const stat = await fs.stat(source.filePath)
    if (stat.size > MAX_SCRIPT_BYTES) return { modId: source.modId, complete: false, errors: [`文件超过 ${MAX_SCRIPT_BYTES / 1024 / 1024} MiB 静态分析上限。`], definitions: [] }
    return parseScriptText(await fs.readFile(source.filePath, 'utf8'), source.modId)
  } catch (error) {
    return { modId: source.modId, complete: false, errors: [error instanceof Error ? error.message : String(error)], definitions: [] }
  }
}

export const analyzeScriptSemantics = async (sources: ScriptSource[]): Promise<ScriptSemanticResult> => {
  const parsed = await Promise.all(sources.map(readAndParse))
  if (parsed.some((entry) => !entry.complete)) {
    return {
      status: 'script-unparsed',
      evidence: parsed.filter((entry) => !entry.complete).flatMap((entry) => entry.errors.map((error) => `${entry.modId}：${error}`)).slice(0, 20)
    }
  }
  const definitions = new Map<string, Array<{ modId: string; digest: string; summary: string }>>()
  for (const file of parsed) for (const definition of file.definitions) {
    const owners = definitions.get(definition.key) ?? []
    owners.push({ modId: file.modId, digest: definition.digest, summary: definition.summary })
    definitions.set(definition.key, owners)
  }
  const shared = [...definitions].filter(([, owners]) => new Set(owners.map((owner) => owner.modId)).size > 1)
  const divergent = shared.filter(([, owners]) => new Set(owners.map((owner) => owner.digest)).size > 1)
  if (divergent.length) {
    return {
      status: 'script-definition-conflict',
      evidence: divergent.slice(0, 15).flatMap(([key, owners]) => [
        `同一脚本定义内容不同：${key}`,
        ...owners.map((owner) => `${owner.modId}：${owner.summary}`)
      ])
    }
  }
  if (shared.length) {
    return {
      status: 'script-definitions-identical',
      evidence: shared.slice(0, 15).map(([key, owners]) => `重复定义内容一致：${key} ← ${unique(owners.map((owner) => owner.modId)).join('、')}`)
    }
  }
  return {
    status: 'script-definitions-disjoint',
    evidence: [`解析 ${parsed.length} 个文件、${parsed.reduce((sum, entry) => sum + entry.definitions.length, 0)} 个定义；没有发现跨 MOD 同名定义。`]
  }
}
