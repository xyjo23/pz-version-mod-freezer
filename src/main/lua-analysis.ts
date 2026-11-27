import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

export type LuaSemanticStatus = 'lua-symbol-conflict' | 'lua-registration-repeat' | 'lua-static-disjoint' | 'lua-unparsed'

export type LuaSemanticResult = {
  status: LuaSemanticStatus
  evidence: string[]
}

type LuaSource = { modId: string; filePath: string }
type Token = { kind: 'identifier' | 'string' | 'number' | 'symbol'; value: string; line: number }
type Registration = { key: string; digest: string }
type FileAnalysis = {
  modId: string
  complete: boolean
  errors: string[]
  requires: string[]
  eventHooks: string[]
  globalWrites: string[]
  registrations: Registration[]
  dynamicRegistrations: number
}

const MAX_LUA_BYTES = 8 * 1024 * 1024
const MAX_TOKENS = 300_000
const unique = (values: string[]): string[] => [...new Set(values)]
const digest = (tokens: Token[]): string => createHash('sha256').update(tokens.map((token) => `${token.kind}:${token.value}`).join('\u0000')).digest('hex')

const longBracketAt = (source: string, start: number): { openLength: number; close: string } | null => {
  if (source[start] !== '[') return null
  let cursor = start + 1
  while (source[cursor] === '=') cursor += 1
  if (source[cursor] !== '[') return null
  const equals = source.slice(start + 1, cursor)
  return { openLength: cursor - start + 1, close: `]${equals}]` }
}

const tokenize = (source: string): { tokens: Token[]; complete: boolean; errors: string[] } => {
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
    if (char === '-' && source[cursor + 1] === '-') {
      const long = longBracketAt(source, cursor + 2)
      if (long) {
        const contentStart = cursor + 2 + long.openLength
        const end = source.indexOf(long.close, contentStart)
        if (end < 0) {
          errors.push(`第 ${line} 行的长注释没有结束。`)
          break
        }
        line += (source.slice(cursor, end + long.close.length).match(/\n/g) ?? []).length
        cursor = end + long.close.length
      } else {
        const end = source.indexOf('\n', cursor + 2)
        cursor = end < 0 ? source.length : end
      }
      continue
    }
    const long = longBracketAt(source, cursor)
    if (long) {
      const contentStart = cursor + long.openLength
      const end = source.indexOf(long.close, contentStart)
      if (end < 0) {
        errors.push(`第 ${line} 行的长字符串没有结束。`)
        break
      }
      const value = source.slice(contentStart, end)
      push('string', value)
      line += (source.slice(cursor, end + long.close.length).match(/\n/g) ?? []).length
      cursor = end + long.close.length
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
          const escaped = source[cursor + 1]
          const decoded: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" }
          value += decoded[escaped] ?? escaped
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
    const identifier = source.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0]
    if (identifier) {
      push('identifier', identifier)
      cursor += identifier.length
      continue
    }
    const number = source.slice(cursor).match(/^(?:0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0]
    if (number) {
      push('number', number)
      cursor += number.length
      continue
    }
    const operator = ['...', '..', '==', '~=', '<=', '>=', '::', '//', '<<', '>>'].find((candidate) => source.startsWith(candidate, cursor))
    push('symbol', operator ?? char)
    cursor += operator?.length ?? 1
  }
  return { tokens, complete: errors.length === 0, errors }
}

const nameChainAt = (tokens: Token[], start: number): { name: string; end: number } | null => {
  if (tokens[start]?.kind !== 'identifier') return null
  const parts = [tokens[start].value]
  let cursor = start + 1
  while ((tokens[cursor]?.value === '.' || tokens[cursor]?.value === ':') && tokens[cursor + 1]?.kind === 'identifier') {
    parts.push(tokens[cursor].value, tokens[cursor + 1].value)
    cursor += 2
  }
  return { name: parts.join(''), end: cursor }
}

const argumentTokens = (tokens: Token[], openIndex: number): { args: Token[][]; end: number } | null => {
  if (tokens[openIndex]?.value !== '(') return null
  const args: Token[][] = [[]]
  let round = 1
  let brace = 0
  let square = 0
  for (let cursor = openIndex + 1; cursor < tokens.length; cursor += 1) {
    const value = tokens[cursor].value
    if (value === '(') round += 1
    else if (value === ')') {
      round -= 1
      if (round === 0) return { args, end: cursor + 1 }
    } else if (value === '{') brace += 1
    else if (value === '}') brace -= 1
    else if (value === '[') square += 1
    else if (value === ']') square -= 1
    if (value === ',' && round === 1 && brace === 0 && square === 0) args.push([])
    else args[args.length - 1].push(tokens[cursor])
  }
  return null
}

const tableAt = (tokens: Token[], openIndex: number): { tokens: Token[]; end: number; type: string | null } | null => {
  if (tokens[openIndex]?.value !== '{') return null
  let depth = 0
  let type: string | null = null
  for (let cursor = openIndex; cursor < tokens.length; cursor += 1) {
    if (tokens[cursor].value === '{') depth += 1
    if (depth === 1 && tokens[cursor]?.value === 'type' && tokens[cursor + 1]?.value === '=' && tokens[cursor + 2]?.kind === 'string') type ??= tokens[cursor + 2].value
    if (tokens[cursor].value === '}') {
      depth -= 1
      if (depth === 0) return { tokens: tokens.slice(openIndex, cursor + 1), end: cursor + 1, type }
    }
  }
  return null
}

export const analyzeLuaText = (source: string, modId = 'fixture'): FileAnalysis => {
  const lexical = tokenize(source.replace(/^\uFEFF/, ''))
  const tokens = lexical.tokens
  const requires: string[] = []
  const eventHooks: string[] = []
  const globalWrites: string[] = []
  const registrations: Registration[] = []
  const locals = new Set<string>()
  const localTables = new Map<string, { type: string; digest: string }>()
  let dynamicRegistrations = 0
  const braceDepthBefore: number[] = []
  let braceDepth = 0
  for (let index = 0; index < tokens.length; index += 1) {
    braceDepthBefore[index] = braceDepth
    if (tokens[index].value === '{') braceDepth += 1
    else if (tokens[index].value === '}') braceDepth = Math.max(0, braceDepth - 1)
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === 'local' && tokens[index + 1]?.value === 'function' && tokens[index + 2]?.kind === 'identifier') locals.add(tokens[index + 2].value)
    else if (tokens[index].value === 'local' && tokens[index + 1]?.kind === 'identifier') {
      locals.add(tokens[index + 1].value)
      if (tokens[index + 2]?.value === '=' && tokens[index + 3]?.value === '{') {
        const table = tableAt(tokens, index + 3)
        if (table?.type) localTables.set(tokens[index + 1].value, { type: table.type, digest: digest(table.tokens) })
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const chain = nameChainAt(tokens, index)
    if (!chain) continue
    const root = chain.name.split(/[.:]/)[0]
    const previous = tokens[index - 1]
    if (tokens[index - 1]?.value === 'function' && tokens[index - 2]?.value !== 'local' && !locals.has(root)) globalWrites.push(chain.name)
    if (braceDepthBefore[index] === 0 && tokens[chain.end]?.value === '=' && !locals.has(root) && previous?.value !== '.' && previous?.value !== ':' && previous?.value !== 'local') {
      const startsStatement = !previous || previous.line < tokens[index].line || [';', 'then', 'do', 'else', 'repeat'].includes(previous.value)
      const rhs = nameChainAt(tokens, chain.end + 1)
      const idempotentTableInit = rhs?.name === chain.name && tokens[rhs.end]?.value === 'or' && tokens[rhs.end + 1]?.value === '{'
      if (startsStatement && !idempotentTableInit) globalWrites.push(chain.name)
    }

    let callEnd = chain.end
    let callArgs: Token[][] | null = null
    if (tokens[callEnd]?.value === '(') {
      const parsed = argumentTokens(tokens, callEnd)
      if (parsed) callArgs = parsed.args
    } else if (tokens[callEnd]?.kind === 'string') callArgs = [[tokens[callEnd]]]
    if (!callArgs) continue

    if (chain.name === 'require' && callArgs[0]?.length === 1 && callArgs[0][0].kind === 'string') requires.push(callArgs[0][0].value)
    const eventMatch = chain.name.match(/^Events\.([A-Za-z0-9_]+)\.(Add|Remove)$/)
    if (eventMatch) {
      const callback = nameChainAt(callArgs[0] ?? [], 0)?.name ?? '<dynamic>'
      eventHooks.push(`${eventMatch[1]}.${eventMatch[2]}:${callback}`)
    }
    if (/\.register$/i.test(chain.name)) {
      if (callArgs[0]?.length === 1 && callArgs[0][0].kind === 'string') registrations.push({ key: `${chain.name}:${callArgs[0][0].value}`, digest: digest(callArgs.flat()) })
      else dynamicRegistrations += 1
    }
    if (chain.name === 'table.insert') {
      const registry = nameChainAt(callArgs[0] ?? [], 0)?.name
      const variable = callArgs[1]?.length === 1 && callArgs[1][0].kind === 'identifier' ? callArgs[1][0].value : null
      const table = variable ? localTables.get(variable) : null
      if (registry && table) registrations.push({ key: `${registry}:type=${table.type}`, digest: table.digest })
      else dynamicRegistrations += 1
    }
    index = Math.max(index, callEnd - 1)
  }

  return {
    modId,
    complete: lexical.complete,
    errors: lexical.errors,
    requires: unique(requires),
    eventHooks: unique(eventHooks),
    globalWrites: unique(globalWrites),
    registrations,
    dynamicRegistrations
  }
}

const readAndAnalyze = async (source: LuaSource): Promise<FileAnalysis> => {
  try {
    const stat = await fs.stat(source.filePath)
    if (stat.size > MAX_LUA_BYTES) return { modId: source.modId, complete: false, errors: [`文件超过 ${MAX_LUA_BYTES / 1024 / 1024} MiB 静态分析上限。`], requires: [], eventHooks: [], globalWrites: [], registrations: [], dynamicRegistrations: 0 }
    return analyzeLuaText(await fs.readFile(source.filePath, 'utf8'), source.modId)
  } catch (error) {
    return { modId: source.modId, complete: false, errors: [error instanceof Error ? error.message : String(error)], requires: [], eventHooks: [], globalWrites: [], registrations: [], dynamicRegistrations: 0 }
  }
}

export const analyzeLuaSemantics = async (sources: LuaSource[]): Promise<LuaSemanticResult> => {
  const analyses = await Promise.all(sources.map(readAndAnalyze))
  const evidence: string[] = []
  if (analyses.some((analysis) => !analysis.complete)) {
    for (const analysis of analyses.filter((entry) => !entry.complete)) evidence.push(`${analysis.modId}：${analysis.errors.join('；')}`)
    return { status: 'lua-unparsed', evidence: evidence.slice(0, 20) }
  }

  const writes = new Map<string, Set<string>>()
  const registrations = new Map<string, Array<{ modId: string; digest: string }>>()
  for (const analysis of analyses) {
    for (const symbol of analysis.globalWrites) {
      const owners = writes.get(symbol) ?? new Set<string>()
      owners.add(analysis.modId)
      writes.set(symbol, owners)
    }
    for (const registration of analysis.registrations) {
      const owners = registrations.get(registration.key) ?? []
      owners.push({ modId: analysis.modId, digest: registration.digest })
      registrations.set(registration.key, owners)
    }
  }
  const sharedWrites = [...writes].filter(([, owners]) => owners.size > 1)
  const repeatedRegistrations = [...registrations].filter(([, owners]) => new Set(owners.map((owner) => owner.modId)).size > 1)
  const divergentRegistrations = repeatedRegistrations.filter(([, owners]) => new Set(owners.map((owner) => owner.digest)).size > 1)
  for (const [symbol, owners] of sharedWrites.slice(0, 12)) evidence.push(`共同写入全局符号：${symbol} ← ${[...owners].join('、')}`)
  for (const [key, owners] of divergentRegistrations.slice(0, 12)) evidence.push(`同名注册内容不同：${key} ← ${unique(owners.map((owner) => owner.modId)).join('、')}`)
  if (sharedWrites.length || divergentRegistrations.length) return { status: 'lua-symbol-conflict', evidence }

  for (const [key, owners] of repeatedRegistrations.slice(0, 12)) evidence.push(`重复注册相同内容：${key} ← ${unique(owners.map((owner) => owner.modId)).join('、')}`)
  const dynamic = analyses.reduce((sum, analysis) => sum + analysis.dynamicRegistrations, 0)
  const summary = `静态读取 ${analyses.length} 个文件：require ${analyses.reduce((sum, analysis) => sum + analysis.requires.length, 0)} 项、事件挂接 ${analyses.reduce((sum, analysis) => sum + analysis.eventHooks.length, 0)} 项、可定位注册 ${analyses.reduce((sum, analysis) => sum + analysis.registrations.length, 0)} 项${dynamic ? `、动态注册 ${dynamic} 项` : ''}。`
  evidence.unshift(summary)
  if (repeatedRegistrations.length) return { status: 'lua-registration-repeat', evidence }
  evidence.push('未发现多个 MOD 共同写入同一全局符号或同名静态注册；动态路径仍需运行验证。')
  return { status: 'lua-static-disjoint', evidence }
}
