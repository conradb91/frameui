import { describe, expect, test } from 'bun:test'
import type { Protocol } from 'devtools-protocol'
import { reconstructSnapshotTree } from '../../../src/main/ipc/handlers/cdp/reconstructSnapshotTree'

type NodeSpec = {
  tag: string
  parent: number
  nodeType?: number
  attributes?: Record<string, string>
  text?: string
  pseudoType?: 'before' | 'after' | 'marker'
  shadowRootType?: 'open' | 'closed'
  currentSourceURL?: string
}
type LayoutSpec = {
  node: number
  bounds: [number, number, number, number]
  styles?: Record<string, string>
  text?: string
}
type TextBoxSpec = {
  layoutIndex: number
  bounds: [number, number, number, number]
  start: number
  length: number
}

/** Hand-builds a `DOMSnapshot.captureSnapshot`-shaped response from a
 * readable node/layout description, so fixtures stay legible instead of
 * requiring every index to be computed by hand. */
function buildSnapshot(opts: {
  nodes: NodeSpec[]
  layout: LayoutSpec[]
  textBoxes?: TextBoxSpec[]
  requestedStyles: string[]
  scrollOffsetX?: number
  scrollOffsetY?: number
}): Protocol.DOMSnapshot.CaptureSnapshotResponse {
  const strings: string[] = []
  const interned = new Map<string, number>()
  const intern = (s: string): number => {
    const existing = interned.get(s)
    if (existing !== undefined) return existing
    const index = strings.length
    strings.push(s)
    interned.set(s, index)
    return index
  }

  const parentIndex: number[] = []
  const nodeType: number[] = []
  const nodeName: number[] = []
  const nodeValue: number[] = []
  const attributes: number[][] = []
  const shadowRootType: Protocol.DOMSnapshot.RareStringData = { index: [], value: [] }
  const pseudoType: Protocol.DOMSnapshot.RareStringData = { index: [], value: [] }
  const currentSourceURL: Protocol.DOMSnapshot.RareStringData = { index: [], value: [] }

  opts.nodes.forEach((n, i) => {
    parentIndex.push(n.parent)
    nodeType.push(n.nodeType ?? (n.tag === '#text' ? 3 : n.tag === '#document' ? 9 : 1))
    nodeName.push(intern(n.tag === '#text' ? '' : n.tag))
    nodeValue.push(intern(n.text ?? ''))
    const attrPairs: number[] = []
    for (const [key, value] of Object.entries(n.attributes ?? {})) attrPairs.push(intern(key), intern(value))
    attributes.push(attrPairs)
    if (n.shadowRootType) {
      shadowRootType.index.push(i)
      shadowRootType.value.push(intern(n.shadowRootType))
    }
    if (n.pseudoType) {
      pseudoType.index.push(i)
      pseudoType.value.push(intern(n.pseudoType))
    }
    if (n.currentSourceURL) {
      currentSourceURL.index.push(i)
      currentSourceURL.value.push(intern(n.currentSourceURL))
    }
  })

  const layoutNodeIndex: number[] = []
  const layoutStyles: number[][] = []
  const layoutBounds: number[][] = []
  const layoutText: number[] = []
  opts.layout.forEach((l) => {
    layoutNodeIndex.push(l.node)
    layoutBounds.push([...l.bounds])
    layoutText.push(intern(l.text ?? ''))
    layoutStyles.push(opts.requestedStyles.map((prop) => intern(l.styles?.[prop] ?? '')))
  })

  const textBoxLayoutIndex: number[] = []
  const textBoxBounds: number[][] = []
  const textBoxStart: number[] = []
  const textBoxLength: number[] = []
  for (const t of opts.textBoxes ?? []) {
    textBoxLayoutIndex.push(t.layoutIndex)
    textBoxBounds.push([...t.bounds])
    textBoxStart.push(t.start)
    textBoxLength.push(t.length)
  }

  return {
    documents: [
      {
        documentURL: intern('https://example.test/'),
        title: intern(''),
        baseURL: intern('https://example.test/'),
        contentLanguage: intern(''),
        encodingName: intern('UTF-8'),
        publicId: intern(''),
        systemId: intern(''),
        frameId: intern('frame-1'),
        nodes: {
          parentIndex,
          nodeType,
          nodeName,
          nodeValue,
          attributes,
          shadowRootType: shadowRootType.index.length ? shadowRootType : undefined,
          pseudoType: pseudoType.index.length ? pseudoType : undefined,
          currentSourceURL: currentSourceURL.index.length ? currentSourceURL : undefined,
        },
        layout: {
          nodeIndex: layoutNodeIndex,
          styles: layoutStyles,
          bounds: layoutBounds,
          text: layoutText,
          stackingContexts: { index: [] },
        },
        textBoxes: {
          layoutIndex: textBoxLayoutIndex,
          bounds: textBoxBounds,
          start: textBoxStart,
          length: textBoxLength,
        },
        scrollOffsetX: opts.scrollOffsetX ?? 0,
        scrollOffsetY: opts.scrollOffsetY ?? 0,
      },
    ],
    strings,
  }
}

describe('reconstructSnapshotTree', () => {
  test('normalizes device-pixel snapshot bounds to CSS-pixel canvas bounds', () => {
    const snapshot = buildSnapshot({
      nodes: [
        { tag: '#document', parent: -1 },
        { tag: 'HTML', parent: 0 },
        { tag: 'BODY', parent: 1 },
        { tag: 'SECTION', parent: 2 },
        { tag: '#text', parent: 3, text: 'Below the fold' },
      ],
      layout: [
        { node: 2, bounds: [0, 0, 2880, 6000] },
        { node: 3, bounds: [0, 3000, 2880, 300] },
        { node: 4, bounds: [40, 3020, 400, 40], text: 'Below the fold' },
      ],
      requestedStyles: [],
    })
    const root = reconstructSnapshotTree(snapshot, [], { width: 1440, height: 1024 }, 2).children[0]
    expect(root.rect).toEqual({ x: 0, y: 0, width: 1440, height: 3000 })
    expect(root.children[0].rect.y).toBe(1500)
    expect(root.children[0].children[0].rect).toEqual({ x: 20, y: 1510, width: 200, height: 20 })
  })
  test('applies scroll-offset correction and the attribute allowlist', () => {
    const requestedStyles = ['display', 'padding']
    const snapshot = buildSnapshot({
      nodes: [
        { tag: '#document', parent: -1 },
        { tag: 'HTML', parent: 0 },
        { tag: 'BODY', parent: 1 },
        {
          tag: 'DIV',
          parent: 2,
          attributes: { 'data-frameui-source': 'App.tsx', 'data-testid': 'wrapper', class: 'wrapper' },
        },
        { tag: 'SPAN', parent: 3, attributes: { role: 'button' } },
        { tag: '#text', parent: 4, text: 'Hello' },
      ],
      layout: [
        { node: 2, bounds: [0, 0, 300, 200], styles: { display: 'block' } },
        { node: 3, bounds: [100, 100, 200, 50], styles: { display: 'flex', padding: '8px' } },
        { node: 4, bounds: [108, 108, 50, 20], styles: { display: 'inline' } },
        { node: 5, bounds: [108, 108, 50, 20], text: 'Hello' },
      ],
      requestedStyles,
      scrollOffsetX: 10,
      scrollOffsetY: 20,
    })

    const root = reconstructSnapshotTree(snapshot, requestedStyles, { width: 300, height: 200 }).children[0]

    expect(root.tag).toBe('body')
    expect(root.rect).toEqual({ x: -10, y: -20, width: 300, height: 200 })

    const div = root.children[0]
    expect(div.tag).toBe('div')
    expect(div.rect).toEqual({ x: 90, y: 80, width: 200, height: 50 })
    expect(div.styles.display).toBe('flex')
    expect(div.styles.padding).toBe('8px')
    expect(div.classes).toBe('wrapper')
    expect(div.attributes).toEqual({ 'data-frameui-source': 'App.tsx' })

    const span = div.children[0]
    expect(span.tag).toBe('span')
    expect(span.rect).toEqual({ x: 98, y: 88, width: 50, height: 20 })
    expect(span.attributes?.captureSelector).toBe('html>body:nth-child(1)>div:nth-child(1)>span:nth-child(1)')

    const text = span.children[0]
    expect(text.tag).toBe('frameui-text')
    expect(text.textPreview).toBe('Hello')
    expect(text.rect).toEqual({ x: 98, y: 88, width: 50, height: 20 })
  })

  test('drops a display:none subtree entirely (no layout entry anywhere in it)', () => {
    const requestedStyles = ['display']
    const snapshot = buildSnapshot({
      nodes: [
        { tag: '#document', parent: -1 },
        { tag: 'HTML', parent: 0 },
        { tag: 'BODY', parent: 1 },
        { tag: 'DIV', parent: 2 },
        { tag: 'SPAN', parent: 3 },
      ],
      layout: [{ node: 2, bounds: [0, 0, 100, 100] }],
      requestedStyles,
    })

    const root = reconstructSnapshotTree(snapshot, requestedStyles, { width: 100, height: 100 }).children[0]
    expect(root.children).toEqual([])
  })

  test('a display:contents wrapper with no layout entry attaches its captured children to the nearest ancestor, instead of dropping the subtree', () => {
    const requestedStyles = ['display']
    const snapshot = buildSnapshot({
      nodes: [
        { tag: '#document', parent: -1 },
        { tag: 'HTML', parent: 0 },
        { tag: 'BODY', parent: 1 },
        { tag: 'DIV', parent: 2, attributes: { style: 'display:contents' } },
        { tag: 'BUTTON', parent: 3, text: 'Save' },
        { tag: 'BUTTON', parent: 3, text: 'Cancel' },
      ],
      layout: [
        { node: 2, bounds: [0, 0, 300, 100] },
        { node: 4, bounds: [10, 10, 80, 30] },
        { node: 5, bounds: [100, 10, 80, 30] },
      ],
      requestedStyles,
    })

    const root = reconstructSnapshotTree(snapshot, requestedStyles, { width: 300, height: 100 }).children[0]
    // The `div` wrapper itself must not appear — its two buttons become
    // direct children of `body`, not dropped along with the wrapper.
    expect(root.children).toHaveLength(2)
    expect(root.children.map((c) => c.tag)).toEqual(['button', 'button'])
    expect(root.children[0].rect).toEqual({ x: 10, y: 10, width: 80, height: 30 })
    expect(root.children[1].rect).toEqual({ x: 100, y: 10, width: 80, height: 30 })
  })

  test('preserves opacity:0 elements that still have a real layout entry, rather than treating zero opacity as a drop signal', () => {
    const requestedStyles = ['opacity']
    const snapshot = buildSnapshot({
      nodes: [
        { tag: '#document', parent: -1 },
        { tag: 'HTML', parent: 0 },
        { tag: 'BODY', parent: 1 },
        { tag: 'DIV', parent: 2 },
      ],
      layout: [
        { node: 2, bounds: [0, 0, 100, 100] },
        { node: 3, bounds: [0, 0, 50, 50], styles: { opacity: '0' } },
      ],
      requestedStyles,
    })

    const root = reconstructSnapshotTree(snapshot, requestedStyles, { width: 100, height: 100 }).children[0]
    expect(root.children).toHaveLength(1)
    expect(root.children[0].styles.opacity).toBe('0')
  })

  test('reconstructs a ::before pseudo-element as a frameui-visual leaf using its own layout box', () => {
    const requestedStyles = ['color']
    const snapshot = buildSnapshot({
      nodes: [
        { tag: '#document', parent: -1 },
        { tag: 'HTML', parent: 0 },
        { tag: 'BODY', parent: 1 },
        { tag: 'SPAN', parent: 2 },
        { tag: '', parent: 3, pseudoType: 'before' },
        { tag: '#text', parent: 4, text: '»' },
      ],
      layout: [
        { node: 2, bounds: [0, 0, 100, 100] },
        { node: 3, bounds: [0, 0, 20, 20] },
        { node: 4, bounds: [20, 0, 10, 10], styles: { color: 'rgb(0, 0, 0)' } },
      ],
      requestedStyles,
    })

    const root = reconstructSnapshotTree(snapshot, requestedStyles, { width: 100, height: 100 }).children[0]
    const span = root.children[0]
    expect(span.children).toHaveLength(1)
    const pseudo = span.children[0]
    expect(pseudo.tag).toBe('frameui-visual')
    expect(pseudo.children[0].textPreview).toBe('»')
    expect(pseudo.rect).toEqual({ x: 20, y: 0, width: 10, height: 10 })
    expect(pseudo.styles.color).toBe('rgb(0, 0, 0)')
  })

  test('merges a wrapped text node\'s per-line text boxes into one leaf spanning all lines', () => {
    const requestedStyles: string[] = []
    const snapshot = buildSnapshot({
      nodes: [
        { tag: '#document', parent: -1 },
        { tag: 'HTML', parent: 0 },
        { tag: 'BODY', parent: 1 },
        { tag: 'P', parent: 2 },
        // Raw nodeValue is the un-transformed source text; `layout.text`
        // below holds what `text-transform: uppercase` actually rendered —
        // if the reconstruction fell back to slicing raw nodeValue, this
        // assertion would see "hello world" instead.
        { tag: '#text', parent: 3, text: 'hello world' },
      ],
      layout: [
        { node: 2, bounds: [0, 0, 100, 100] },
        { node: 3, bounds: [0, 0, 100, 40] },
        { node: 4, bounds: [0, 0, 100, 40], text: 'HELLO WORLD' },
      ],
      textBoxes: [
        { layoutIndex: 2, bounds: [0, 0, 50, 20], start: 0, length: 5 },
        { layoutIndex: 2, bounds: [0, 20, 50, 20], start: 6, length: 5 },
      ],
      requestedStyles,
    })

    const root = reconstructSnapshotTree(snapshot, requestedStyles, { width: 100, height: 100 }).children[0]
    const p = root.children[0]
    // A single wrapped text node must stay one leaf, not one per rendered
    // line, or wrapped paragraphs/headings fracture into sibling elements
    // in the design model.
    expect(p.children.map((c) => c.textPreview)).toEqual(['HELLO WORLD'])
    expect(p.children.map((c) => c.rect)).toEqual([
      { x: 0, y: 0, width: 50, height: 40 },
    ])
  })

  test('keeps nested inline elements and their own text separate, rather than collapsing them', () => {
    const requestedStyles: string[] = []
    const snapshot = buildSnapshot({
      nodes: [
        { tag: '#document', parent: -1 },
        { tag: 'HTML', parent: 0 },
        { tag: 'BODY', parent: 1 },
        { tag: 'P', parent: 2 },
        { tag: '#text', parent: 3, text: 'Hello ' },
        { tag: 'B', parent: 3 },
        { tag: '#text', parent: 5, text: 'world' },
      ],
      layout: [
        { node: 2, bounds: [0, 0, 100, 100] },
        { node: 3, bounds: [0, 0, 100, 20] },
        { node: 4, bounds: [0, 0, 40, 20], text: 'Hello ' },
        { node: 5, bounds: [40, 0, 40, 20] },
        { node: 6, bounds: [40, 0, 40, 20], text: 'world' },
      ],
      requestedStyles,
    })

    const root = reconstructSnapshotTree(snapshot, requestedStyles, { width: 100, height: 100 }).children[0]
    const p = root.children[0]
    expect(p.children).toHaveLength(2)
    expect(p.children[0].tag).toBe('frameui-text')
    expect(p.children[0].textPreview).toBe('Hello ')
    expect(p.children[1].tag).toBe('b')
    expect(p.children[1].children).toHaveLength(1)
    expect(p.children[1].children[0].textPreview).toBe('world')
  })
})

test('viewport root preserves body margin and fractional text geometry without inherited box paint', () => {
  const requestedStyles = ['fontSize', 'lineHeight', 'borderWidth', 'backgroundColor', 'whiteSpace']
  const snapshot = buildSnapshot({
    nodes: [{ tag: '#document', parent: -1 }, { tag: 'HTML', parent: 0 }, { tag: 'BODY', parent: 1 }, { tag: '#text', parent: 2, text: '  indented\n    next' }],
    layout: [
      { node: 2, bounds: [8, 8, 374, 100], styles: { backgroundColor: 'white' } },
      { node: 3, bounds: [20.25, 22.5, 110.5, 40], text: '  indented\n    next', styles: { whiteSpace: 'pre', fontSize: '16px', lineHeight: '20px', borderWidth: '2px', backgroundColor: 'red' } },
    ], requestedStyles,
  })
  const root = reconstructSnapshotTree(snapshot, requestedStyles, { width: 390, height: 844 })
  expect(root.rect).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  expect(root.children[0].rect.x).toBe(8)
  const text = root.children[0].children[0]
  expect(text.textPreview).toBe('  indented\n    next')
  expect(text.rect.x).toBe(20.25)
  expect(text.styles.borderWidth).toBeUndefined()
  expect(text.styles.backgroundColor).toBeUndefined()
})

test('image overlays keep CSS pseudo-element painting order even when CDP lists after first',()=>{
 const requestedStyles=['backgroundColor']
 const snapshot=buildSnapshot({requestedStyles,nodes:[{tag:'#document',parent:-1},{tag:'HTML',parent:0},{tag:'BODY',parent:1},{tag:'SECTION',parent:2},{tag:'::after',parent:3,pseudoType:'after'},{tag:'DIV',parent:3},{tag:'::before',parent:3,pseudoType:'before'}],layout:[{node:2,bounds:[0,0,100,100]},{node:3,bounds:[0,0,100,100]},{node:4,bounds:[0,0,100,100],styles:{backgroundColor:'white'}},{node:5,bounds:[0,0,100,100],styles:{backgroundColor:'blue'}},{node:6,bounds:[0,0,100,100],styles:{backgroundColor:'red'}}]})
 const root=reconstructSnapshotTree(snapshot,requestedStyles,{width:100,height:100})
 const section=root.children[0].children[0]
 expect(section.children.map(n=>n.styles.backgroundColor)).toEqual(['red','blue','white'])
})

test('wide sibling sets preserve nth-child selectors while pseudo elements do not shift real elements',()=>{
 const count=8000,nodes:NodeSpec[]=[{tag:'#document',parent:-1},{tag:'HTML',parent:0},{tag:'BODY',parent:1},{tag:'::before',parent:2,pseudoType:'before'}]
 for(let i=0;i<count;i++)nodes.push({tag:'BUTTON',parent:2})
 const layout:LayoutSpec[]=[{node:2,bounds:[0,0,100,100]},...Array.from({length:count},(_,i)=>({node:i+4,bounds:[0,i,80,1] as [number,number,number,number]}))]
 const started=performance.now(),root=reconstructSnapshotTree(buildSnapshot({nodes,layout,requestedStyles:[]}),[],{width:100,height:100})
 expect(root.children[0].children.at(-1)?.attributes?.captureSelector).toBe('html>body:nth-child(1)>button:nth-child(8000)')
 console.log(`8000 sibling capture selectors reconstructed in ${(performance.now()-started).toFixed(0)}ms`)
})

test('list markers retain browser-resolved bullets and ordered numbering as editable text',()=>{
 for(const marker of ['• ','III. ','■ ']){
 const snapshot=buildSnapshot({requestedStyles:['color','fontSize','lineHeight'],nodes:[{tag:'#document',parent:-1},{tag:'HTML',parent:0},{tag:'BODY',parent:1},{tag:'LI',parent:2},{tag:'::marker',parent:3,pseudoType:'marker'},{tag:'#text',parent:4,text:marker}],layout:[{node:2,bounds:[0,0,300,100]},{node:3,bounds:[40,10,200,24]},{node:4,bounds:[20,13,20,18],styles:{color:'#1474c4',fontSize:'16px',lineHeight:'24px'}}]})
 const root=reconstructSnapshotTree(snapshot,['color','fontSize','lineHeight'],{width:300,height:100})
 const texts:string[]=[];const visit=(n:any)=>{if(n.textPreview)texts.push(n.textPreview);n.children.forEach(visit)};visit(root)
 expect(texts).toContain(marker)
 }
})
