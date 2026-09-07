import type { DesignNode, StackNode, TextNode, Breakpoint } from '@shared/types/designNode'
import { findNode, findParent, insertNode, removeNode, moveNode, updateNode } from './tree'

/**
 * Every visual edit is one of these — spec §35.1's explicit V1 choice, so a
 * future AI layer can call the same allowlist without broader access.
 * Nothing mutates the tree outside applyCommand.
 */
export type DesignCommand =
  | { type: 'InsertComponent'; parentId: string; index: number; node: DesignNode }
  | { type: 'DeleteNode'; nodeId: string }
  | { type: 'SetText'; nodeId: string; content: string }
  | { type: 'SetGap'; nodeId: string; gap: number }
  | { type: 'SetDirection'; nodeId: string; direction: 'row' | 'column' }
  | { type: 'MoveNode'; nodeId: string; newParentId: string; newIndex: number }
  | { type: 'SetHidden'; nodeId: string; hidden: boolean }
  | { type: 'SetLocked'; nodeId: string; locked: boolean }
  | { type: 'SetResponsiveHidden'; nodeId: string; breakpoint: Exclude<Breakpoint, 'desktop'>; hidden: boolean | null }

export function applyCommand(tree: DesignNode, command: DesignCommand): DesignNode {
  switch (command.type) {
    case 'InsertComponent':
      return insertNode(tree, command.parentId, command.index, command.node)
    case 'DeleteNode':
      return removeNode(tree, command.nodeId)
    case 'SetText':
      return updateNode<TextNode>(tree, command.nodeId, (n) => {
        n.content = command.content
      })
    case 'SetGap':
      return updateNode<StackNode>(tree, command.nodeId, (n) => {
        n.gap = command.gap
      })
    case 'SetDirection':
      return updateNode<StackNode>(tree, command.nodeId, (n) => {
        n.direction = command.direction
      })
    case 'MoveNode':
      return moveNode(tree, command.nodeId, command.newParentId, command.newIndex)
    case 'SetHidden':
      return updateNode(tree, command.nodeId, (n) => {
        n.hidden = command.hidden
      })
    case 'SetLocked':
      return updateNode(tree, command.nodeId, (n) => {
        n.locked = command.locked
      })
    case 'SetResponsiveHidden':
      return updateNode(tree, command.nodeId, (n) => {
        if (command.hidden === null) {
          if (n.responsiveHidden) delete n.responsiveHidden[command.breakpoint]
        } else {
          n.responsiveHidden = { ...n.responsiveHidden, [command.breakpoint]: command.hidden }
        }
      })
  }
}

/**
 * Computes the command that undoes `command`, reading whatever prior state
 * it needs from `tree` — must be called BEFORE applyCommand, against the
 * pre-apply tree. Undo/redo stores {command, inverse} pairs rather than
 * tree snapshots (spec DRF-03's ≥100-step budget without memory bloat).
 */
export function invertCommand(tree: DesignNode, command: DesignCommand): DesignCommand | null {
  switch (command.type) {
    case 'InsertComponent':
      return { type: 'DeleteNode', nodeId: command.node.id }

    case 'DeleteNode': {
      const info = findParent(tree, command.nodeId)
      const node = findNode(tree, command.nodeId)
      if (!info || !node) return null
      return { type: 'InsertComponent', parentId: info.parent.id, index: info.index, node }
    }

    case 'SetText': {
      const node = findNode(tree, command.nodeId) as TextNode | null
      if (!node) return null
      return { type: 'SetText', nodeId: command.nodeId, content: node.content }
    }

    case 'SetGap': {
      const node = findNode(tree, command.nodeId) as StackNode | null
      if (!node) return null
      return { type: 'SetGap', nodeId: command.nodeId, gap: node.gap }
    }

    case 'SetDirection': {
      const node = findNode(tree, command.nodeId) as StackNode | null
      if (!node) return null
      return { type: 'SetDirection', nodeId: command.nodeId, direction: node.direction }
    }

    case 'MoveNode': {
      const info = findParent(tree, command.nodeId)
      if (!info) return null
      return { type: 'MoveNode', nodeId: command.nodeId, newParentId: info.parent.id, newIndex: info.index }
    }

    case 'SetHidden': {
      const node = findNode(tree, command.nodeId)
      if (!node) return null
      return { type: 'SetHidden', nodeId: command.nodeId, hidden: node.hidden ?? false }
    }

    case 'SetLocked': {
      const node = findNode(tree, command.nodeId)
      if (!node) return null
      return { type: 'SetLocked', nodeId: command.nodeId, locked: node.locked ?? false }
    }

    case 'SetResponsiveHidden': {
      const node = findNode(tree, command.nodeId)
      if (!node) return null
      const prior = node.responsiveHidden?.[command.breakpoint] ?? null
      return { type: 'SetResponsiveHidden', nodeId: command.nodeId, breakpoint: command.breakpoint, hidden: prior }
    }
  }
}
