import { describe, expect, test } from 'bun:test'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'
import type { DiffMask } from './selectRasterFallbackCandidates'
import { selectRasterFallbackCandidates } from './selectRasterFallbackCandidates'

function node(overrides: Partial<StructuredNode> = {}): StructuredNode {
  return {
    id: 'n1',
    type: 'Image',
    name: 'Image',
    parentId: null,
    children: [],
    bounds: { x: 0, y: 0, width: 40, height: 40 },
    layout: { mode: 'free' },
    appearance: { radius: [0, 0, 0, 0], opacity: 1, rotation: 0, clip: false },
    source: { tag: 'video' },
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

/** Every pixel differs, everywhere in an arbitrarily large frame. */
const ALL_DIFF: DiffMask = { width: 10000, height: 10000, hasDiff: () => true }
/** No pixel ever differs. */
const NO_DIFF: DiffMask = { width: 10000, height: 10000, hasDiff: () => false }

describe('selectRasterFallbackCandidates', () => {
  test('a leaf whose rect is entirely within an all-diff mask is selected', () => {
    const candidates = selectRasterFallbackCandidates(frame([node()]), ALL_DIFF)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ nodeId: 'n1', rect: { x: 0, y: 0, width: 40, height: 40 }, diffRatio: 1 })
  })

  test('a leaf under the diff-ratio threshold is not selected', () => {
    const candidates = selectRasterFallbackCandidates(frame([node()]), NO_DIFF)
    expect(candidates).toHaveLength(0)
  })

  test('a Text leaf is never selected, even with a fully-diffing mask', () => {
    const candidates = selectRasterFallbackCandidates(
      frame([node({ type: 'Text', typography: { text: 'hi', fontFamily: 'sans-serif', fontSize: 16, fontWeight: '400', lineHeight: 19, letterSpacing: 0, textAlign: 'left' } })]),
      ALL_DIFF,
    )
    expect(candidates).toHaveLength(0)
  })

  test('a node already RasterFallback is never selected again', () => {
    const candidates = selectRasterFallbackCandidates(frame([node({ type: 'RasterFallback' })]), ALL_DIFF)
    expect(candidates).toHaveLength(0)
  })

  test('a tiny node under the minimum area is excluded', () => {
    const candidates = selectRasterFallbackCandidates(frame([node({ bounds: { x: 0, y: 0, width: 5, height: 5 } })]), ALL_DIFF)
    expect(candidates).toHaveLength(0)
  })

  test('a non-leaf container is never a candidate, even fully diffing — only its diffing leaf child is', () => {
    const child = node({ id: 'child', bounds: { x: 5, y: 5, width: 40, height: 40 } })
    const container = node({ id: 'container', type: 'Container', children: [child], bounds: { x: 0, y: 0, width: 100, height: 100 } })
    const candidates = selectRasterFallbackCandidates(frame([container]), ALL_DIFF)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].nodeId).toBe('child')
  })

  test('a deeply nested leaf accumulates its absolute rect from every ancestor, not just its immediate parent', () => {
    const grandchild = node({ id: 'grandchild', bounds: { x: 10, y: 10, width: 40, height: 40 } })
    const child = node({ id: 'child', type: 'Container', children: [grandchild], bounds: { x: 20, y: 20, width: 100, height: 100 } })
    const root = node({ id: 'root', type: 'Container', children: [child], bounds: { x: 30, y: 30, width: 200, height: 200 } })
    const candidates = selectRasterFallbackCandidates(frame([root]), ALL_DIFF)
    expect(candidates).toHaveLength(1)
    // 30 + 20 + 10 = 60 for both x and y.
    expect(candidates[0].rect).toEqual({ x: 60, y: 60, width: 40, height: 40 })
  })

  test('a custom diffRatioThreshold is respected', () => {
    // The node spans x:0-40; only x<20 differs, so exactly half its area
    // (diffRatio 0.5) differs.
    const mask: DiffMask = { width: 100, height: 100, hasDiff: (x) => x < 20 }
    expect(selectRasterFallbackCandidates(frame([node()]), mask)).toHaveLength(1) // 0.5 > default 0.15
    expect(selectRasterFallbackCandidates(frame([node()]), mask, { diffRatioThreshold: 0.6 })).toHaveLength(0) // 0.5 is not > 0.6
  })

  test('a custom minArea is respected', () => {
    const smallNode = node({ bounds: { x: 0, y: 0, width: 15, height: 15 } }) // area 225, under the default 400 floor
    expect(selectRasterFallbackCandidates(frame([smallNode]), ALL_DIFF)).toHaveLength(0)
    expect(selectRasterFallbackCandidates(frame([smallNode]), ALL_DIFF, { minArea: 100 })).toHaveLength(1)
  })
})

test('visual differences never flatten supported gradients, controls, images or vectors',()=>{
 const nodes=[node({id:'gradient',type:'Group',source:{tag:'div'},appearance:{radius:[0,0,0,0],opacity:1,rotation:0,clip:false,backgroundImage:'radial-gradient(red, transparent)'}}),node({id:'input',type:'Container',source:{tag:'input',control:{type:'text'}}}),node({id:'image',source:{tag:'img'}}),node({id:'svg',type:'SVG',source:{tag:'svg'}})];expect(selectRasterFallbackCandidates(frame(nodes),ALL_DIFF)).toHaveLength(0);
});
