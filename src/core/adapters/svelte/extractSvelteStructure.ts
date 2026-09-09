import { parse } from 'svelte/compiler'
import type { PageStructureItem } from '@shared/types/pageStructure'

const MAX_NODES = 500
const MAX_DEPTH = 30
const MAX_TEXT_PREVIEW = 60

function componentKey(name: string): string {
  return name.replace(/^(?:x-|x:|svelte:)/i, '').replace(/[-_.:]/g, '').toLowerCase()
}

interface SvelteAstNode {
  type: string
  start?: number
  end?: number
  [key: string]: unknown
}

function isSvelteNode(value: unknown): value is SvelteAstNode {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
}

const ELEMENT_TYPES = new Set([
  'RegularElement', 'Component', 'TitleElement', 'SlotElement',
  'SvelteBody', 'SvelteBoundary', 'SvelteComponent', 'SvelteDocument',
  'SvelteElement', 'SvelteFragment', 'SvelteHead', 'SvelteSelf', 'SvelteWindow',
])

/** Raw source text of an expression/condition — never evaluated, just
 * sliced by the node's own character offsets (every node carries `.start`/
 * `.end` into the whole file's source, confirmed empirically; simpler here
 * than the PHP/Vue slices since there's no need to reconstruct text from an
 * estree AST). */
function sliceText(content: string, node: unknown): string | undefined {
  return isSvelteNode(node) && typeof node.start === 'number' && typeof node.end === 'number'
    ? content.slice(node.start, node.end)
    : undefined
}

const STATIC_ATTR_ALLOWLIST = new Set(['id', 'class', 'className', 'role', 'type', 'name', 'aria-label', 'href', 'to', 'action', 'src', 'alt'])
const BOUND_ATTR_ALLOWLIST = new Set(['href', 'to', 'action', 'src', 'alt'])

function staticAttributeText(value: unknown): string | undefined {
  if (value === true) return ''
  if (Array.isArray(value) && value.every((part) => isSvelteNode(part) && part.type === 'Text')) {
    return value.map((part) => (isSvelteNode(part) ? String(part.data ?? '') : '')).join('')
  }
  return undefined
}

function hasExpressionTag(value: unknown): boolean {
  if (isSvelteNode(value) && value.type === 'ExpressionTag') return true
  return Array.isArray(value) && value.some((part) => isSvelteNode(part) && part.type === 'ExpressionTag')
}

function attributeExpressionText(content: string, value: unknown): string {
  if (isSvelteNode(value) && value.type === 'ExpressionTag') return sliceText(content, value.expression) ?? ''
  if (Array.isArray(value)) {
    return value
      .map((part) => (isSvelteNode(part) && part.type === 'ExpressionTag' ? (sliceText(content, part.expression) ?? '') : isSvelteNode(part) ? String(part.data ?? '') : ''))
      .join('')
  }
  return ''
}

/**
 * Every Svelte directive/binding lives in the element's own `.attributes`
 * array (`on:x`, `bind:x`, and a plain `x={y}` binding all show up there
 * alongside static attributes) — one flat pass covers all of them.
 */
function elementAttributes(content: string, attributes: unknown): Record<string, string> | undefined {
  if (!Array.isArray(attributes)) return undefined
  const attrs: Record<string, string> = {}

  for (const attr of attributes) {
    if (!isSvelteNode(attr) || typeof attr.name !== 'string') continue

    if (attr.type === 'Attribute') {
      const staticText = staticAttributeText(attr.value)
      if (staticText !== undefined && STATIC_ATTR_ALLOWLIST.has(attr.name)) {
        attrs[attr.name] = staticText
      } else if (BOUND_ATTR_ALLOWLIST.has(attr.name) && hasExpressionTag(attr.value)) {
        attrs[`:${attr.name}`] = attributeExpressionText(content, attr.value)
      }
      continue
    }
    if (attr.type === 'OnDirective') {
      attrs[`@${attr.name}`] = sliceText(content, attr.expression) ?? ''
    } else if (attr.type === 'BindDirective') {
      attrs[`bind:${attr.name}`] = sliceText(content, attr.expression) ?? ''
    }
  }

  return Object.keys(attrs).length > 0 ? attrs : undefined
}

function textPreviewOf(nodes: unknown): string {
  if (!Array.isArray(nodes)) return ''
  let text = ''
  for (const node of nodes) {
    if (isSvelteNode(node) && node.type === 'Text' && typeof node.data === 'string') text += node.data
  }
  return text.replace(/\s+/g, ' ').trim()
}

function convertNodes(nodes: unknown, knownKeys: Set<string>, depth: number, counter: { n: number }, content: string, note?: Record<string, string>): PageStructureItem[] {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return []
  const items: PageStructureItem[] = []

  for (const node of nodes) {
    if (counter.n >= MAX_NODES) break
    if (!isSvelteNode(node)) continue

    if (ELEMENT_TYPES.has(node.type) && typeof node.name === 'string') {
      counter.n++
      const kids = convertNodes((node.fragment as { nodes?: unknown } | undefined)?.nodes, knownKeys, depth + 1, counter, content)
      const text = kids.length === 0 ? textPreviewOf((node.fragment as { nodes?: unknown } | undefined)?.nodes) : ''
      const nameLoc = node.name_loc as { start?: { line?: number } } | undefined
      const attrs = { ...(elementAttributes(content, node.attributes) ?? {}), ...(note ?? {}) }
      items.push({
        tagName: node.name,
        isKnownComponent: knownKeys.has(componentKey(node.name)),
        children: kids,
        sourceLine: nameLoc?.start?.line,
        attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
        textPreview: text ? (text.length > MAX_TEXT_PREVIEW ? `${text.slice(0, MAX_TEXT_PREVIEW)}…` : text) : undefined,
      })
      continue
    }

    if (node.type === 'IfBlock') {
      const label = node.elseif ? '#else if' : '#if'
      const condition = sliceText(content, node.test) ?? ''
      items.push(...convertNodes((node.consequent as { nodes?: unknown } | undefined)?.nodes, knownKeys, depth, counter, content, { [label]: condition }))
      if (node.alternate) {
        // A plain `{:else}` is a Fragment of content directly; a chained
        // `{:else if}` is a Fragment containing one more IfBlock, which
        // this same branch handles again on the next call — arbitrary
        // chain length falls out of the recursion for free.
        const alternateNodes = (node.alternate as { nodes?: unknown }).nodes
        const isChainedElseIf = Array.isArray(alternateNodes) && alternateNodes.some((n) => isSvelteNode(n) && n.type === 'IfBlock')
        items.push(...convertNodes(alternateNodes, knownKeys, depth, counter, content, isChainedElseIf ? undefined : { '#else': '' }))
      }
      continue
    }

    if (node.type === 'EachBlock') {
      const source = sliceText(content, node.expression) ?? ''
      const contextText = sliceText(content, node.context)
      items.push(...convertNodes((node.body as { nodes?: unknown } | undefined)?.nodes, knownKeys, depth, counter, content, { '#each': contextText ? `${contextText} in ${source}` : source }))
      continue
    }

    if (node.type === 'KeyBlock') {
      items.push(...convertNodes((node.fragment as { nodes?: unknown } | undefined)?.nodes, knownKeys, depth, counter, content))
      continue
    }
    if (node.type === 'SnippetBlock') {
      items.push(...convertNodes((node.body as { nodes?: unknown } | undefined)?.nodes, knownKeys, depth, counter, content))
      continue
    }
    // AwaitBlock, Text, Tag (ExpressionTag/HtmlTag/ConstTag/...), Comment:
    // not structural items — see plan's explicitly-out-of-scope notes.
  }

  return items
}

/**
 * Real `<script>`/template AST parsing for `.svelte` files (Design Model
 * spec §2), replacing the generic HTML-shaped tag scanner in
 * `extractMarkupStructure.ts` for this extension. That scanner has no model
 * for Svelte's `on:`/`bind:` directives or `{#if}`/`{#each}` blocks at all
 * — this fixes both while keeping the same `PageStructureItem[]` contract.
 */
export function extractSvelteStructure(content: string, filePath: string, knownComponentNames: Set<string>): PageStructureItem[] {
  let root: unknown
  try {
    root = parse(content, { filename: filePath, modern: true })
  } catch {
    return []
  }
  if (!isSvelteNode(root)) return []
  const fragment = root.fragment as { nodes?: unknown } | undefined

  const knownKeys = new Set([...knownComponentNames].map(componentKey))
  return convertNodes(fragment?.nodes, knownKeys, 1, { n: 0 }, content)
}
