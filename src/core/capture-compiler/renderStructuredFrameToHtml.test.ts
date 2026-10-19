import { describe, expect, test } from 'bun:test'
import type { StructuredFont, StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'
import { renderStructuredFrameToHtml } from './renderStructuredFrameToHtml'

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

function frame(children: StructuredNode[], fonts?: StructuredFont[]): StructuredFrame {
  return {
    id: 'f1',
    name: 'Homepage',
    viewport: '1440x900',
    sourceRoute: '/home',
    width: 1440,
    height: 900,
    children,
    captureMetadata: { capturedAt: new Date().toISOString(), engine: 'domSnapshot', structuredNodeCount: children.length, durationMs: 1 },
    fonts,
  }
}

describe('renderStructuredFrameToHtml', () => {
  test('emits a full standalone document with the frame dimensions on the root wrapper', () => {
    const html = renderStructuredFrameToHtml(frame([]))
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('width:1440px')
    expect(html).toContain('height:900px')
  })

  test('a Container with background color and radius emits the matching inline CSS', () => {
    const html = renderStructuredFrameToHtml(frame([
      node({ appearance: { backgroundColor: '#ff0000', radius: [4, 4, 4, 4], opacity: 1, rotation: 0, clip: false } }),
    ]))
    expect(html).toContain('background-color:#ff0000')
    expect(html).toContain('border-radius:4px 4px 4px 4px')
  })

  test('a free-layout section retains absolute placement inside the page', () => {
    const html = renderStructuredFrameToHtml(frame([
      node({ type: 'Section', bounds: { x: 0, y: 500, width: 1440, height: 300 } }),
    ]))
    expect(html).toContain('left:0px;top:500px;width:1440px;height:300px')
  })

  test('Text content is HTML-escaped, never emitted raw', () => {
    const html = renderStructuredFrameToHtml(frame([
      node({ type: 'Text', typography: { text: '<script>alert(1)</script> & co', fontFamily: 'sans-serif', fontSize: 16, fontWeight: '400', lineHeight: 19, letterSpacing: 0, textAlign: 'left' } }),
    ]))
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  test('quoted font families stay inside the style attribute', () => {
    const html = renderStructuredFrameToHtml(frame([
      node({ type: 'Text', typography: { text: 'Heading', fontFamily: '"Inter Variable", sans-serif', fontSize: 40, fontWeight: '700', lineHeight: 44, letterSpacing: 0, textAlign: 'left' } }),
    ]))
    expect(html).toContain('font-family:&quot;Inter Variable&quot;, sans-serif;font-size:40px')
    expect(html).not.toContain('font-family:"Inter Variable"')
  })

  test('an Image with a safe data:image src renders an <img> tag', () => {
    const html = renderStructuredFrameToHtml(frame([
      node({ type: 'Image', source: { tag: 'img', imageSrc: 'data:image/png;base64,AAAA' } }),
    ]))
    expect(html).toContain('<img src="data:image/png;base64,AAAA"')
  })

  test('a RasterFallback node renders like an Image (same already-spliced imageSrc)', () => {
    const html = renderStructuredFrameToHtml(frame([
      node({ type: 'RasterFallback', source: { tag: 'img', imageSrc: 'data:image/png;base64,CCCC' } }),
    ]))
    expect(html).toContain('<img src="data:image/png;base64,CCCC"')
  })

  test('an SVG node with a rect Shape child renders real <svg><rect> markup with escaped geometry', () => {
    const shape = node({
      id: 'shape1', type: 'Shape', parentId: 'svg1',
      source: { tag: 'rect', svgGeometry: { x: '0', y: '0', width: '24"', height: '24' } },
    })
    const svgNode = node({ id: 'svg1', type: 'SVG', source: { tag: 'svg', svgGeometry: { viewBox: '0 0 24 24' } }, children: [shape] })
    const html = renderStructuredFrameToHtml(frame([svgNode]))
    expect(html).toContain('<svg')
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain('<rect')
    // The quote character inside the captured geometry value must come back attribute-escaped.
    expect(html).toContain('width="24&quot;"')
  })

  test('fonts on the frame emit a matching @font-face rule in the document head', () => {
    const html = renderStructuredFrameToHtml(frame([], [
      { family: 'Inter', weight: '400', style: 'normal', data: 'data:font/woff2;base64,AAAA' },
    ]))
    expect(html).toContain('@font-face{font-family:Inter;font-weight:400;font-style:normal;src:url("data:font/woff2;base64,AAAA")}')
  })

  test('no fonts on the frame emits no @font-face block at all', () => {
    const html = renderStructuredFrameToHtml(frame([]))
    expect(html).not.toContain('@font-face')
  })

  // Regression guard: a flex/grid parent must not hand its children off to
  // native flow — replaying flex/grid with reconstructed fonts/wrappers can
  // wrap differently than the original capture. Every node renders at its
  // own captured (parent-relative) bounds via `capturedPositionStyleFor`,
  // same as a 'free' parent's children.
  test('a stack/grid parent still positions its children absolutely from their captured bounds, not native flex/grid flow', () => {
    const child = node({ id: 'child1', bounds: { x: 24, y: 12, width: 200, height: 40 } })
    const stackParent = node({
      id: 'stack1',
      layout: { mode: 'stack', direction: 'horizontal', gap: 16 },
      children: [child],
    })
    const html = renderStructuredFrameToHtml(frame([stackParent]))
    expect(html).toContain('display:flex')
    expect(html).toContain('left:24px;top:12px;width:200px;height:40px')
  })
})

test('SVG groups preserve transforms, stroke caps and dash offsets', () => {
  const shape = node({ type: 'Shape', source: { tag: 'path', svgGeometry: { d: 'M1 2L3 4', 'stroke-linecap': 'round', 'stroke-dashoffset': '12' } } })
  const group = node({ type: 'Shape', source: { tag: 'g', svgGeometry: { transform: 'translate(2,2)' } }, children: [shape] })
  const html = renderStructuredFrameToHtml(frame([node({ type: 'SVG', children: [group] })]))
  expect(html).toContain('<g transform="translate(2,2)">')
  expect(html).toContain('stroke-linecap="round"')
  expect(html).toContain('stroke-dashoffset="12"')
})

test('font subset descriptors survive standalone rendering', () => {
  const html = renderStructuredFrameToHtml(frame([], [{ family: 'Fixture', weight: '100 900', style: 'normal', unicodeRange: 'U+0-FF', stretch: 'condensed', data: 'data:font/woff2;base64,AAAA' }]))
  expect(html).toContain('unicode-range:U+0-FF;')
  expect(html).toContain('font-stretch:condensed;')
})

test('standalone render retains designer-applied rich text styles', () => {
  const html = renderStructuredFrameToHtml(frame([node({ type: 'Text', typography: { text: 'Bold rest', fontFamily: 'Arial', fontSize: 16, fontWeight: '400', lineHeight: 20, letterSpacing: 0, textAlign: 'left', textRuns: [{ start: 0, end: 4, fontWeight: '700', color: '#123456' }] } })]))
  expect(html).toContain('<span style="font-weight:700;color:#123456;-webkit-text-fill-color:#123456">Bold</span>')
})

test('native controls render captured state without introducing live application actions', () => {
  const html = renderStructuredFrameToHtml(frame([node({ type: 'Input', source: { tag: 'input', control: { type: 'checkbox', checked: true, disabled: false } } })]))
  expect(html).toMatch(/<input[^>]*type="checkbox" checked readonly tabindex="-1"/)
  expect(html).not.toContain('disabled')
  expect(html).toContain('pointer-events:none')
})
test('a text-only repository component keeps its text, typography and rounded appearance',()=>{
 const html=renderStructuredFrameToHtml(frame([node({type:'ComponentInstance',componentBinding:{componentId:'brand',confidence:1},appearance:{radius:[14,14,14,14],opacity:1,rotation:0,clip:false},typography:{text:'Harbour',fontFamily:'Arial',fontSize:24,fontWeight:'700',lineHeight:32,letterSpacing:0,textAlign:'left'}})]))
 expect(html).toContain('Harbour');expect(html).toContain('font-size:24px');expect(html).toContain('line-height:32px');expect(html).toContain('border-radius:14px 14px 14px 14px')
})
