import { Engine } from 'php-parser'
import type { Program } from 'php-parser'

const engine = new Engine({ parser: { extractDoc: false }, ast: { withPositions: false } })

/** Never throws past this boundary — same "no fabrication" contract as the
 * Tailwind/CSS adapters' `postcss.parse` try/catch: a file that can't be
 * parsed is skipped, never guessed at. */
export function parsePhp(content: string, filename: string): Program | null {
  try {
    return engine.parseCode(content, filename)
  } catch {
    return null
  }
}

/** php-parser's own types describe each node's *declared* shape well
 * enough to design against, but every node is actually `{kind: string,
 * ...}` at runtime — these helpers walk that generically rather than
 * importing every specific node class, since callers here only ever need
 * a handful of fields off a handful of kinds. */
export interface PhpNode {
  kind: string
  [key: string]: unknown
}

export function isPhpNode(value: unknown): value is PhpNode {
  return !!value && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string'
}

/** A `Declaration.name` (class/method/function name) is an `Identifier`
 * node in practice, but the library's own types allow a plain string too —
 * this normalizes either to the name string. */
export function phpNodeName(name: unknown): string | null {
  if (typeof name === 'string') return name
  if (isPhpNode(name) && typeof name.name === 'string') return name.name
  return null
}

export function phpStringValue(node: unknown): string | null {
  return isPhpNode(node) && node.kind === 'string' && typeof node.value === 'string' ? node.value : null
}

/** Depth-first search for the first node matching `predicate`, anywhere in
 * the tree — used instead of enumerating every PHP statement kind that
 * could wrap a class declaration (namespace, block, ...) or a `view()`
 * call (return, echo, ternary, ...). */
export function findPhpNode(node: unknown, predicate: (node: PhpNode) => boolean): PhpNode | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findPhpNode(item, predicate)
      if (found) return found
    }
    return null
  }
  if (!isPhpNode(node)) return null
  if (predicate(node)) return node
  for (const key of Object.keys(node)) {
    if (key === 'kind') continue
    const found = findPhpNode(node[key], predicate)
    if (found) return found
  }
  return null
}
