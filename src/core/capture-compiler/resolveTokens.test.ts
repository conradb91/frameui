import { describe, expect, test } from 'bun:test'
import type { Token } from '@shared/types/model/projectModel'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'
import { resolveStructuredTokens } from './resolveTokens'

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

function token(overrides: Partial<Token> = {}): Token {
  return { id: 't1', category: 'color', name: 'primary', value: '#3b82f6', confidence: 'full', ...overrides }
}

describe('resolveStructuredTokens', () => {
  test('resolves an exact hex-vs-rgb color match', () => {
    const original = frame([node({ tokenBindings: { backgroundColor: { value: 'rgb(59, 130, 246)' } } })])
    const next = resolveStructuredTokens(original, [token({ name: 'primary', value: '#3b82f6' })])
    expect(next.children[0].tokenBindings?.backgroundColor).toEqual({ value: 'rgb(59, 130, 246)', token: 'primary' })
  })

  test('resolves a near-but-not-identical color within the distance threshold', () => {
    // #3b82f6 = (59,130,246); a value a few units off in each channel stays under the ≤18 Euclidean threshold.
    const original = frame([node({ tokenBindings: { color: { value: 'rgb(62, 133, 249)' } } })])
    const next = resolveStructuredTokens(original, [token({ name: 'primary', value: '#3b82f6' })])
    expect(next.children[0].tokenBindings?.color?.token).toBe('primary')
  })

  test('does not resolve a color well outside the distance threshold', () => {
    const original = frame([node({ tokenBindings: { color: { value: 'rgb(200, 30, 10)' } } })])
    const next = resolveStructuredTokens(original, [token({ name: 'primary', value: '#3b82f6' })])
    expect(next.children[0].tokenBindings?.color?.token).toBeUndefined()
  })

  test('resolves exact spacing/radius/typography matches', () => {
    const original = frame([
      node({
        id: 'a',
        tokenBindings: {
          padding: { value: '16px' },
          borderRadius: { value: '6px' },
          fontSize: { value: '32px' },
        },
      }),
    ])
    const tokens: Token[] = [
      token({ category: 'spacing', name: 'space-4', value: '16px' }),
      token({ category: 'radius', name: 'radius-md', value: '6px' }),
      token({ category: 'typography', name: 'heading-lg', value: '32px' }),
    ]
    const next = resolveStructuredTokens(original, tokens)
    const bindings = next.children[0].tokenBindings!
    expect(bindings.padding?.token).toBe('space-4')
    expect(bindings.borderRadius?.token).toBe('radius-md')
    expect(bindings.fontSize?.token).toBe('heading-lg')
  })

  test('never matches an unresolved-confidence token, even with an identical value', () => {
    const original = frame([node({ tokenBindings: { backgroundColor: { value: '#3b82f6' } } })])
    const next = resolveStructuredTokens(original, [token({ confidence: 'unresolved' })])
    expect(next.children[0].tokenBindings?.backgroundColor?.token).toBeUndefined()
  })

  test('leaves .value untouched and .token undefined when nothing matches anywhere', () => {
    const original = frame([node({ tokenBindings: { backgroundColor: { value: '#ffffff' } } })])
    const next = resolveStructuredTokens(original, [token({ value: '#3b82f6' })])
    expect(next.children[0].tokenBindings?.backgroundColor).toEqual({ value: '#ffffff' })
  })

  test('never cross-matches a token from the wrong category', () => {
    // A spacing token whose value happens to equal a captured color string must never resolve a color binding.
    const original = frame([node({ tokenBindings: { backgroundColor: { value: '16px' } } })])
    const next = resolveStructuredTokens(original, [token({ category: 'spacing', name: 'space-4', value: '16px' })])
    expect(next.children[0].tokenBindings?.backgroundColor?.token).toBeUndefined()
  })

  test('returns the same frame reference when there are no tokens at all', () => {
    const original = frame([node({ tokenBindings: { backgroundColor: { value: '#fff' } } })])
    expect(resolveStructuredTokens(original, [])).toBe(original)
  })

  test('resolves bindings on deeply nested nodes', () => {
    const original = frame([node({ id: 'a', children: [node({ id: 'b', tokenBindings: { color: { value: '#3b82f6' } } })] })])
    const next = resolveStructuredTokens(original, [token({ name: 'primary', value: '#3b82f6' })])
    expect(next.children[0].children[0].tokenBindings?.color?.token).toBe('primary')
  })
})
