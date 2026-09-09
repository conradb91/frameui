import { produce } from 'immer'
import type { DesignNode } from '@shared/types/designNode'

/**
 * Pure tree operations shared by the canvas, the command reducer, and (in
 * a later phase) the SVG/export serializers — one source of truth for
 * "how the design tree is shaped and searched," never reimplemented per
 * consumer. Browser-safe: no Node APIs, runs in the renderer.
 */

export function findNode(root: DesignNode, id: string): DesignNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

export interface ParentInfo {
  parent: DesignNode
  index: number
}

export function findParent(root: DesignNode, id: string): ParentInfo | null {
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].id === id) return { parent: root, index: i }
    const found = findParent(root.children[i], id)
    if (found) return found
  }
  return null
}

export function insertNode(root: DesignNode, parentId: string, index: number, node: DesignNode): DesignNode {
  return produce(root, (draft) => {
    const parent = findNode(draft as DesignNode, parentId)
    if (!parent) return
    const clampedIndex = Math.max(0, Math.min(index, parent.children.length))
    parent.children.splice(clampedIndex, 0, node as never)
  })
}

export function removeNode(root: DesignNode, id: string): DesignNode {
  return produce(root, (draft) => {
    const info = findParent(draft as DesignNode, id)
    if (!info) return
    info.parent.children.splice(info.index, 1)
  })
}

export function moveNode(root: DesignNode, nodeId: string, newParentId: string, newIndex: number): DesignNode {
  return produce(root, (draft) => {
    const info = findParent(draft as DesignNode, nodeId)
    const newParent = findNode(draft as DesignNode, newParentId)
    if (!info || !newParent) return
    const [node] = info.parent.children.splice(info.index, 1)
    const clampedIndex = Math.max(0, Math.min(newIndex, newParent.children.length))
    newParent.children.splice(clampedIndex, 0, node)
  })
}

/** Generic node-field updater — used by the command reducer for
 * property-only changes (SetText, SetGap, SetDirection, …) that don't
 * touch the tree's shape. */
export function updateNode<T extends DesignNode>(root: DesignNode, id: string, updater: (node: T) => void): DesignNode {
  return produce(root, (draft) => {
    const node = findNode(draft as DesignNode, id)
    if (node) updater(node as T)
  })
}

/** Deep-clones a subtree with a fresh id at every level — the one place
 * Duplicate (Phase 11) and Paste build the `newNode` that `DuplicateNode`/
 * `InsertComponent` then insert, so both features share one definition of
 * "what counts as a safe copy" instead of two slightly different reimplementations. */
export function cloneNodeWithFreshIds<T extends DesignNode>(node: T): T {
  return { ...node, id: crypto.randomUUID(), children: node.children.map((child) => cloneNodeWithFreshIds(child)) }
}
