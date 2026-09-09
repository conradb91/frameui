import { parse } from '@vue/compiler-sfc'
import { NodeTypes } from '@vue/compiler-core'
import type { PageStructureItem } from '@shared/types/pageStructure'

const MAX_NODES = 500
const MAX_DEPTH = 30
const MAX_TEXT_PREVIEW = 60

function componentKey(name: string): string {
  return name.replace(/^(?:x-|x:|svelte:)/i, '').replace(/[-_.:]/g, '').toLowerCase()
}

interface VueAstNode {
  type: number
  [key: string]: unknown
}

function isVueAstNode(value: unknown): value is VueAstNode {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'number'
}

/** Reads the raw text of a `SimpleExpressionNode`/`TextNode` — never
 * evaluated, just the source text of a binding/handler/condition. */
function exprText(node: unknown): string | undefined {
  return isVueAstNode(node) && typeof node.content === 'string' ? node.content : undefined
}

/** Attribute names a plain HTML/markup file would already expose — kept
 * identical to `extractMarkupStructure.ts`'s allowlist for parity. */
const STATIC_ATTR_ALLOWLIST = new Set(['id', 'class', 'className', 'role', 'type', 'name', 'aria-label', 'href', 'to', 'action', 'src', 'alt'])
/** Bound (`v-bind:x` / `:x`) attribute names worth surfacing — a Vue-specific
 * addition (notably `src`/`alt`, not in the static allowlist above, since a
 * dynamically-bound image source is extremely common and otherwise
 * completely invisible). */
const BOUND_ATTR_ALLOWLIST = new Set(['href', 'to', 'action', 'src', 'alt'])

/**
 * Every Vue directive — `v-bind`/`:`, `v-on`/`@`, `v-model`, `v-if`/
 * `v-else-if`/`v-else`, `v-for` — stays a plain entry in the owning
 * element's own `props` at the parse stage (confirmed empirically: the
 * `IfNode`/`ForNode` wrapper types compiler-core's own type definitions
 * describe are a later transform-phase concept, not present in
 * `descriptor.template.ast` from a bare `parse()`), so one flat pass over
 * `props` covers all of them — no separate branch-walking needed.
 */
function elementAttributes(props: unknown): Record<string, string> | undefined {
  if (!Array.isArray(props)) return undefined
  const attrs: Record<string, string> = {}

  for (const prop of props) {
    if (!isVueAstNode(prop)) continue

    if (prop.type === NodeTypes.ATTRIBUTE && typeof prop.name === 'string' && STATIC_ATTR_ALLOWLIST.has(prop.name)) {
      attrs[prop.name] = exprText(prop.value) ?? ''
      continue
    }
    if (prop.type !== NodeTypes.DIRECTIVE || typeof prop.name !== 'string') continue

    const argName = exprText(prop.arg)
    if (prop.name === 'bind' && argName && BOUND_ATTR_ALLOWLIST.has(argName)) {
      attrs[`:${argName}`] = exprText(prop.exp) ?? ''
    } else if (prop.name === 'on' && argName) {
      attrs[`@${argName}`] = exprText(prop.exp) ?? ''
    } else if (prop.name === 'model') {
      attrs['v-model'] = exprText(prop.exp) ?? ''
    } else if (prop.name === 'if' || prop.name === 'else-if') {
      attrs[prop.name === 'if' ? 'v-if' : 'v-else-if'] = exprText(prop.exp) ?? ''
    } else if (prop.name === 'else') {
      attrs['v-else'] = ''
    } else if (prop.name === 'for') {
      attrs['v-for'] = exprText(prop.exp) ?? ''
    }
  }

  return Object.keys(attrs).length > 0 ? attrs : undefined
}

/** Static text only — an `{{ interpolation }}` never contributes to a
 * preview, matching `extractMarkupStructure.ts`'s `cleanText()` stripping
 * template expressions rather than showing their raw source as if it were
 * content. */
function textPreviewOf(children: unknown): string {
  if (!Array.isArray(children)) return ''
  let text = ''
  for (const child of children) {
    if (isVueAstNode(child) && child.type === NodeTypes.TEXT && typeof child.content === 'string') text += child.content
  }
  return text.replace(/\s+/g, ' ').trim()
}

function convertChildren(children: unknown, knownKeys: Set<string>, depth: number, counter: { n: number }): PageStructureItem[] {
  if (!Array.isArray(children) || depth > MAX_DEPTH) return []
  const items: PageStructureItem[] = []

  for (const child of children) {
    if (counter.n >= MAX_NODES) break
    if (!isVueAstNode(child) || child.type !== NodeTypes.ELEMENT || typeof child.tag !== 'string') continue
    counter.n++

    const kids = convertChildren(child.children, knownKeys, depth + 1, counter)
    const loc = child.loc as { start?: { line?: number } } | undefined
    const text = kids.length === 0 ? textPreviewOf(child.children) : ''

    items.push({
      tagName: child.tag,
      isKnownComponent: knownKeys.has(componentKey(child.tag)),
      children: kids,
      sourceLine: loc?.start?.line,
      attributes: elementAttributes(child.props),
      textPreview: text ? (text.length > MAX_TEXT_PREVIEW ? `${text.slice(0, MAX_TEXT_PREVIEW)}…` : text) : undefined,
    })
  }

  return items
}

/**
 * Real `<template>` AST parsing for `.vue` files (Design Model spec §2), in
 * place of routing them through the generic HTML-shaped tag scanner in
 * `extractMarkupStructure.ts`. That scanner has no concept of Vue
 * directives at all — `:src`, `@click`, `v-model`, `v-if`/`v-for` are all
 * silently invisible — which this fixes while keeping the exact same
 * output contract (`PageStructureItem[]`) so nothing downstream changes.
 */
export function extractVueStructure(content: string, filePath: string, knownComponentNames: Set<string>): PageStructureItem[] {
  let ast: unknown
  try {
    ast = parse(content, { filename: filePath }).descriptor.template?.ast
  } catch {
    return []
  }
  if (!isVueAstNode(ast)) return []

  const knownKeys = new Set([...knownComponentNames].map(componentKey))
  return convertChildren(ast.children, knownKeys, 1, { n: 0 })
}
