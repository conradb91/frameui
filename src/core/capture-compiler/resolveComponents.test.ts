import { describe, expect, test } from 'bun:test'
import type { Component } from '@shared/types/model/projectModel'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'
import { resolveStructuredComponents } from './resolveComponents'

function node(overrides: Partial<StructuredNode> = {}): StructuredNode {
  return {
    id: 'n1',
    type: 'Container',
    name: 'Container',
    parentId: null,
    children: [],
    bounds: { x: 0, y: 0, width: 100, height: 50 },
    layout: { mode: 'free' },
    appearance: { radius: [0, 0, 0, 0], opacity: 1, rotation: 0, clip: false },
    source: { tag: 'div' },
    constraints: { position: 'static' },
    visibility: true,
    locked: false,
    ...overrides,
  }
}

function frame(children: StructuredNode[]): StructuredFrame {
  return {
    id: 'f1', name: 'Homepage', viewport: '1440x900', sourceRoute: '/home',
    width: 1440, height: 900, children,
    captureMetadata: { capturedAt: new Date().toISOString(), engine: 'domSnapshot', structuredNodeCount: children.length, durationMs: 1 },
  }
}

function component(overrides: Partial<Component> = {}): Component {
  return { id: 'c1', name: 'PrimaryButton', exportKind: 'default', source: { filePath: 'src/components/PrimaryButton.tsx' }, ...overrides }
}

describe('resolveStructuredComponents', () => {
  test('an exact componentHint match promotes the node to ComponentInstance with a confidence-1 binding', () => {
    const original = frame([node({ source: { tag: 'button', component: 'Primary Button' } })])
    const next = resolveStructuredComponents(original, [component()])
    const resolved = next.children[0]
    expect(resolved.type).toBe('ComponentInstance')
    expect(resolved.componentBinding).toEqual({ componentId: 'c1', confidence: 1 })
    expect(resolved.captureConfidence).toEqual({ componentConfidence: 1 })
  })

  test('no matching component in the index leaves the node untouched', () => {
    const original = frame([node({ source: { tag: 'button', component: 'Primary Button' } })])
    const next = resolveStructuredComponents(original, [component({ name: 'SecondaryButton' })])
    const resolved = next.children[0]
    expect(resolved.type).toBe('Container')
    expect(resolved.componentBinding).toBeUndefined()
  })

  test('a node with no componentHint at all is left untouched, no crash', () => {
    const original = frame([node()])
    const next = resolveStructuredComponents(original, [component()])
    expect(next.children[0]).toBe(original.children[0])
  })

  test('a nested child resolves independently of its non-matching parent', () => {
    const child = node({ id: 'child', source: { tag: 'button', component: 'Primary Button' } })
    const parent = node({ id: 'parent', children: [child] })
    const next = resolveStructuredComponents(frame([parent]), [component()])
    expect(next.children[0].type).toBe('Container')
    expect(next.children[0].children[0].type).toBe('ComponentInstance')
  })

  test('an empty components array returns the frame unchanged by reference', () => {
    const original = frame([node({ source: { tag: 'button', component: 'Primary Button' } })])
    expect(resolveStructuredComponents(original, [])).toBe(original)
  })
})
