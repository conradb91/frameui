import crypto from 'node:crypto'
import type { DesignOperation, SourceConflict, SourceConflictResolution } from '@shared/types/model/featureModel'

export const sourceValueKey = (operation: Pick<DesignOperation, 'targetNodeId' | 'property' | 'key'>): string => `${operation.targetNodeId}:${operation.property ?? operation.key}`

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  try { return JSON.stringify(left) === JSON.stringify(right) } catch { return false }
}

export interface RebaseResult {
  operations: DesignOperation[]
  conflicts: SourceConflict[]
  safelyRebased: number
}

/** Rebases semantic Design Operations against current source values. A
 * missing map entry means the target no longer resolves; `undefined` may be
 * supplied explicitly as a real current value by including the key. */
export function rebaseFeatureOperations(featureId: string, operations: DesignOperation[], currentValues: Map<string, unknown>, sourcePaths: Map<string, string> = new Map()): RebaseResult {
  const rebased: DesignOperation[] = []
  const conflicts: SourceConflict[] = []
  let safelyRebased = 0
  for (const operation of operations) {
    const key = sourceValueKey(operation)
    const exists = currentValues.has(key)
    const currentValue = currentValues.get(key)
    let kind: SourceConflict['kind']
    if (!exists) kind = 'unresolved-target'
    else if (equal(currentValue, operation.baseValue)) { rebased.push(operation); continue }
    else if (equal(operation.proposedValue, operation.baseValue)) kind = 'safe-refresh'
    else if (equal(currentValue, operation.proposedValue)) kind = 'safe-merge'
    else kind = 'same-property'

    if (kind === 'safe-refresh' || kind === 'safe-merge') {
      rebased.push({ ...operation, baseValue: currentValue, updatedAt: new Date().toISOString() })
      safelyRebased++
      continue
    }
    rebased.push(operation)
    conflicts.push({ id: crypto.randomUUID(), featureId, operationId: operation.id, ownerId: operation.ownerId, targetNodeId: operation.targetNodeId, property: operation.property, kind, baseValue: operation.baseValue, currentValue, proposedValue: operation.proposedValue, sourcePath: sourcePaths.get(operation.targetNodeId) ?? null, resolution: 'unresolved', createdAt: new Date().toISOString(), resolvedAt: null })
  }
  return { operations: rebased, conflicts, safelyRebased }
}

export function resolveSourceConflict(conflict: SourceConflict, resolution: Exclude<SourceConflictResolution, 'unresolved'>): SourceConflict {
  return { ...conflict, resolution, resolvedAt: new Date().toISOString() }
}
