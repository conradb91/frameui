import type { PageStructureItem } from '@shared/types/pageStructure'

const MAX_NODES = 500
const MAX_DEPTH = 30
const MAX_TEXT_PREVIEW = 60

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])
const NON_VISUAL_ELEMENTS = new Set(['script', 'style', 'link', 'meta', 'title', 'svelte:head'])

interface MutableMarkupNode {
  tagName: string
  children: MutableMarkupNode[]
  text: string
  sourceLine?: number
  attributes?: Record<string, string>
}

function includeLabel(reference: string): string {
  const normalized = reference.replace(/\\/g, '/').replace(/\.(?:blade\.php|php|phtml|html?|twig|ejs|hbs|handlebars|mustache|njk|nunjucks|pug|jade|vue|svelte|astro|erb|liquid|eta|tpl|latte)$/i, '')
  const last = normalized.split(/[/.]/).filter(Boolean).pop() ?? normalized
  return last
    .replace(/^_+/, '')
    .replace(/[-_]+(.)/g, (_, char: string) => char.toUpperCase())
    .replace(/^./, (char) => char.toUpperCase())
}

function includeReferences(value: string): string[] {
  const references: string[] = []
  const patterns = [
    /@(?:include|includeIf|includeWhen|includeUnless|component)\s*\(\s*['"]([^'"]+)['"]/gi,
    /\b(?:view|include|include_once|require|require_once)\s*\(?\s*['"]([^'"]+)['"]/gi,
    /\{%\s*(?:include|embed|extends)\s+['"]([^'"]+)['"]/gi,
    /\binclude\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,
    /\{\{>\s*([\w./-]+)/g,
  ]
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) references.push(match[1])
  }
  return [...new Set(references)]
}

function appendSourceText(node: MutableMarkupNode, value: string): void {
  node.text += value
  for (const reference of includeReferences(value)) {
    node.children.push({ tagName: includeLabel(reference), children: [], text: '' })
  }
}

function cleanText(value: string): string {
  return value
    .replace(/<\?(?:php|=)?[\s\S]*?\?>/gi, ' ')
    .replace(/<%[\s\S]*?%>/g, ' ')
    .replace(/\{[%{#][\s\S]*?[}%#]\}/g, ' ')
    .replace(/\{!![\s\S]*?!!\}/g, ' ')
    .replace(/@[A-Za-z]+(?:\s*\([^)]*\))?/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function componentKey(name: string): string {
  return name.replace(/^(?:x-|x:|svelte:)/i, '').replace(/[-_.:]/g, '').toLowerCase()
}

function toItems(nodes: MutableMarkupNode[], knownComponentNames: Set<string>): PageStructureItem[] {
  const knownKeys = new Set([...knownComponentNames].map(componentKey))
  let count = 0

  function convert(node: MutableMarkupNode, depth: number): PageStructureItem | null {
    if (count >= MAX_NODES || depth > MAX_DEPTH) return null
    count++
    const children = node.children.map((child) => convert(child, depth + 1)).filter((item): item is PageStructureItem => item !== null)
    const text = children.length === 0 ? cleanText(node.text) : ''
    return {
      tagName: node.tagName,
      isKnownComponent: knownKeys.has(componentKey(node.tagName)),
      children,
      sourceLine: node.sourceLine,
      attributes: node.attributes,
      textPreview: text ? (text.length > MAX_TEXT_PREVIEW ? `${text.slice(0, MAX_TEXT_PREVIEW)}…` : text) : undefined,
    }
  }

  return nodes.map((node) => convert(node, 1)).filter((item): item is PageStructureItem => item !== null)
}

function findTagEnd(content: string, start: number): number {
  let quote: '"' | "'" | null = null
  for (let i = start; i < content.length; i++) {
    const char = content[i]
    if (quote) {
      if (char === quote && content[i - 1] !== '\\') quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return i
    }
  }
  return -1
}

function stripFrontmatter(content: string, fileName: string): string {
  if (!fileName.toLowerCase().endsWith('.astro') || !content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  return end === -1 ? content : content.slice(end + 4)
}

function attributesOf(rawTag: string): Record<string, string> | undefined {
  const attributes: Record<string, string> = {}
  const pattern = /([:@A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of rawTag.matchAll(pattern)) {
    const name = match[1]
    if (!['id', 'class', 'className', 'role', 'type', 'name', 'aria-label', 'href', 'to', 'action', 'src', 'alt'].includes(name)) continue
    attributes[name] = match[2] ?? match[3] ?? ''
  }
  return Object.keys(attributes).length > 0 ? attributes : undefined
}

/** Pug attributes come from two places on the same line — leading
 * `.class`/`#id` shorthand (`div.card.featured#hero`) and an optional
 * parenthesized attribute list (`div(class="card" data-id='5')`) — merged
 * into one `attributes` object the same shape every other extractor
 * produces, so `resolveClassName`/the inspector don't need Pug-specific
 * handling downstream. */
function pugAttributesOf(shorthand: string, parenContent: string | null): Record<string, string> | undefined {
  const attributes: Record<string, string> = {}
  const classes: string[] = []
  for (const match of shorthand.matchAll(/([.#])([\w-]+)/g)) {
    if (match[1] === '.') classes.push(match[2])
    else attributes.id = match[2]
  }
  if (classes.length > 0) attributes.class = classes.join(' ')

  if (parenContent) {
    const quoted = attributesOf(parenContent)
    if (quoted) Object.assign(attributes, quoted)
    // Bare boolean-style attributes (`disabled`, `checked`) carry no `=` —
    // attributesOf's quoted-value pattern skips them, so pick them up
    // separately rather than losing them entirely.
    for (const match of parenContent.matchAll(/(?:^|[\s,(])([:@A-Za-z_][\w:.-]*)(?=\s*[,)]|\s*$)/g)) {
      const name = match[1]
      if (!['id', 'class', 'role', 'disabled', 'checked', 'required', 'readonly'].includes(name)) continue
      if (!(name in attributes)) attributes[name] = ''
    }
  }
  return Object.keys(attributes).length > 0 ? attributes : undefined
}

function sourceLineAt(newlineOffsets: number[], index: number): number {
  let low = 0
  let high = newlineOffsets.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (newlineOffsets[middle] < index) low = middle + 1
    else high = middle
  }
  return low + 1
}

/**
 * Safe, best-effort parsing for HTML and HTML-shaped templates. This never
 * executes PHP or template expressions. It understands ordinary HTML plus
 * PHP/PHTML, Blade, Twig, EJS, Handlebars, Nunjucks, Vue, Svelte and Astro
 * source well enough to retain the real visible element hierarchy.
 */
export function extractMarkupStructure(content: string, fileName: string, knownComponentNames: Set<string>): PageStructureItem[] {
  const source = stripFrontmatter(content, fileName)
  const root: MutableMarkupNode = { tagName: '__root__', children: [], text: '' }
  const newlineOffsets = [...source.matchAll(/\n/g)].map((match) => match.index ?? 0)
  const stack: MutableMarkupNode[] = [root]
  let cursor = 0

  while (cursor < source.length && root.children.length < MAX_NODES) {
    const open = source.indexOf('<', cursor)
    if (open === -1) {
      appendSourceText(stack[stack.length - 1], source.slice(cursor))
      break
    }
    appendSourceText(stack[stack.length - 1], source.slice(cursor, open))

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4)
      cursor = end === -1 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open + 2)
      appendSourceText(stack[stack.length - 1], source.slice(open, end === -1 ? source.length : end + 2))
      cursor = end === -1 ? source.length : end + 2
      continue
    }
    if (source.startsWith('<%', open)) {
      const end = source.indexOf('%>', open + 2)
      appendSourceText(stack[stack.length - 1], source.slice(open, end === -1 ? source.length : end + 2))
      cursor = end === -1 ? source.length : end + 2
      continue
    }

    const end = findTagEnd(source, open + 1)
    if (end === -1) break
    const raw = source.slice(open + 1, end).trim()
    cursor = end + 1
    if (!raw || raw.startsWith('!')) continue

    const closing = raw.startsWith('/')
    const match = /^\/?\s*([A-Za-z][\w:.-]*)/.exec(raw)
    if (!match) continue
    const tagName = match[1]
    const normalized = tagName.toLowerCase()

    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === normalized) {
          stack.length = i
          break
        }
      }
      continue
    }

    if (NON_VISUAL_ELEMENTS.has(normalized)) {
      if (!raw.endsWith('/>') && !VOID_ELEMENTS.has(normalized)) {
        const closePattern = new RegExp(`</\\s*${normalized}\\s*>`, 'i')
        const remainder = source.slice(cursor)
        const closeMatch = closePattern.exec(remainder)
        cursor = closeMatch ? cursor + closeMatch.index + closeMatch[0].length : source.length
      }
      continue
    }

    const node: MutableMarkupNode = { tagName, children: [], text: '', sourceLine: sourceLineAt(newlineOffsets, open), attributes: attributesOf(raw) }
    stack[stack.length - 1].children.push(node)
    if (!raw.endsWith('/') && !VOID_ELEMENTS.has(normalized)) stack.push(node)
  }

  let visibleRoots = root.children
  const templateRoot = visibleRoots.find((node) => node.tagName.toLowerCase() === 'template')
  if (templateRoot && /\.(vue|svelte)$/i.test(fileName)) visibleRoots = templateRoot.children
  const htmlRoot = visibleRoots.find((node) => node.tagName.toLowerCase() === 'html')
  const bodyRoot = htmlRoot?.children.find((node) => node.tagName.toLowerCase() === 'body')
  if (bodyRoot) visibleRoots = bodyRoot.children

  return toItems(visibleRoots, knownComponentNames)
}

/** Small indentation-aware fallback for the Pug/Jade templates commonly
 * used by Express applications. Dynamic code is skipped, never evaluated. */
export function extractPugStructure(content: string, knownComponentNames: Set<string>): PageStructureItem[] {
  const root: MutableMarkupNode = { tagName: '__root__', children: [], text: '' }
  const stack: { indent: number; node: MutableMarkupNode }[] = [{ indent: -1, node: root }]

  let currentLine = 0
  for (const rawLine of content.split(/\r?\n/)) {
    currentLine++
    if (!rawLine.trim() || /^\s*(?:-|=|doctype\b|\/\/)/.test(rawLine)) continue
    const indent = rawLine.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0
    const line = rawLine.trim()
    const match = /^([A-Za-z][\w:-]*|[.#][\w-]+)/.exec(line)
    if (!match) continue
    const token = match[1]
    const tagName = token.startsWith('.') || token.startsWith('#') ? 'div' : token
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()

    // Shorthand classes/ids trail the tag name (`div.card#hero`, or lead it
    // entirely for `.card`/`#hero` with an implicit div) — capture before
    // stripping, and capture the parenthesized attribute list before it's
    // discarded too, so both feed `pugAttributesOf` instead of being thrown away.
    const afterTag = line.slice(match[0].length)
    const shorthandMatch = /^(?:[.#][\w-]+)+/.exec(afterTag)
    const shorthand = (token.startsWith('.') || token.startsWith('#') ? token : '') + (shorthandMatch?.[0] ?? '')
    const afterShorthand = afterTag.slice(shorthandMatch?.[0].length ?? 0)
    const parenMatch = /^\(([^)]*)\)/.exec(afterShorthand)

    const node: MutableMarkupNode = {
      tagName,
      children: [],
      text: '',
      sourceLine: currentLine,
      attributes: pugAttributesOf(shorthand, parenMatch?.[1] ?? null),
    }
    const rest = afterShorthand.replace(/^\([^)]*\)/, '').trim()
    node.text = rest.replace(/^\|\s*/, '')
    stack[stack.length - 1].node.children.push(node)
    stack.push({ indent, node })
  }

  return toItems(root.children, knownComponentNames)
}
