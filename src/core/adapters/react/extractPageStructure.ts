import { Project, ScriptKind, SyntaxKind, Node } from 'ts-morph'
import type { PageStructureItem } from '@shared/types/pageStructure'

export type { PageStructureItem }

// spec's own design-tree performance target ("remain usable with at least
// 500 editable nodes on one screen") doubles as our safety cap here — once
// a page's real structure would exceed it, we stop rather than let one
// pathological file make indexing hang or the resulting draft unusable.
const MAX_NODES = 500
const MAX_DEPTH = 30
const MAX_TEXT_PREVIEW = 60

function scriptKindFor(ext: string): ScriptKind {
  if (ext === '.tsx') return ScriptKind.TSX
  if (ext === '.jsx') return ScriptKind.JSX
  if (ext === '.ts') return ScriptKind.TS
  return ScriptKind.JS
}

function isJsxNode(node: Node): boolean {
  return (
    node.getKind() === SyntaxKind.JsxElement ||
    node.getKind() === SyntaxKind.JsxSelfClosingElement ||
    node.getKind() === SyntaxKind.JsxFragment
  )
}

function tagNameOf(node: Node): string | null {
  if (Node.isJsxElement(node)) return node.getOpeningElement().getTagNameNode().getText()
  if (Node.isJsxSelfClosingElement(node)) return node.getTagNameNode().getText()
  if (Node.isJsxFragment(node)) return 'Fragment'
  return null
}

function directJsxChildren(node: Node): Node[] {
  if (Node.isJsxElement(node)) return node.getJsxChildren().filter(isJsxNode)
  if (Node.isJsxFragment(node)) return node.getJsxChildren().filter(isJsxNode)
  return []
}

function staticAttributesOf(node: Node): Record<string, string> | undefined {
  const opening = Node.isJsxElement(node) ? node.getOpeningElement() : Node.isJsxSelfClosingElement(node) ? node : null
  if (!opening) return undefined
  const result: Record<string, string> = {}
  for (const attribute of opening.getAttributes()) {
    if (!Node.isJsxAttribute(attribute)) continue
    const name = attribute.getNameNode().getText()
    if (!['id', 'class', 'className', 'role', 'type', 'name', 'aria-label', 'href', 'to', 'action', 'src', 'alt'].includes(name)) continue
    const initializer = attribute.getInitializer()
    if (!initializer) {
      result[name] = 'true'
    } else if (Node.isStringLiteral(initializer)) {
      result[name] = initializer.getLiteralText()
    } else if (Node.isJsxExpression(initializer)) {
      const expression = initializer.getExpression()
      if (expression && Node.isStringLiteral(expression)) result[name] = expression.getLiteralText()
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** A short, display-only text preview when an element's children are just
 * static text (JsxText, or a JsxExpression wrapping a string literal) —
 * never used for editing, just so a placeholder can show real content. */
function textPreviewOf(node: Node): string | undefined {
  if (!Node.isJsxElement(node)) return undefined
  const children = node.getJsxChildren()
  const text = children
    .map((c) => {
      if (Node.isJsxText(c)) return c.getText()
      if (Node.isJsxExpression(c)) {
        const expr = c.getExpression()
        return expr && Node.isStringLiteral(expr) ? expr.getLiteralText() : ''
      }
      return ''
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return undefined
  return text.length > MAX_TEXT_PREVIEW ? `${text.slice(0, MAX_TEXT_PREVIEW)}…` : text
}

/**
 * Best-effort, static read of an existing page's real JSX structure — a
 * genuine (capped) nested tree, not just the outermost element's direct
 * children. This is deliberately NOT a full JSX-to-DesignNode conversion
 * with prop typing (see the plan's schematic-rendering scope decision): it
 * captures identity + real nesting only, enough to seed an honest Existing
 * Page draft where each real element becomes a `limited` (a component this
 * project's own indexer found) or `locked` (anything else — native DOM tags
 * included) placeholder, in its real position in the tree, never executed.
 */
export function extractPageStructure(content: string, ext: string, knownComponentNames: Set<string>, includeRoot = false): PageStructureItem[] {
  const project = new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true })
  const sourceFile = project.createSourceFile(`page-scan${ext}`, content, { overwrite: true, scriptKind: scriptKindFor(ext) })

  let root: Node | null = null
  try {
    sourceFile.forEachDescendant((node, traversal) => {
      if (isJsxNode(node) && !isJsxNode(node.getParentOrThrow())) {
        root = node
        traversal.stop()
      }
    })
  } catch {
    return []
  }

  if (!root) return []

  let nodeCount = 0
  function buildItem(node: Node, depth: number): PageStructureItem | null {
    const tagName = tagNameOf(node)
    if (!tagName) return null
    if (nodeCount >= MAX_NODES) return null
    nodeCount++

    const children: PageStructureItem[] = []
    if (depth < MAX_DEPTH) {
      for (const child of directJsxChildren(node)) {
        const item = buildItem(child, depth + 1)
        if (item) children.push(item)
        if (nodeCount >= MAX_NODES) break
      }
    }

    return {
      tagName,
      isKnownComponent: knownComponentNames.has(tagName),
      children,
      sourceLine: node.getStartLineNumber(),
      attributes: staticAttributesOf(node),
      textPreview: children.length === 0 ? textPreviewOf(node) : undefined,
    }
  }

  const items: PageStructureItem[] = []
  if (includeRoot) {
    const item = buildItem(root, 0)
    return item ? [item] : []
  }
  for (const child of directJsxChildren(root)) {
    const item = buildItem(child, 1)
    if (item) items.push(item)
    if (nodeCount >= MAX_NODES) break
  }
  return items
}
