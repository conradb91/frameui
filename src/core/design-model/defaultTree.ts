import type { DesignNode } from '@shared/types/designNode'

/** A brand-new blank screen starts as an empty vertical stack — the root
 * container every inserted primitive lands inside. */
export function createDefaultTree(rootId: string): DesignNode {
  return {
    kind: 'stack',
    id: rootId,
    editability: 'editable',
    children: [],
    direction: 'column',
    gap: 16,
    align: 'stretch',
  }
}
