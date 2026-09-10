import { describe, expect, test } from 'bun:test'
import type { DesignOperation } from '@shared/types/model/featureModel'
import { rebaseFeatureOperations, sourceValueKey } from './rebaseFeatureOperations'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'

function operation(property: string, baseValue: unknown, proposedValue: unknown): DesignOperation {
  return { id: `op-${property}`, revisionId: `revision-${property}`, featureId: 'feature', ownerId: 'owner', pageRef: { kind: 'existing', pageId: 'page' }, designStateId: 'state.default', alternativeId: null, type: 'set-property', targetNodeId: 'button', key: `button:set-property:${property}`, summary: property, property, breakpoint: null, baseValue, proposedValue, node: null, parentId: null, index: null, createdAt: '', updatedAt: '' }
}

describe('three-way source rebasing', () => {
  test('preserves a designer change when source changed another operation', () => {
    const padding = operation('padding', 16, 24)
    const copy = operation('text', 'Save', 'Submit')
    const values = new Map<string, unknown>([[sourceValueKey(padding), 16], [sourceValueKey(copy), 'Save now']])
    const result = rebaseFeatureOperations('feature', [padding, copy], values)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].property).toBe('text')
    expect(result.operations[0].proposedValue).toBe(24)
  })

  test('marks missing stable targets unresolved instead of retargeting', () => {
    const result = rebaseFeatureOperations('feature', [operation('padding', 16, 24)], new Map())
    expect(result.conflicts[0].kind).toBe('unresolved-target')
    expect(result.conflicts[0].targetNodeId).toBe('button')
  })

  test('source-derived node identities survive reparsing and file renames', () => {
    const structure = [{ tagName: 'main', isKnownComponent: false, children: [{ tagName: 'button', isKnownComponent: false, children: [], textPreview: 'Save' }] }]
    const first = buildExistingPageDraftTree('root', structure, 'src/Old.tsx')
    const renamed = buildExistingPageDraftTree('root', structure, 'src/New.tsx')
    expect(first.children[0].id).toBe(renamed.children[0].id)
    expect(first.children[0].children[0].id).toBe(renamed.children[0].children[0].id)
  })
})
