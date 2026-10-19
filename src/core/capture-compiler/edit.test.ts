import { describe, expect, test } from 'bun:test'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'
import {
  applyRasterFallbacks,
  patchStructuredNode,
  findStructuredNode,
  groupStructuredNodes,
  removeStructuredNodes,
  ungroupStructuredNodes,
  updateStructuredNodeBounds,
  updateStructuredNodeText,
  visitStructuredNodes,
} from './edit'

function node(overrides: Partial<StructuredNode> = {}): StructuredNode {
  return {
    id: 'n1',
    type: 'Container',
    name: 'Container',
    parentId: null,
    children: [],
    bounds: { x: 10, y: 20, width: 100, height: 50 },
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

describe('visitStructuredNodes', () => {
  test('walks every node in the tree, depth-first', () => {
    const tree = frame([node({ id: 'a', children: [node({ id: 'b', parentId: 'a' }), node({ id: 'c', parentId: 'a' })] })])
    const seen: string[] = []
    visitStructuredNodes(tree.children, (n) => seen.push(n.id))
    expect(seen).toEqual(['a', 'b', 'c'])
  })
})

describe('findStructuredNode', () => {
  test('finds a node nested several levels deep', () => {
    const tree = frame([node({ id: 'a', children: [node({ id: 'b', children: [node({ id: 'c' })] })] })])
    expect(findStructuredNode(tree.children, 'c')?.id).toBe('c')
    expect(findStructuredNode(tree.children, 'missing')).toBeUndefined()
  })
})

describe('updateStructuredNodeBounds', () => {
  test('applies a patch immutably, leaving the input frame untouched', () => {
    const original = frame([node({ id: 'a', bounds: { x: 0, y: 0, width: 100, height: 50 } })])
    const next = updateStructuredNodeBounds(original, [{ id: 'a', bounds: { x: 40, y: 60 } }])
    expect(original.children[0].bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(next.children[0].bounds).toEqual({ x: 40, y: 60, width: 100, height: 50 })
  })

  test('handles multiple simultaneous updates in one pass (multi-select commit)', () => {
    const original = frame([
      node({ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } }),
      node({ id: 'b', bounds: { x: 100, y: 100, width: 10, height: 10 } }),
    ])
    const next = updateStructuredNodeBounds(original, [
      { id: 'a', bounds: { x: 5, y: 5 } },
      { id: 'b', bounds: { x: 105, y: 105 } },
    ])
    expect(next.children[0].bounds.x).toBe(5)
    expect(next.children[1].bounds.x).toBe(105)
  })

  test('finds and patches a nested node', () => {
    const original = frame([node({ id: 'a', children: [node({ id: 'b', bounds: { x: 1, y: 1, width: 1, height: 1 } })] })])
    const next = updateStructuredNodeBounds(original, [{ id: 'b', bounds: { width: 50 } }])
    expect(next.children[0].children[0].bounds).toEqual({ x: 1, y: 1, width: 50, height: 1 })
  })

  test('returns the same frame reference when there are no updates', () => {
    const original = frame([node()])
    expect(updateStructuredNodeBounds(original, [])).toBe(original)
  })
})

describe('applyRasterFallbacks', () => {
  test('converts a patched node to RasterFallback with the given imageSrc, clearing children', () => {
    const original = frame([
      node({ id: 'a', type: 'Container', source: { tag: 'div', classes: 'widget' }, children: [node({ id: 'a1' })] }),
    ])
    const next = applyRasterFallbacks(original, [{ id: 'a', imageSrc: 'data:image/png;base64,AAAA' }])
    const patched = next.children[0]
    expect(patched.type).toBe('RasterFallback')
    expect(patched.source).toEqual({ tag: 'div', classes: 'widget', imageSrc: 'data:image/png;base64,AAAA' })
    expect(patched.children).toEqual([])
    // Everything else (bounds, name) is untouched.
    expect(patched.bounds).toEqual(node().bounds)
  })

  test('leaves the input frame untouched and does not affect unpatched nodes', () => {
    const original = frame([node({ id: 'a' }), node({ id: 'b' })])
    const next = applyRasterFallbacks(original, [{ id: 'a', imageSrc: 'data:image/png;base64,AAAA' }])
    expect(original.children[0].type).toBe('Container')
    expect(next.children[1]).toBe(original.children[1])
  })

  test('patches a deeply nested node', () => {
    const original = frame([node({ id: 'a', children: [node({ id: 'b' })] })])
    const next = applyRasterFallbacks(original, [{ id: 'b', imageSrc: 'data:image/png;base64,BBBB' }])
    expect(next.children[0].children[0].type).toBe('RasterFallback')
  })

  test('returns the same frame reference when there are no patches', () => {
    const original = frame([node()])
    expect(applyRasterFallbacks(original, [])).toBe(original)
  })
})

describe('removeStructuredNodes', () => {
  test('removes a node and its subtree, leaving siblings untouched', () => {
    const original = frame([
      node({ id: 'a', children: [node({ id: 'a1' })] }),
      node({ id: 'b' }),
    ])
    const next = removeStructuredNodes(original, ['a'])
    expect(next.children.map((n) => n.id)).toEqual(['b'])
    expect(findStructuredNode(next.children, 'a1')).toBeUndefined()
  })

  test('removes a deeply nested node without affecting its ancestors or siblings', () => {
    const original = frame([node({ id: 'a', children: [node({ id: 'b' }), node({ id: 'c' })] })])
    const next = removeStructuredNodes(original, ['b'])
    expect(next.children[0].id).toBe('a')
    expect(next.children[0].children.map((n) => n.id)).toEqual(['c'])
  })
})

function textNode(overrides: Partial<StructuredNode> = {}): StructuredNode {
  return node({
    type: 'Text',
    typography: { text: 'Hello', fontFamily: 'sans-serif', fontSize: 16, fontWeight: '400', lineHeight: 19, letterSpacing: 0, textAlign: 'left' },
    ...overrides,
  })
}

describe('updateStructuredNodeText', () => {
  test('patches only the target node\'s typography.text, leaving siblings untouched', () => {
    const original = frame([textNode({ id: 'a' }), textNode({ id: 'b' })])
    const next = updateStructuredNodeText(original, 'a', 'Edited')
    expect(next.children[0].typography?.text).toBe('Edited')
    expect(next.children[1].typography?.text).toBe('Hello')
    expect(original.children[0].typography?.text).toBe('Hello')
  })

  test('is a no-op on a node with no typography at all', () => {
    const original = frame([node({ id: 'a' })])
    const next = updateStructuredNodeText(original, 'a', 'Edited')
    expect(next).toBe(original)
  })
})

describe('groupStructuredNodes', () => {
  test('groups >=2 free-mode siblings into a new bounding-box Group with rebased child coordinates', () => {
    const original = frame([
      node({ id: 'a', bounds: { x: 10, y: 10, width: 20, height: 20 } }),
      node({ id: 'b', bounds: { x: 50, y: 30, width: 10, height: 10 } }),
      node({ id: 'c', bounds: { x: 0, y: 0, width: 5, height: 5 } }),
    ])
    const result = groupStructuredNodes(original, ['a', 'b'])
    expect(result).toBeDefined()
    const { frame: next, groupId } = result!
    // inserted at the first member's original index (0), 'c' remains a sibling
    expect(next.children.map((n) => n.id)).toEqual([groupId, 'c'])
    const group = next.children[0]
    expect(group.type).toBe('Group')
    expect(group.bounds).toEqual({ x: 10, y: 10, width: 50, height: 30 })
    expect(group.children.find((c) => c.id === 'a')?.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 })
    expect(group.children.find((c) => c.id === 'b')?.bounds).toEqual({ x: 40, y: 20, width: 10, height: 10 })
  })

  test('is a no-op when the selected members span different parents', () => {
    const original = frame([
      node({ id: 'a', children: [node({ id: 'a1' })] }),
      node({ id: 'b' }),
    ])
    expect(groupStructuredNodes(original, ['a1', 'b'])).toBeUndefined()
  })

  test('is a no-op when the shared parent is not free-mode', () => {
    const original = frame([
      node({
        id: 'parent',
        layout: { mode: 'stack' },
        children: [node({ id: 'a', parentId: 'parent' }), node({ id: 'b', parentId: 'parent' })],
      }),
    ])
    expect(groupStructuredNodes(original, ['a', 'b'])).toBeUndefined()
  })

  test('is a no-op for a single-node selection', () => {
    const original = frame([node({ id: 'a' })])
    expect(groupStructuredNodes(original, ['a'])).toBeUndefined()
  })
})

describe('ungroupStructuredNodes', () => {
  test('flattens a real group\'s children back with restored absolute coordinates', () => {
    const grouped = frame([
      node({
        id: 'g', type: 'Group', bounds: { x: 10, y: 10, width: 50, height: 30 },
        children: [
          node({ id: 'a', parentId: 'g', bounds: { x: 0, y: 0, width: 20, height: 20 } }),
          node({ id: 'b', parentId: 'g', bounds: { x: 40, y: 20, width: 10, height: 10 } }),
        ],
      }),
    ])
    const next = ungroupStructuredNodes(grouped, ['g'])
    expect(next.children.map((n) => n.id)).toEqual(['a', 'b'])
    expect(next.children.find((n) => n.id === 'a')?.bounds).toEqual({ x: 10, y: 10, width: 20, height: 20 })
    expect(next.children.find((n) => n.id === 'b')?.bounds).toEqual({ x: 50, y: 30, width: 10, height: 10 })
  })

  test('is a no-op on a childless (compiler-artifact) Group node', () => {
    const original = frame([node({ id: 'g', type: 'Group', children: [] })])
    const next = ungroupStructuredNodes(original, ['g'])
    expect(next.children.map((n) => n.id)).toEqual(['g'])
  })
})

describe('localized edits retain untouched subtree identity', () => {
  test('bounds edits preserve siblings and no-op edits preserve the frame', () => {
    const sibling = node({id:'sibling',children:[node({id:'leaf'})]})
    const original = frame([node({id:'target'}), sibling])
    const edited = updateStructuredNodeBounds(original,[{id:'target',bounds:{width:180}}])
    expect(edited.children[1]).toBe(sibling)
    expect(original.children[0].bounds.width).toBe(100)
    expect(updateStructuredNodeBounds(edited,[{id:'target',bounds:{width:180}}])).toBe(edited)
    expect(updateStructuredNodeBounds(original,[{id:'missing',bounds:{width:180}}])).toBe(original)
  })
  test('text edits preserve siblings, ancestors change only on the edited branch', () => {
    const text = node({id:'text',type:'Text',typography:{text:'Before',fontSize:16,fontFamily:'Arial',fontWeight:'400',lineHeight:20,letterSpacing:0,textAlign:'left'}})
    const untouched=node({id:'untouched'})
    const original=frame([node({id:'parent',children:[text,untouched]}),node({id:'other'})])
    const edited=updateStructuredNodeText(original,'text','After')
    expect(edited.children[1]).toBe(original.children[1])
    expect(edited.children[0].children[1]).toBe(untouched)
    expect(edited.children[0]).not.toBe(original.children[0])
    expect(text.typography?.text).toBe('Before')
    expect(updateStructuredNodeText(edited,'text','After')).toBe(edited)
  })
})

 test('layer property edits share untouched subtrees and preserve the original',()=>{
  const original=frame([node({id:'parent',children:[node({id:'child'})]}),node({id:'sibling'})])
  const next=patchStructuredNode(original,'child',{name:'Renamed',locked:true})
  expect(next.children[0].children[0].name).toBe('Renamed')
  expect(original.children[0].children[0].locked).toBe(false)
  expect(next.children[1]).toBe(original.children[1])
  expect(patchStructuredNode(original,'missing',{name:'Unused'})).toBe(original)
})

 describe('native control text editing',()=>{
 test('edits placeholder separately from the default value and preserves source metadata',()=>{
 const original=frame([node({id:'input',source:{tag:'input',file:'Login.tsx',control:{type:'email',placeholder:'Email address',value:'saved@example.com'}}})]);
 const edited=updateStructuredNodeText(original,'input','Work email');
 expect(edited.children[0].source.control).toEqual({type:'email',placeholder:'Work email',value:'saved@example.com'});
 expect(edited.children[0].source.file).toBe('Login.tsx');expect(original.children[0].source.control?.placeholder).toBe('Email address');
 expect(updateStructuredNodeText(edited,'input','Work email')).toBe(edited);
 });
 test('edits a captured default value when no placeholder exists; respects locks',()=>{
 const original=frame([node({id:'input',source:{tag:'input',control:{type:'text',value:'Before'}}})]);
 expect(updateStructuredNodeText(original,'input','After').children[0].source.control?.value).toBe('After');
 const locked=frame([node({id:'input',locked:true,source:{tag:'input',control:{type:'text',value:'Before'}}})]);expect(updateStructuredNodeText(locked,'input','After')).toBe(locked);
 });
 });
