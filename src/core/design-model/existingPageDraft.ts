import type { DesignNode } from '@shared/types/designNode'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { classifyEditability } from './editability'

/**
 * Builds a screen draft's root tree from a real detected page's shallow
 * structure. The root stack is our own synthetic wrapper (`editable` — we
 * fully control it), but every child placeholder carries the editability
 * its real source content actually earned: `limited` for a component this
 * project's own indexer understood, `locked` for anything else (native DOM
 * tags included) — never silently upgraded to fully editable, and the
 * source file is never opened for write (§18 source safety).
 */
export function buildExistingPageDraftTree(rootId: string, items: PageStructureItem[], sourceFilePath: string): DesignNode {
  const children: DesignNode[] = items.map((item) => ({
    kind: 'placeholder',
    id: crypto.randomUUID(),
    editability: classifyEditability(item.isKnownComponent ? 'project-component-partial' : 'unresolvable'),
    children: [],
    label: item.tagName,
    sourceFilePath,
  }))

  return {
    kind: 'stack',
    id: rootId,
    editability: 'editable',
    children,
    direction: 'column',
    gap: 12,
    align: 'stretch',
  }
}
