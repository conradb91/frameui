import type { Token, TokenCategory } from '@shared/types/model/projectModel'

export interface ResolvedClassValue {
  className: string
  properties: string[]
  value: string | null
  tokenId: string | null
}

interface PrefixEntry {
  prefix: string
  properties: string[]
  category: TokenCategory
}

const SPACING_PREFIXES: PrefixEntry[] = [
  { prefix: 'p-', properties: ['padding'], category: 'spacing' },
  { prefix: 'px-', properties: ['padding-left', 'padding-right'], category: 'spacing' },
  { prefix: 'py-', properties: ['padding-top', 'padding-bottom'], category: 'spacing' },
  { prefix: 'pt-', properties: ['padding-top'], category: 'spacing' },
  { prefix: 'pr-', properties: ['padding-right'], category: 'spacing' },
  { prefix: 'pb-', properties: ['padding-bottom'], category: 'spacing' },
  { prefix: 'pl-', properties: ['padding-left'], category: 'spacing' },
  { prefix: 'm-', properties: ['margin'], category: 'spacing' },
  { prefix: 'mx-', properties: ['margin-left', 'margin-right'], category: 'spacing' },
  { prefix: 'my-', properties: ['margin-top', 'margin-bottom'], category: 'spacing' },
  { prefix: 'mt-', properties: ['margin-top'], category: 'spacing' },
  { prefix: 'mr-', properties: ['margin-right'], category: 'spacing' },
  { prefix: 'mb-', properties: ['margin-bottom'], category: 'spacing' },
  { prefix: 'ml-', properties: ['margin-left'], category: 'spacing' },
  { prefix: 'gap-', properties: ['gap'], category: 'spacing' },
  { prefix: 'gap-x-', properties: ['column-gap'], category: 'spacing' },
  { prefix: 'gap-y-', properties: ['row-gap'], category: 'spacing' },
  { prefix: 'w-', properties: ['width'], category: 'spacing' },
  { prefix: 'h-', properties: ['height'], category: 'spacing' },
]

const RADIUS_PREFIXES: PrefixEntry[] = [{ prefix: 'rounded-', properties: ['border-radius'], category: 'radius' }]

// `text-` is Tailwind's most overloaded prefix (color, font-size, alignment all share it).
// Restricting the properties to `color` only matters together with the resolution rule below:
// a `text-` utility is only ever emitted when its suffix actually matches a color token.
const COLOR_PREFIXES: PrefixEntry[] = [
  { prefix: 'bg-', properties: ['background-color'], category: 'color' },
  { prefix: 'text-', properties: ['color'], category: 'color' },
]

// Longest-prefix-first so e.g. `gap-x-`/`gap-y-` are tried before `gap-`, `px-`/`pt-`/etc
// before `p-` — otherwise the more specific prefix's suffix would be parsed as belonging
// to the shorter one (e.g. "gap-x-4" read as `gap-` + suffix "x-4").
const PREFIX_TABLE: PrefixEntry[] = [...SPACING_PREFIXES, ...RADIUS_PREFIXES, ...COLOR_PREFIXES].sort(
  (a, b) => b.prefix.length - a.prefix.length,
)

const RADIUS_DEFAULT_SUFFIX = 'DEFAULT'

function buildTokenIndex(tokens: Token[]): Map<TokenCategory, Map<string, Token>> {
  const index = new Map<TokenCategory, Map<string, Token>>()
  for (const token of tokens) {
    let byName = index.get(token.category)
    if (!byName) {
      byName = new Map()
      index.set(token.category, byName)
    }
    byName.set(token.name, token)
  }
  return index
}

function resolveUtility(utility: string, tokenIndex: Map<TokenCategory, Map<string, Token>>): ResolvedClassValue | null {
  // Bare `rounded` (no dash, no suffix) is Tailwind's radius shorthand for the scale's
  // DEFAULT entry — it isn't a prefix match like the rest of the table.
  if (utility === 'rounded') {
    const token = tokenIndex.get('radius')?.get(RADIUS_DEFAULT_SUFFIX)
    return token ? { className: utility, properties: ['border-radius'], value: token.value, tokenId: token.id } : null
  }

  for (const entry of PREFIX_TABLE) {
    if (!utility.startsWith(entry.prefix) || utility.length === entry.prefix.length) continue
    const suffix = utility.slice(entry.prefix.length)
    const token = tokenIndex.get(entry.category)?.get(suffix)
    if (!token) return null
    return { className: utility, properties: entry.properties, value: token.value, tokenId: token.id }
  }

  return null
}

/**
 * Resolves the utilities in a raw `class`/`className` string against the project's already-
 * resolved Tailwind token list. Only returns utilities it can confirm: no prefix match, no
 * matching token, or an out-of-scope form (arbitrary values, variants, negatives, fractions,
 * directional radius corners, non-color `text-*`) all mean that utility is silently omitted
 * rather than guessed at.
 */
export function resolveClassName(className: string, tokens: Token[]): ResolvedClassValue[] {
  const tokenIndex = buildTokenIndex(tokens)
  const results: ResolvedClassValue[] = []
  for (const utility of className.split(/\s+/).filter(Boolean)) {
    const resolved = resolveUtility(utility, tokenIndex)
    if (resolved) results.push(resolved)
  }
  return results
}
