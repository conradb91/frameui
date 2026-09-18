import { describe, expect, test } from 'bun:test'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import { compileStructuredNodes } from './compile'
import { makeStructuredDocument, makeStructuredFrame } from './document'

function el(overrides: Partial<CapturedElement> = {}): CapturedElement {
  return {
    tag: 'div',
    rect: { x: 10, y: 20, width: 200, height: 100 },
    styles: {},
    children: [],
    ...overrides,
  }
}

describe('compileStructuredNodes — kind classification', () => {
  test('classifies common real HTML tags', () => {
    expect(compileStructuredNodes(el({ tag: 'button', styles: { backgroundColor: '#000' } }))[0].type).toBe('Button')
    expect(compileStructuredNodes(el({ tag: 'a', attributes: { href: '/x' }, styles: { backgroundColor: '#000' } }))[0].type).toBe('Link')
    expect(compileStructuredNodes(el({ tag: 'input', styles: { backgroundColor: '#000' } }))[0].type).toBe('Input')
    expect(compileStructuredNodes(el({ tag: 'img', styles: { backgroundColor: '#000' } }))[0].type).toBe('Image')
  })

  test('classifies an HTML horizontal rule as a divider with exact edge paint', () => {
    const [divider] = compileStructuredNodes(el({
      tag: 'hr',
      rect: { x: 10, y: 40, width: 420, height: 1 },
      styles: {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        borderWidth: '1px 0px 0px',
        borderTopWidth: '1px',
        borderTopStyle: 'solid',
        borderTopColor: 'rgb(218, 224, 234)',
        borderBottomWidth: '0px',
        borderBottomStyle: 'none',
      },
    }))
    expect(divider.type).toBe('Divider')
    expect(divider.name).toBe('Horizontal rule')
    expect(divider.bounds).toEqual({ x: 0, y: 0, width: 420, height: 1 })
    expect(divider.appearance.border).toBeUndefined()
    expect(divider.appearance.stroke).toBe('rgb(218, 224, 234)')
    expect(divider.appearance.strokeWidth).toBe(1)
  })

  test('does not expand a one-sided container border into a box', () => {
    const [footer] = compileStructuredNodes(el({
      styles: {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        borderWidth: '1px 0px 0px',
        borderTopWidth: '1px',
        borderTopStyle: 'solid',
        borderTopColor: 'rgb(233, 238, 245)',
        borderRightWidth: '0px',
        borderRightStyle: 'none',
        borderBottomWidth: '0px',
        borderBottomStyle: 'none',
        borderLeftWidth: '0px',
        borderLeftStyle: 'none',
      },
      children: [el({ tag: 'span', textPreview: 'New here?' })],
    }))
    expect(footer.appearance.border).toBeUndefined()
    expect(footer.appearance.boxShadow).toBe('inset 0px 1px 0 0 rgb(233, 238, 245)')
  })

  test('an <svg> root becomes SVG, with real primitive children carried forward as Shape (no synthesized path strings)', () => {
    const svg = el({
      tag: 'svg',
      styles: { backgroundColor: '#000' },
      attributes: { viewBox: '0 0 24 24' },
      children: [
        el({ tag: 'rect', rect: { x: 12, y: 22, width: 10, height: 10 }, attributes: { x: '0', y: '0', width: '10', height: '10', fill: '#f00' }, styles: {} }),
      ],
    })
    const [node] = compileStructuredNodes(svg)
    expect(node.type).toBe('SVG')
    expect(node.source.svgGeometry?.viewBox).toBe('0 0 24 24')
    expect(node.children[0].type).toBe('Shape')
    expect(node.children[0].source.tag).toBe('rect')
    expect(node.children[0].source.svgGeometry).toEqual({ x: '0', y: '0', width: '10', height: '10' })
  })
})

describe('compileStructuredNodes — image source', () => {
  test('accepts a safe data:image/ src on <img>, and rejects a live/unstable URL', () => {
    const safe = compileStructuredNodes(el({ tag: 'img', styles: { backgroundColor: '#000' }, attributes: { src: 'data:image/png;base64,AAAA' } }))[0]
    expect(safe.source.imageSrc).toBe('data:image/png;base64,AAAA')
    const unsafe = compileStructuredNodes(el({ tag: 'img', styles: { backgroundColor: '#000' }, attributes: { src: 'https://example.com/x.png' } }))[0]
    expect(unsafe.source.imageSrc).toBeUndefined()
  })

  test('reads a <video>\'s poster instead of a nonexistent src', () => {
    const node = compileStructuredNodes(el({ tag: 'video', styles: { backgroundColor: '#000' }, attributes: { poster: 'data:image/png;base64,BBBB' } }))[0]
    expect(node.source.imageSrc).toBe('data:image/png;base64,BBBB')
  })
})

describe('compileStructuredNodes — raster fallback (Stage 9, spec §22)', () => {
  test('an <img> carrying the canvas-splice marker compiles to RasterFallback, not Image', () => {
    const node = compileStructuredNodes(el({
      tag: 'img',
      attributes: { src: 'data:image/png;base64,AAAA', alt: 'Canvas (image)', 'data-frameui-raster-fallback': 'canvas' },
    }))[0]
    expect(node.type).toBe('RasterFallback')
    expect(node.source.imageSrc).toBe('data:image/png;base64,AAAA')
    expect(node.name).toBe('Canvas (image)')
  })

  test('an <img> carrying the iframe-splice marker compiles to RasterFallback', () => {
    const node = compileStructuredNodes(el({
      tag: 'img',
      attributes: { src: 'data:image/png;base64,BBBB', alt: 'Embedded view (image)', 'data-frameui-raster-fallback': 'iframe' },
    }))[0]
    expect(node.type).toBe('RasterFallback')
  })

  test('a real <img> with no marker still compiles to Image (regression guard)', () => {
    const node = compileStructuredNodes(el({ tag: 'img', attributes: { src: 'data:image/png;base64,CCCC' } }))[0]
    expect(node.type).toBe('Image')
  })
})

describe('compileStructuredNodes — wrapper collapse diverges from legacy normalizeVisual', () => {
  test('a paint-less/label-less/text-less flex wrapper is KEPT as a Group with layout.mode==="stack" (not spliced away)', () => {
    const wrapper = el({
      tag: 'div',
      styles: { display: 'flex', flexDirection: 'column', gap: '24px' },
      children: [el({ tag: 'span', rect: { x: 15, y: 25, width: 50, height: 20 }, styles: { backgroundColor: '#111' } })],
    })
    const [node] = compileStructuredNodes(wrapper)
    expect(node.type).toBe('Container')
    expect(node.layout.mode).toBe('stack')
    expect(node.layout.direction).toBe('vertical')
    expect(node.layout.gap).toBe(24)
    expect(node.children).toHaveLength(1)
  })

  test('a paint-less/label-less/text-less free-layout wrapper collapses, rebasing child geometry', () => {
    const wrapper = el({
      tag: 'div',
      rect: { x: 10, y: 20, width: 200, height: 100 },
      styles: {},
      children: [el({ tag: 'span', rect: { x: 30, y: 45, width: 50, height: 20 }, styles: { backgroundColor: '#111' } })],
    })
    const nodes = compileStructuredNodes(wrapper, undefined)
    expect(nodes).toHaveLength(1)
    // Child geometry stays relative to the same ultimate parent origin
    // regardless of the collapsed wrapper in between.
    expect(nodes[0].bounds.x).toBe(20)
    expect(nodes[0].bounds.y).toBe(25)
  })
})

describe('compileStructuredNodes — layout extraction', () => {
  test('an unconstrained full-page wrapper keeps its captured width', () => {
    const [node] = compileStructuredNodes(el({
      tag: 'main',
      rect: { x: 0, y: 0, width: 1440, height: 4000 },
      styles: { maxWidth: 'none', minWidth: 'auto' },
      children: [el({ tag: 'h1', rect: { x: 48, y: 200, width: 600, height: 80 }, children: [el({ tag: 'frameui-text', textPreview: 'Visible heading' })] })],
    }))
    expect(node.layout.maxWidth).toBeUndefined()
    expect(node.layout.minWidth).toBeUndefined()
    expect(node.bounds.width).toBe(1440)
    expect(node.children[0].bounds.x).toBe(48)
  })
  test('surfaces gridTemplateRows/gridAutoFlow/alignContent — the exact gap legacy normalizeVisual leaves on the table', () => {
    const grid = el({
      styles: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: 'auto auto',
        gridAutoFlow: 'row',
        alignContent: 'center',
        backgroundColor: '#fff',
      },
    })
    const [node] = compileStructuredNodes(grid)
    expect(node.layout.mode).toBe('grid')
    expect(node.layout.gridTemplateColumns).toBe('1fr 1fr')
    expect(node.layout.gridTemplateRows).toBe('auto auto')
    expect(node.layout.gridAutoFlow).toBe('row')
    expect(node.layout.alignContent).toBe('center')
  })

  test('expands the padding shorthand into per-side values', () => {
    const node = compileStructuredNodes(el({ styles: { padding: '12px 16px', backgroundColor: '#fff' } }))[0]
    expect(node.layout.padding).toEqual({ top: 12, right: 16, bottom: 12, left: 16 })
  })
})

describe('compileStructuredNodes — constraints and geometry', () => {
  test('position:fixed lands on constraints while bounds still reflects the real captured rect', () => {
    const node = compileStructuredNodes(
      el({ rect: { x: 0, y: 0, width: 300, height: 60 }, styles: { position: 'fixed', backgroundColor: '#fff' } }),
    )[0]
    expect(node.constraints.position).toBe('fixed')
    expect(node.bounds).toEqual({ x: 0, y: 0, width: 300, height: 60 })
  })
})

describe('compileStructuredNodes — deliberately unpopulated fields (later-stage work)', () => {
  test('tokenBindings carries the raw browser value with token left undefined', () => {
    const node = compileStructuredNodes(el({ styles: { backgroundColor: '#123456' } }))[0]
    expect(node.tokenBindings?.backgroundColor?.value).toBe('#123456')
    expect(node.tokenBindings?.backgroundColor?.token).toBeUndefined()
  })

  test('componentBinding stays undefined even when a componentHint is present — the hint only flows into source.component', () => {
    const node = compileStructuredNodes(el({ styles: { backgroundColor: '#fff' }, componentHint: 'PrimaryButton' }))[0]
    expect(node.componentBinding).toBeUndefined()
    expect(node.source.component).toBe('Primary Button')
  })

  test('captureConfidence is undefined across a whole compiled tree, not just the root', () => {
    function assertNoConfidence(nodes: ReturnType<typeof compileStructuredNodes>) {
      for (const n of nodes) {
        expect(n.captureConfidence).toBeUndefined()
        assertNoConfidence(n.children)
      }
    }
    const tree = compileStructuredNodes(
      el({
        styles: { display: 'flex', backgroundColor: '#fff' },
        children: [el({ tag: 'button', styles: { backgroundColor: '#000' } })],
      }),
    )
    assertNoConfidence(tree)
  })
})

describe('compileStructuredNodes — synthetic DOMSnapshot leaf tags', () => {
  test('a frameui-text leaf compiles to a Text node with typography populated', () => {
    const node = compileStructuredNodes(el({ tag: 'frameui-text', textPreview: 'Hello world', styles: { fontSize: '16px', color: '#000' } }))[0]
    expect(node.type).toBe('Text')
    expect(node.typography?.text).toBe('Hello world')
    expect(node.typography?.fontSize).toBe(16)
  })

  test('a frameui-visual (pseudo-element) leaf with paint is kept, not silently dropped', () => {
    const node = compileStructuredNodes(el({ tag: 'frameui-visual', styles: { backgroundColor: '#f00' } }))[0]
    expect(node).toBeDefined()
    expect(node.appearance.backgroundColor).toBe('#f00')
  })
})

describe('compileStructuredNodes — semantic text-owner collapsing', () => {
  test('keeps differently styled inline amounts as separate editable text', () => {
    const heading = el({ tag: 'h2', rect: { x: 0, y: 0, width: 400, height: 60 }, styles: { fontSize: '24px', fontWeight: '700' }, children: [
      el({ tag: 'span', rect: { x: 0, y: 0, width: 120, height: 60 }, styles: { fontSize: '48px', fontWeight: '700' }, children: [el({ tag: 'frameui-text', rect: { x: 0, y: 0, width: 120, height: 60 }, textPreview: 'R 8 450', styles: { fontSize: '48px', fontWeight: '700' } })] }),
      el({ tag: 'span', rect: { x: 130, y: 18, width: 260, height: 30 }, styles: { fontSize: '24px', fontWeight: '700' }, children: [el({ tag: 'frameui-text', rect: { x: 130, y: 18, width: 260, height: 30 }, textPreview: 'available', styles: { fontSize: '24px', fontWeight: '700' } })] }),
    ] })
    const nodes = compileStructuredNodes(heading)
    const text = (nodes: typeof nodes): typeof nodes => nodes.flatMap((node) => node.type === 'Text' ? [node] : text(node.children))
    expect(text(nodes).map((node) => node.typography?.text)).toEqual(['R 8 450', 'available'])
    expect(text(nodes).map((node) => node.typography?.fontSize)).toEqual([48, 24])
  })
  test('an <h1> wrapping inline spans compiles to ONE Text node using the heading\'s own bounds/style, not one node per span', () => {
    const heading = el({
      tag: 'h1',
      rect: { x: 40, y: 60, width: 600, height: 120 },
      styles: { fontSize: '48px', fontWeight: '700' },
      children: [
        el({ tag: 'span', styles: { fontSize: '48px', fontWeight: '700' }, children: [
          el({ tag: 'frameui-text', textPreview: 'Build products', rect: { x: 40, y: 60, width: 260, height: 60 } }),
        ] }),
        el({ tag: 'span', styles: { fontSize: '48px', fontWeight: '700' }, children: [
          el({ tag: 'frameui-text', textPreview: 'faster', rect: { x: 40, y: 120, width: 120, height: 60 } }),
        ] }),
      ],
    })
    const nodes = compileStructuredNodes(heading)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('Text')
    expect(nodes[0].source.tag).toBe('h1')
    expect(nodes[0].typography?.text).toBe('Build products faster')
    expect(nodes[0].bounds).toEqual({ x: 0, y: 0, width: 600, height: 120 })
  })

  test('a <div><h1>…</h1></div> wrapper still yields one Text node carrying the h1\'s own tag, not the wrapper\'s or a bare frameui-text leaf\'s', () => {
    const wrapper = el({
      tag: 'div',
      styles: {},
      children: [
        el({ tag: 'h1', styles: { fontSize: '32px' }, children: [
          el({ tag: 'span', styles: {}, children: [
            el({ tag: 'frameui-text', textPreview: 'Hello world' }),
          ] }),
        ] }),
      ],
    })
    const nodes = compileStructuredNodes(wrapper)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('Text')
    expect(nodes[0].source.tag).toBe('h1')
    expect(nodes[0].typography?.text).toBe('Hello world')
  })

  test('a heading and a following paragraph under a shared wrapper stay two separate Text nodes, not merged into one', () => {
    const wrapper = el({
      tag: 'div',
      styles: {},
      children: [
        el({ tag: 'h1', styles: {}, children: [el({ tag: 'frameui-text', textPreview: 'Heading' })] }),
        el({ tag: 'p', styles: {}, children: [el({ tag: 'frameui-text', textPreview: 'Paragraph' })] }),
      ],
    })
    const nodes = compileStructuredNodes(wrapper)
    expect(nodes.map((n) => n.typography?.text)).toEqual(['Heading', 'Paragraph'])
  })

  test('an explicit <br> becomes a literal newline, not lost or merged into surrounding words', () => {
    const p = el({
      tag: 'p',
      styles: {},
      children: [
        el({ tag: 'frameui-text', textPreview: 'Line one' }),
        el({ tag: 'br', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [] }),
        el({ tag: 'frameui-text', textPreview: 'Line two' }),
      ],
    })
    expect(compileStructuredNodes(p)[0].typography?.text).toBe('Line one\nLine two')
  })

  test('a <p> containing a <button> is never flattened into one Text string spanning both', () => {
    const p = el({
      tag: 'p',
      styles: {},
      children: [
        el({ tag: 'frameui-text', textPreview: 'Click ' }),
        el({ tag: 'button', styles: { backgroundColor: '#000' }, children: [el({ tag: 'frameui-text', textPreview: 'here' })] }),
      ],
    })
    const nodes = compileStructuredNodes(p)
    // The paintless <p> itself still splices away (pre-existing, unrelated
    // wrapper-collapse behavior) — what matters is that isPureTextSubtree
    // correctly bailed out, so "Click " and the Button stay two distinct
    // nodes instead of one Text node reading "Click here".
    expect(nodes.some((n) => n.type === 'Button')).toBe(true)
    expect(nodes.every((n) => n.typography?.text !== 'Click here')).toBe(true)
  })
})

describe('compileStructuredNodes — invisible/zero-size elements are dropped', () => {
  test('display:none and zero-size elements produce no node', () => {
    expect(compileStructuredNodes(el({ styles: { display: 'none' } }))).toEqual([])
    expect(compileStructuredNodes(el({ rect: { x: 0, y: 0, width: 0, height: 0 } }))).toEqual([])
  })
})

describe('makeStructuredFrame / makeStructuredDocument', () => {
  test('produce a well-formed envelope with empty assets/fonts/tokens/sources', () => {
    const frame = makeStructuredFrame(el({ styles: { backgroundColor: '#fff' } }), {
      name: 'Homepage',
      route: '/home',
      width: 1440,
      height: 900,
      durationMs: 12,
    })
    expect(frame.name).toBe('Homepage')
    expect(frame.viewport).toBe('1440x900')
    expect(frame.captureMetadata.engine).toBe('domSnapshot')
    expect(frame.captureMetadata.structuredNodeCount).toBeGreaterThan(0)

    const doc = makeStructuredDocument('project-1', [frame])
    expect(doc.version).toBe(1)
    expect(doc.projectId).toBe('project-1')
    expect(doc.assets).toEqual([])
    expect(doc.fonts).toEqual([])
    expect(doc.tokens).toEqual([])
    expect(doc.sources).toEqual([])
    expect(doc.frames).toHaveLength(1)
  })
})
