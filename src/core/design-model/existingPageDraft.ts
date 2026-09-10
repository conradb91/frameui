import type { DesignNode, PlaceholderNode } from '@shared/types/designNode'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { classifyEditability } from './editability'

function stableSourceNodeId(item: PageStructureItem, lineage: number[]): string {
  const tag = item.tagName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'node'
  return `source-node.${lineage.join('.')}.${tag}`
}

function buildPlaceholder(item: PageStructureItem, sourceFilePath: string, lineage: number[]): PlaceholderNode {
  return {
    kind: 'placeholder',
    id: stableSourceNodeId(item, lineage),
    editability: classifyEditability(item.isKnownComponent ? 'project-component-partial' : 'unresolvable'),
    provenance: 'existing',
    children: item.children.map((child, index) => buildPlaceholder(child, sourceFilePath, [...lineage, index])),
    label: item.tagName,
    sourceFilePath: item.sourceFilePath ?? sourceFilePath,
    sourceLine: item.sourceLine,
    sourceReference: { filePath: item.sourceFilePath ?? sourceFilePath, line: item.sourceLine },
    attributes: item.attributes,
    textPreview: item.textPreview,
  }
}

/**
 * Builds a screen draft's root tree from a real detected page's structure.
 * The root stack is our own synthetic wrapper (`editable` — we fully
 * control it), but every descendant placeholder — nested exactly as it was
 * in the real JSX/HTML/template page, not flattened — carries the editability its real
 * source content actually earned: `limited` for a component this project's
 * own indexer understood, `locked` for anything else (native DOM tags
 * included) — never silently upgraded to fully editable, and the source
 * file is never opened for write (§18 source safety).
 */
export function buildExistingPageDraftTree(rootId: string, items: PageStructureItem[], sourceFilePath: string): DesignNode {
  const children: DesignNode[] = items.map((item, index) => buildPlaceholder(item, sourceFilePath, [index]))

  return {
    kind: 'stack',
    id: rootId,
    editability: 'editable',
    provenance: 'existing',
    children,
    direction: 'column',
    gap: 12,
    align: 'stretch',
  }
}
