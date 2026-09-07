import { Project, ScriptKind, SyntaxKind, Node } from 'ts-morph'
import type { PageStructureItem } from '@shared/types/pageStructure'

export type { PageStructureItem }

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

/**
 * Best-effort, static, shallow read of an existing page's top-level JSX
 * structure — the outermost returned JSX element's direct children, by tag
 * name only. This is deliberately NOT a full JSX-to-DesignNode conversion
 * (see the plan's schematic-rendering scope decision): it's just enough to
 * seed an honest Existing Page draft where each real element becomes a
 * `limited` (a component this project's own indexer found) or `locked`
 * (anything else — native DOM tags included) placeholder, never executed.
 */
export function extractPageStructure(content: string, ext: string, knownComponentNames: Set<string>): PageStructureItem[] {
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

  const items: PageStructureItem[] = []
  for (const child of directJsxChildren(root)) {
    const tagName = tagNameOf(child)
    if (!tagName) continue
    items.push({ tagName, isKnownComponent: knownComponentNames.has(tagName) })
  }
  return items
}
