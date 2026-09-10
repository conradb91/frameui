import type { DesignNode, StackNode, GridNode, ConceptNode, TextNode, PlaceholderNode, ButtonNode, ImageNode, Breakpoint, NodeStyle, ResponsiveOverride } from '@shared/types/designNode'
import { findNode, findParent, insertNode, removeNode, moveNode, updateNode } from './tree'

/**
 * Every visual edit is one of these — spec §35.1's explicit V1 choice, so a
 * future AI layer can call the same allowlist without broader access.
 * Nothing mutates the tree outside applyCommand.
 */
export type DesignCommand =
  | { type: 'InsertComponent'; parentId: string; index: number; node: DesignNode }
  | { type: 'DeleteNode'; nodeId: string }
  | { type: 'SetAttribute'; nodeId: string; name: string; value: string | null }
  | { type: 'SetText'; nodeId: string; content: string }
  | { type: 'SetGap'; nodeId: string; gap: number }
  | { type: 'SetDirection'; nodeId: string; direction: 'row' | 'column' }
  | { type: 'MoveNode'; nodeId: string; newParentId: string; newIndex: number }
  | { type: 'SetHidden'; nodeId: string; hidden: boolean }
  | { type: 'SetLocked'; nodeId: string; locked: boolean }
  | { type: 'SetResponsiveHidden'; nodeId: string; breakpoint: Exclude<Breakpoint, 'desktop'>; hidden: boolean | null }
  // CMP-02: swap a `limited` placeholder for another detected project
  // component in place — id/children/hidden/locked all survive; only the
  // component identity changes.
  | { type: 'SwapComponent'; nodeId: string; component: { name: string; filePath: string } }
  // Phase 10/11 — layout-aware editing additions. `newNode` for
  // DuplicateNode is pre-built by the caller (via `cloneNodeWithFreshIds`)
  // since applyCommand stays pure/side-effect-free; the command inserts it
  // as the following sibling of `nodeId`.
  | { type: 'DuplicateNode'; nodeId: string; newNode: DesignNode }
  | { type: 'SetJustify'; nodeId: string; justify: NonNullable<StackNode['justify']> }
  | { type: 'SetWrap'; nodeId: string; wrap: boolean }
  | { type: 'SetAlign'; nodeId: string; align: StackNode['align'] }
  | { type: 'SetGridColumns'; nodeId: string; columns: number }
  | { type: 'SetGridRows'; nodeId: string; rows: GridNode['rows'] }
  | { type: 'SetGridGap'; nodeId: string; columnGap: number; rowGap: number }
  | { type: 'SetGridPlacement'; nodeId: string; placement: DesignNode['gridPlacement'] }
  // Merge-patches `style` (spec Phase 10-12) — every field in `style` is
  // applied on top of the node's existing style, never a full replace, so
  // the Inspector can set one field (e.g. `borderRadius`) without callers
  // needing to round-trip the rest.
  | { type: 'SetStyle'; nodeId: string; style: Partial<NodeStyle> }
  | { type: 'SetConceptVariant'; nodeId: string; variantId: string | null }
  | { type: 'SetConceptProperty'; nodeId: string; propertyId: string; value: string }
  // Phase 12 (Layout Inspector) additions — buttons/images had no way to
  // edit their one or two kind-specific fields; follows the exact
  // SetText/SetDirection pattern above.
  | { type: 'SetLabel'; nodeId: string; label: string }
  | { type: 'SetVariant'; nodeId: string; variant: ButtonNode['variant'] }
  | { type: 'SetAlt'; nodeId: string; alt: string }
  // Phase 18 — REPLACES one breakpoint's override object wholesale (same
  // convention as SetGridGap: the caller reads the current override and
  // spreads its own patch on top before dispatching, so a merge-based
  // apply can't silently strand a field an undo needs to remove — a plain
  // merge here would make undo unable to un-add a key the forward command
  // introduced). `override: null` clears every override for that
  // breakpoint (spec: "a responsive override removed after creation"
  // reverts to inheriting the base/desktop value).
  | { type: 'SetResponsiveOverride'; nodeId: string; breakpoint: Exclude<Breakpoint, 'desktop'>; override: ResponsiveOverride | null }

/**
 * spec §26 (Locked): "No deep editing." Enforced here — the one chokepoint
 * every command (human today, an allowlisted AI later per §35.1) must pass
 * through — rather than in the UI, so lock can't be bypassed by a future
 * caller that skips a particular panel's guard. Move/hide/lock-toggle stay
 * allowed on a locked node per §26's "move or hide only if parent rules
 * permit"; only content/layout mutation of the locked node itself is
 * blocked. Returns the exact same tree reference (not a clone) so callers
 * can detect the no-op via `nextTree === tree`.
 */
function isLocked(tree: DesignNode, nodeId: string): boolean {
  return findNode(tree, nodeId)?.locked === true
}

/** Content/property mutation, applied to a node whose provenance was
 * 'existing', earns "Existing, Modified" (spec Phase 15) — called from
 * inside every content-mutating command's `updateNode` callback, the one
 * chokepoint every such command passes through, so no caller needs to
 * remember to flip it itself. Move/hide/lock alone don't count as
 * "modified" (spec examples: reordering isn't redesigning), so MoveNode/
 * SetHidden/SetLocked/SetResponsiveHidden don't call this. */
function markModifiedIfExisting(n: DesignNode): void {
  if (n.provenance === 'existing') n.provenance = 'existing-modified'
}

export function applyCommand(tree: DesignNode, command: DesignCommand): DesignNode {
  switch (command.type) {
    case 'InsertComponent':
      if (isLocked(tree, command.parentId)) return tree
      return insertNode(tree, command.parentId, command.index, command.node)
    case 'DeleteNode':
      return removeNode(tree, command.nodeId)
    case 'SetAttribute':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode(tree, command.nodeId, (n) => {
        if (n.kind !== 'placeholder') return
        n.attributes = { ...n.attributes }
        if (command.value === null) delete n.attributes[command.name]
        else n.attributes[command.name] = command.value
        markModifiedIfExisting(n)
      })
    case 'SetText':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode(tree, command.nodeId, (n) => {
        if (n.kind === 'placeholder') n.textPreview = command.content
        else if (n.kind === 'text' || n.kind === 'heading') n.content = command.content
        markModifiedIfExisting(n)
      })
    case 'SetGap':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<StackNode>(tree, command.nodeId, (n) => {
        n.gap = command.gap
        markModifiedIfExisting(n)
      })
    case 'SetDirection':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<StackNode>(tree, command.nodeId, (n) => {
        n.direction = command.direction
        markModifiedIfExisting(n)
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
    case 'SwapComponent':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<PlaceholderNode>(tree, command.nodeId, (n) => {
        n.label = command.component.name
        n.sourceFilePath = command.component.filePath
        // The swapped-in instance no longer reflects the original page's
        // text — showing it would misrepresent the new component.
        n.textPreview = undefined
        n.sourceLine = undefined
        n.attributes = undefined
        markModifiedIfExisting(n)
      })
    case 'DuplicateNode': {
      const info = findParent(tree, command.nodeId)
      if (!info) return tree
      if (isLocked(tree, info.parent.id)) return tree
      return insertNode(tree, info.parent.id, info.index + 1, command.newNode)
    }
    case 'SetJustify':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<StackNode>(tree, command.nodeId, (n) => {
        n.justify = command.justify
        markModifiedIfExisting(n)
      })
    case 'SetWrap':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<StackNode>(tree, command.nodeId, (n) => {
        n.wrap = command.wrap
        markModifiedIfExisting(n)
      })
    case 'SetAlign':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<StackNode>(tree, command.nodeId, (n) => {
        n.align = command.align
        markModifiedIfExisting(n)
      })
    case 'SetGridColumns':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<GridNode>(tree, command.nodeId, (n) => {
        n.columns = command.columns
        markModifiedIfExisting(n)
      })
    case 'SetGridRows':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<GridNode>(tree, command.nodeId, (n) => {
        n.rows = command.rows
        markModifiedIfExisting(n)
      })
    case 'SetGridGap':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<GridNode>(tree, command.nodeId, (n) => {
        n.columnGap = command.columnGap
        n.rowGap = command.rowGap
        markModifiedIfExisting(n)
      })
    case 'SetGridPlacement':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode(tree, command.nodeId, (n) => {
        n.gridPlacement = command.placement
        markModifiedIfExisting(n)
      })
    case 'SetStyle':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode(tree, command.nodeId, (n) => {
        n.style = { ...n.style, ...command.style }
        markModifiedIfExisting(n)
      })
    case 'SetConceptVariant':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<ConceptNode>(tree, command.nodeId, (n) => {
        n.variantId = command.variantId
      })
    case 'SetConceptProperty':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<ConceptNode>(tree, command.nodeId, (n) => {
        n.propertyValues = { ...n.propertyValues, [command.propertyId]: command.value }
      })
    case 'SetLabel':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<ButtonNode>(tree, command.nodeId, (n) => {
        n.label = command.label
        markModifiedIfExisting(n)
      })
    case 'SetVariant':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<ButtonNode>(tree, command.nodeId, (n) => {
        n.variant = command.variant
        markModifiedIfExisting(n)
      })
    case 'SetAlt':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode<ImageNode>(tree, command.nodeId, (n) => {
        n.alt = command.alt
        markModifiedIfExisting(n)
      })
    case 'SetResponsiveOverride':
      if (isLocked(tree, command.nodeId)) return tree
      return updateNode(tree, command.nodeId, (n) => {
        if (command.override === null) {
          if (n.responsiveOverrides) delete n.responsiveOverrides[command.breakpoint]
        } else {
          n.responsiveOverrides = { ...n.responsiveOverrides, [command.breakpoint]: command.override }
        }
        markModifiedIfExisting(n)
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

    case 'SetAttribute': {
      const node = findNode(tree, command.nodeId)
      if (!node || node.kind !== 'placeholder') return null
      return { type: 'SetAttribute', nodeId: node.id, name: command.name, value: node.attributes?.[command.name] ?? null }
    }
    case 'SetText': {
      const node = findNode(tree, command.nodeId)
      if (!node) return null
      return { type: 'SetText', nodeId: command.nodeId, content: node.kind === 'placeholder' ? node.textPreview ?? '' : (node as TextNode).content }
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

    case 'SwapComponent': {
      const node = findNode(tree, command.nodeId) as PlaceholderNode | null
      if (!node) return null
      return { type: 'SwapComponent', nodeId: command.nodeId, component: { name: node.label, filePath: node.sourceFilePath ?? '' } }
    }

    case 'DuplicateNode':
      return { type: 'DeleteNode', nodeId: command.newNode.id }

    case 'SetJustify': {
      const node = findNode(tree, command.nodeId) as StackNode | null
      if (!node) return null
      return { type: 'SetJustify', nodeId: command.nodeId, justify: node.justify ?? 'start' }
    }

    case 'SetWrap': {
      const node = findNode(tree, command.nodeId) as StackNode | null
      if (!node) return null
      return { type: 'SetWrap', nodeId: command.nodeId, wrap: node.wrap ?? false }
    }

    case 'SetAlign': {
      const node = findNode(tree, command.nodeId) as StackNode | null
      if (!node) return null
      return { type: 'SetAlign', nodeId: command.nodeId, align: node.align }
    }

    case 'SetGridColumns': {
      const node = findNode(tree, command.nodeId) as GridNode | null
      if (!node) return null
      return { type: 'SetGridColumns', nodeId: command.nodeId, columns: node.columns }
    }

    case 'SetGridRows': {
      const node = findNode(tree, command.nodeId) as GridNode | null
      if (!node) return null
      return { type: 'SetGridRows', nodeId: command.nodeId, rows: node.rows }
    }

    case 'SetGridGap': {
      const node = findNode(tree, command.nodeId) as GridNode | null
      if (!node) return null
      return { type: 'SetGridGap', nodeId: command.nodeId, columnGap: node.columnGap, rowGap: node.rowGap }
    }

    case 'SetGridPlacement': {
      const node = findNode(tree, command.nodeId)
      if (!node) return null
      return { type: 'SetGridPlacement', nodeId: command.nodeId, placement: node.gridPlacement }
    }

    case 'SetStyle': {
      const node = findNode(tree, command.nodeId)
      if (!node) return null
      // Restores exactly the prior value (including `undefined`) for every
      // key the forward command is about to touch — a full round trip, not
      // just the keys that happened to already be set.
      const prior: Partial<NodeStyle> = {}
      for (const key of Object.keys(command.style) as (keyof NodeStyle)[]) {
        prior[key] = node.style?.[key] as never
      }
      return { type: 'SetStyle', nodeId: command.nodeId, style: prior }
    }

    case 'SetConceptVariant': {
      const node = findNode(tree, command.nodeId) as ConceptNode | null
      if (!node) return null
      return { type: 'SetConceptVariant', nodeId: command.nodeId, variantId: node.variantId }
    }

    case 'SetConceptProperty': {
      const node = findNode(tree, command.nodeId) as ConceptNode | null
      if (!node) return null
      return { type: 'SetConceptProperty', nodeId: command.nodeId, propertyId: command.propertyId, value: node.propertyValues[command.propertyId] ?? '' }
    }

    case 'SetLabel': {
      const node = findNode(tree, command.nodeId) as ButtonNode | null
      if (!node) return null
      return { type: 'SetLabel', nodeId: command.nodeId, label: node.label }
    }

    case 'SetVariant': {
      const node = findNode(tree, command.nodeId) as ButtonNode | null
      if (!node) return null
      return { type: 'SetVariant', nodeId: command.nodeId, variant: node.variant }
    }

    case 'SetAlt': {
      const node = findNode(tree, command.nodeId) as ImageNode | null
      if (!node) return null
      return { type: 'SetAlt', nodeId: command.nodeId, alt: node.alt }
    }

    case 'SetResponsiveOverride': {
      const node = findNode(tree, command.nodeId)
      if (!node) return null
      const prior = node.responsiveOverrides?.[command.breakpoint] ?? null
      // Full-value restore (not a merge patch) so undo puts the breakpoint
      // back to exactly its prior state, including "had no override at all".
      return { type: 'SetResponsiveOverride', nodeId: command.nodeId, breakpoint: command.breakpoint, override: prior }
    }
  }
}
