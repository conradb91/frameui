import type { DesignNode, GridNode, NodeStyle, StackNode } from '@shared/types/designNode'
import type { DesignOperation, PageRef, VersionDifference } from '@shared/types/model/featureModel'
import type { DesignCommand } from './commands'
import { applyCommand } from './commands'
import { findNode, findParent, updateNode } from './tree'

export interface OperationContext {
  featureId: string
  ownerId: string
  pageRef: PageRef
  designStateId: string
  alternativeId: string | null
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const revision = () => globalThis.crypto.randomUUID()

function valueAt(tree: DesignNode, nodeId: string, property: string): unknown {
  const node = findNode(tree, nodeId) as unknown as Record<string, unknown> | null
  if (!node) return undefined
  return property.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), node)
}

function make(
  context: OperationContext,
  partial: Omit<DesignOperation, 'id' | 'revisionId' | 'featureId' | 'ownerId' | 'pageRef' | 'designStateId' | 'alternativeId' | 'createdAt' | 'updatedAt'>,
  existing?: DesignOperation,
): DesignOperation {
  const now = new Date().toISOString()
  return {
    ...partial,
    id: existing?.id ?? revision(),
    revisionId: revision(),
    featureId: context.featureId,
    ownerId: context.ownerId,
    pageRef: context.pageRef,
    designStateId: context.designStateId,
    alternativeId: context.alternativeId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function descriptions(command: DesignCommand): Array<{ key: string; property: string | null; type: DesignOperation['type']; targetNodeId: string; proposed: unknown; node?: DesignNode; parentId?: string; index?: number; summary: string; breakpoint?: DesignOperation['breakpoint'] }> {
  switch (command.type) {
    case 'InsertComponent': return [{ key: `${command.node.id}:create`, property: null, type: command.node.kind === 'concept' ? 'create-component-instance' : 'create', targetNodeId: command.node.id, proposed: { parentId: command.parentId, index: command.index }, node: command.node, parentId: command.parentId, index: command.index, summary: `Add ${command.node.kind} to ${command.parentId}` }]
    case 'DuplicateNode': return [{ key: `${command.newNode.id}:create`, property: null, type: command.newNode.kind === 'concept' ? 'create-component-instance' : 'create', targetNodeId: command.newNode.id, proposed: null, node: command.newNode, summary: `Duplicate ${command.nodeId}` }]
    case 'DeleteNode': return [{ key: `${command.nodeId}:delete`, property: null, type: 'delete', targetNodeId: command.nodeId, proposed: true, summary: `Remove ${command.nodeId}` }]
    case 'MoveNode': return [{ key: `${command.nodeId}:move`, property: 'position', type: 'move', targetNodeId: command.nodeId, proposed: { parentId: command.newParentId, index: command.newIndex }, parentId: command.newParentId, index: command.newIndex, summary: `Move ${command.nodeId} inside ${command.newParentId}` }]
    case 'SetText': return [{ key: `${command.nodeId}:content`, property: 'content', type: 'change-content', targetNodeId: command.nodeId, proposed: command.content, summary: `Change text on ${command.nodeId}` }]
    case 'SetLabel': return [{ key: `${command.nodeId}:label`, property: 'label', type: 'change-content', targetNodeId: command.nodeId, proposed: command.label, summary: `Change label on ${command.nodeId}` }]
    case 'SetAlt': return [{ key: `${command.nodeId}:alt`, property: 'alt', type: 'change-content', targetNodeId: command.nodeId, proposed: command.alt, summary: `Change image description on ${command.nodeId}` }]
    case 'SetGap': return [{ key: `${command.nodeId}:layout.gap`, property: 'gap', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.gap, summary: `Set gap on ${command.nodeId} to ${command.gap}px` }]
    case 'SetDirection': return [{ key: `${command.nodeId}:layout.direction`, property: 'direction', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.direction, summary: `Set ${command.nodeId} direction to ${command.direction}` }]
    case 'SetJustify': return [{ key: `${command.nodeId}:layout.justify`, property: 'justify', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.justify, summary: `Change justification on ${command.nodeId}` }]
    case 'SetWrap': return [{ key: `${command.nodeId}:layout.wrap`, property: 'wrap', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.wrap, summary: `Change wrapping on ${command.nodeId}` }]
    case 'SetAlign': return [{ key: `${command.nodeId}:layout.align`, property: 'align', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.align, summary: `Change alignment on ${command.nodeId}` }]
    case 'SetGridColumns': return [{ key: `${command.nodeId}:layout.columns`, property: 'columns', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.columns, summary: `Set ${command.nodeId} to ${command.columns} columns` }]
    case 'SetGridRows': return [{ key: `${command.nodeId}:layout.rows`, property: 'rows', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.rows, summary: `Change grid rows on ${command.nodeId}` }]
    case 'SetGridGap': return [
      { key: `${command.nodeId}:layout.columnGap`, property: 'columnGap', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.columnGap, summary: `Set column gap on ${command.nodeId} to ${command.columnGap}px` },
      { key: `${command.nodeId}:layout.rowGap`, property: 'rowGap', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.rowGap, summary: `Set row gap on ${command.nodeId} to ${command.rowGap}px` },
    ]
    case 'SetGridPlacement': return [{ key: `${command.nodeId}:grid-placement`, property: 'gridPlacement', type: 'set-layout', targetNodeId: command.nodeId, proposed: command.placement, summary: `Change grid placement for ${command.nodeId}` }]
    case 'SetStyle': return Object.entries(command.style).map(([property, proposed]) => ({ key: `${command.nodeId}:style.${property}`, property: `style.${property}`, type: proposed === undefined ? 'unset-property' : 'set-property', targetNodeId: command.nodeId, proposed, summary: `${proposed === undefined ? 'Unset' : 'Set'} ${property} on ${command.nodeId}` }))
    case 'SetHidden': return [{ key: `${command.nodeId}:visibility`, property: 'hidden', type: 'change-visibility', targetNodeId: command.nodeId, proposed: command.hidden, summary: `${command.hidden ? 'Hide' : 'Show'} ${command.nodeId}` }]
    case 'SetResponsiveHidden': return [{ key: `${command.nodeId}:responsive.${command.breakpoint}.hidden`, property: 'hidden', type: command.hidden === null ? 'remove-responsive-override' : 'set-responsive-override', targetNodeId: command.nodeId, proposed: command.hidden, breakpoint: command.breakpoint, summary: `Change ${command.breakpoint} visibility on ${command.nodeId}` }]
    case 'SetResponsiveOverride': return [{ key: `${command.nodeId}:responsive.${command.breakpoint}`, property: 'responsiveOverride', type: command.override === null ? 'remove-responsive-override' : 'set-responsive-override', targetNodeId: command.nodeId, proposed: command.override, breakpoint: command.breakpoint, summary: `${command.override === null ? 'Remove' : 'Set'} ${command.breakpoint} override on ${command.nodeId}` }]
    case 'SwapComponent': return [{ key: `${command.nodeId}:component`, property: 'component', type: 'replace', targetNodeId: command.nodeId, proposed: command.component, summary: `Replace ${command.nodeId} with ${command.component.name}` }]
    case 'SetConceptVariant': return [{ key: `${command.nodeId}:variant`, property: 'variantId', type: 'change-component-variant', targetNodeId: command.nodeId, proposed: command.variantId, summary: `Change component variant on ${command.nodeId}` }]
    case 'SetConceptProperty': return [{ key: `${command.nodeId}:concept.${command.propertyId}`, property: `propertyValues.${command.propertyId}`, type: 'set-property', targetNodeId: command.nodeId, proposed: command.value, summary: `Set ${command.propertyId} on ${command.nodeId}` }]
    case 'SetVariant': return [{ key: `${command.nodeId}:variant`, property: 'variant', type: 'change-component-variant', targetNodeId: command.nodeId, proposed: command.variant, summary: `Change button variant on ${command.nodeId}` }]
    case 'SetLocked': return [] // editor-only state, not design intent
  }
}

export function composeDesignOperations(baseline: DesignNode, operations: DesignOperation[], command: DesignCommand, context: OperationContext): DesignOperation[] {
  let next = [...operations]
  const currentTree = applyDesignOperations(baseline, operations)
  const commandDescriptions = descriptions(command).map((description) => {
    if (command.type !== 'DuplicateNode' || description.parentId) return description
    const parent = findParent(currentTree, command.nodeId)
    return parent ? { ...description, proposed: { parentId: parent.parent.id, index: parent.index + 1 }, parentId: parent.parent.id, index: parent.index + 1 } : description
  })
  for (const description of commandDescriptions) {
    const existing = next.find((operation) => operation.key === description.key)
    let baseValue: unknown
    if (description.type === 'move') {
      const parent = findParent(baseline, description.targetNodeId)
      baseValue = parent ? { parentId: parent.parent.id, index: parent.index } : null
    } else if (description.type === 'create' || description.type === 'create-component-instance') baseValue = null
    else if (description.type === 'delete') baseValue = false
    else if (description.breakpoint && description.property === 'responsiveOverride') baseValue = findNode(baseline, description.targetNodeId)?.responsiveOverrides?.[description.breakpoint] ?? null
    else if (description.breakpoint && description.property === 'hidden') baseValue = findNode(baseline, description.targetNodeId)?.responsiveHidden?.[description.breakpoint] ?? null
    else baseValue = valueAt(baseline, description.targetNodeId, description.property ?? '')
    if (description.property === 'hidden' && !description.breakpoint) baseValue = baseValue ?? false

    // Insert followed by delete cancels the proposed node and all of its edits.
    const createIndex = next.findIndex((operation) => operation.targetNodeId === description.targetNodeId && (operation.type === 'create' || operation.type === 'create-component-instance'))
    if (description.type === 'delete' && createIndex >= 0 && !findNode(baseline, description.targetNodeId)) {
      next = next.filter((operation) => operation.targetNodeId !== description.targetNodeId)
      continue
    }
    if (description.type === 'delete') next = next.filter((operation) => operation.targetNodeId !== description.targetNodeId || operation.type === 'delete')
    if (same(description.proposed, baseValue)) {
      next = next.filter((operation) => operation.key !== description.key)
      continue
    }
    const operation = make(context, {
      ...description,
      breakpoint: description.breakpoint ?? null,
      baseValue: existing?.baseValue ?? baseValue,
      proposedValue: description.proposed,
      node: description.node ?? existing?.node ?? null,
      parentId: description.parentId ?? existing?.parentId ?? null,
      index: description.index ?? existing?.index ?? null,
    }, existing)
    next = [...next.filter((item) => item.key !== operation.key), operation]
  }
  return next
}

function setPathCommand(operation: DesignOperation): DesignCommand | null {
  const property = operation.property
  if (!property) return null
  if (property.startsWith('style.')) return { type: 'SetStyle', nodeId: operation.targetNodeId, style: { [property.slice(6)]: operation.proposedValue } as Partial<NodeStyle> }
  if (property.startsWith('propertyValues.')) return { type: 'SetConceptProperty', nodeId: operation.targetNodeId, propertyId: property.slice(15), value: String(operation.proposedValue ?? '') }
  const direct: Record<string, () => DesignCommand> = {
    content: () => ({ type: 'SetText', nodeId: operation.targetNodeId, content: String(operation.proposedValue ?? '') }),
    label: () => ({ type: 'SetLabel', nodeId: operation.targetNodeId, label: String(operation.proposedValue ?? '') }),
    alt: () => ({ type: 'SetAlt', nodeId: operation.targetNodeId, alt: String(operation.proposedValue ?? '') }),
    gap: () => ({ type: 'SetGap', nodeId: operation.targetNodeId, gap: Number(operation.proposedValue) }),
    direction: () => ({ type: 'SetDirection', nodeId: operation.targetNodeId, direction: operation.proposedValue as StackNode['direction'] }),
    justify: () => ({ type: 'SetJustify', nodeId: operation.targetNodeId, justify: operation.proposedValue as NonNullable<StackNode['justify']> }),
    wrap: () => ({ type: 'SetWrap', nodeId: operation.targetNodeId, wrap: Boolean(operation.proposedValue) }),
    align: () => ({ type: 'SetAlign', nodeId: operation.targetNodeId, align: operation.proposedValue as StackNode['align'] }),
    columns: () => ({ type: 'SetGridColumns', nodeId: operation.targetNodeId, columns: Number(operation.proposedValue) }),
    rows: () => ({ type: 'SetGridRows', nodeId: operation.targetNodeId, rows: operation.proposedValue as GridNode['rows'] }),
    gridPlacement: () => ({ type: 'SetGridPlacement', nodeId: operation.targetNodeId, placement: operation.proposedValue as DesignNode['gridPlacement'] }),
    hidden: () => ({ type: 'SetHidden', nodeId: operation.targetNodeId, hidden: Boolean(operation.proposedValue) }),
    variantId: () => ({ type: 'SetConceptVariant', nodeId: operation.targetNodeId, variantId: operation.proposedValue as string | null }),
    variant: () => ({ type: 'SetVariant', nodeId: operation.targetNodeId, variant: operation.proposedValue as 'primary' | 'secondary' }),
  }
  return direct[property]?.() ?? null
}

export function applyDesignOperations(baseline: DesignNode, operations: DesignOperation[]): DesignNode {
  return operations.reduce((tree, operation) => {
    let command: DesignCommand | null = null
    if (operation.type === 'create' || operation.type === 'create-component-instance') {
      if (operation.node && operation.parentId !== null) command = { type: 'InsertComponent', parentId: operation.parentId, index: operation.index ?? 0, node: operation.node }
    } else if (operation.type === 'delete') command = { type: 'DeleteNode', nodeId: operation.targetNodeId }
    else if (operation.type === 'move' || operation.type === 'reorder') {
      const placement = operation.proposedValue as { parentId: string; index: number }
      command = { type: 'MoveNode', nodeId: operation.targetNodeId, newParentId: placement.parentId, newIndex: placement.index }
    } else if (operation.type === 'replace') command = { type: 'SwapComponent', nodeId: operation.targetNodeId, component: operation.proposedValue as { name: string; filePath: string } }
    else if (operation.type === 'set-responsive-override' || operation.type === 'remove-responsive-override') {
      if (operation.breakpoint && operation.property === 'hidden') command = { type: 'SetResponsiveHidden', nodeId: operation.targetNodeId, breakpoint: operation.breakpoint, hidden: operation.proposedValue as boolean | null }
      else if (operation.breakpoint) command = { type: 'SetResponsiveOverride', nodeId: operation.targetNodeId, breakpoint: operation.breakpoint, override: operation.proposedValue as never }
    } else if (operation.property === 'columnGap' || operation.property === 'rowGap') {
      const node = findNode(tree, operation.targetNodeId) as GridNode | null
      if (node) command = { type: 'SetGridGap', nodeId: operation.targetNodeId, columnGap: operation.property === 'columnGap' ? Number(operation.proposedValue) : node.columnGap, rowGap: operation.property === 'rowGap' ? Number(operation.proposedValue) : node.rowGap }
    } else command = setPathCommand(operation)
    if (!command) return tree
    const applied = applyCommand(tree, command)
    if (operation.type === 'create' || operation.type === 'create-component-instance' || operation.type === 'delete') return applied
    return updateNode(applied, operation.targetNodeId, (node) => {
      if (node.provenance === 'existing') node.provenance = 'existing-modified'
    })
  }, baseline)
}

export function compareOperationSets(left: DesignOperation[], right: DesignOperation[]): VersionDifference[] {
  const a = new Map(left.map((operation) => [operation.id, operation]))
  const b = new Map(right.map((operation) => [operation.id, operation]))
  return [...new Set([...a.keys(), ...b.keys()])].flatMap<VersionDifference>((id) => {
    const before = a.get(id)
    const after = b.get(id)
    if (!before && after) return [{ operationId: id, kind: 'added' as const, summary: after.summary, operationType: after.type, ownerId: after.ownerId }]
    if (before && !after) return [{ operationId: id, kind: 'removed' as const, summary: before.summary, operationType: before.type, ownerId: before.ownerId }]
    if (before && after && before.revisionId !== after.revisionId) return [{ operationId: id, kind: 'changed' as const, summary: after.summary, operationType: after.type, ownerId: after.ownerId }]
    return []
  })
}
