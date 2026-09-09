import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { DesignNode } from '@shared/types/designNode'
import { applyDesignOperations, composeDesignOperations } from './operations'

const baseline: DesignNode = {
  id: 'root', kind: 'stack', editability: 'editable', provenance: 'existing', direction: 'column', gap: 16, align: 'stretch', children: [
    { id: 'title', kind: 'heading', editability: 'editable', provenance: 'existing', content: 'Save', children: [] },
    { id: 'grid', kind: 'grid', editability: 'editable', provenance: 'existing', columns: 3, columnGap: 16, rowGap: 16, children: [] },
  ],
}
const context = { featureId: 'feature', ownerId: 'state.default', designStateId: 'state.default', alternativeId: null, pageRef: { kind: 'existing' as const, pageId: 'page.dashboard' } }

describe('semantic Design Operations', () => {
  test('composes repeated property edits and removes intent at the base value', () => {
    let operations = composeDesignOperations(baseline, [], { type: 'SetGap', nodeId: 'root', gap: 24 }, context)
    operations = composeDesignOperations(baseline, operations, { type: 'SetGap', nodeId: 'root', gap: 32 }, context)
    assert.equal(operations.length, 1)
    assert.equal(operations[0].baseValue, 16)
    assert.equal(operations[0].proposedValue, 32)
    const stableId = operations[0].id
    operations = composeDesignOperations(baseline, operations, { type: 'SetGap', nodeId: 'root', gap: 16 }, context)
    assert.equal(operations.length, 0)
    assert.ok(stableId)
  })

  test('materializes text, layout, reorder and responsive intent without mutating Current', () => {
    let operations = composeDesignOperations(baseline, [], { type: 'SetText', nodeId: 'title', content: 'Save Bill' }, context)
    operations = composeDesignOperations(baseline, operations, { type: 'SetGridColumns', nodeId: 'grid', columns: 2 }, context)
    operations = composeDesignOperations(baseline, operations, { type: 'MoveNode', nodeId: 'grid', newParentId: 'root', newIndex: 0 }, context)
    operations = composeDesignOperations(baseline, operations, { type: 'SetResponsiveOverride', nodeId: 'root', breakpoint: 'mobile', override: { direction: 'row', gap: 8 } }, context)
    const proposed = applyDesignOperations(baseline, operations)
    assert.equal(proposed.children[0].id, 'grid')
    assert.equal((proposed.children[0] as Extract<DesignNode, { kind: 'grid' }>).columns, 2)
    assert.equal((proposed.children[1] as Extract<DesignNode, { kind: 'heading' }>).content, 'Save Bill')
    assert.equal(proposed.responsiveOverrides?.mobile?.gap, 8)
    assert.equal(proposed.provenance, 'existing-modified')
    assert.equal(proposed.children[1].provenance, 'existing-modified')
    assert.equal(baseline.children[0].id, 'title')
    assert.equal(baseline.responsiveOverrides, undefined)
  })

  test('responsive overrides inherit a changed base after removal', () => {
    let operations = composeDesignOperations(baseline, [], { type: 'SetGap', nodeId: 'root', gap: 32 }, context)
    operations = composeDesignOperations(baseline, operations, { type: 'SetResponsiveOverride', nodeId: 'root', breakpoint: 'mobile', override: { gap: 8 } }, context)
    assert.equal(applyDesignOperations(baseline, operations).responsiveOverrides?.mobile?.gap, 8)
    operations = composeDesignOperations(baseline, operations, { type: 'SetResponsiveOverride', nodeId: 'root', breakpoint: 'mobile', override: null }, context)
    const proposed = applyDesignOperations(baseline, operations)
    assert.equal((proposed as Extract<DesignNode, { kind: 'stack' }>).gap, 32)
    assert.equal(proposed.responsiveOverrides?.mobile, undefined)
    assert.equal(operations.filter((item) => item.breakpoint === 'mobile').length, 0)
  })

  test('an inserted concept component is structured and insert-delete cancels', () => {
    const concept: DesignNode = { id: 'concept-1', kind: 'concept', editability: 'editable', provenance: 'new', conceptComponentId: 'component.payment_progress', variantId: null, propertyValues: {}, children: [] }
    let operations = composeDesignOperations(baseline, [], { type: 'InsertComponent', parentId: 'root', index: 1, node: concept }, context)
    assert.equal(operations[0].type, 'create-component-instance')
    assert.equal(applyDesignOperations(baseline, operations).children[1].id, 'concept-1')
    operations = composeDesignOperations(baseline, operations, { type: 'DeleteNode', nodeId: 'concept-1' }, context)
    assert.equal(operations.length, 0)
  })
})
