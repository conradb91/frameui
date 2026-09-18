import { describe, expect, test } from 'bun:test'
import type { StructuredAppearance, StructuredNode, StructuredTypography } from '@shared/types/structuredDesign'
import { appearanceStyleFor, capturedPositionStyleFor, containerStyleFor, styleToInlineCss, typographyStyleFor } from './structuredNodeStyle'

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

describe('containerStyleFor', () => {
  test('mode:"stack" produces flex CSS from direction/gap/align/justify/wrap', () => {
    const style = containerStyleFor(node({
      layout: { mode: 'stack', direction: 'vertical', reverse: false, wrap: true, align: 'center', justify: 'space-between', gap: 24, padding: { top: 8, right: 12, bottom: 8, left: 12 } },
    }))
    expect(style.display).toBe('flex')
    expect(style.flexDirection).toBe('column')
    expect(style.flexWrap).toBe('wrap')
    expect(style.alignItems).toBe('center')
    expect(style.justifyContent).toBe('space-between')
    expect(style.gap).toBe('24px')
    expect(style.padding).toBe('8px 12px 8px 12px')
  })

  test('mode:"stack" with reverse and horizontal direction', () => {
    const style = containerStyleFor(node({ layout: { mode: 'stack', direction: 'horizontal', reverse: true } }))
    expect(style.flexDirection).toBe('row-reverse')
  })

  test('mode:"grid" produces grid CSS including gridTemplateRows/AutoFlow', () => {
    const style = containerStyleFor(node({
      layout: { mode: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto auto', gridAutoFlow: 'row', gap: 16 },
    }))
    expect(style.display).toBe('grid')
    expect(style.gridTemplateColumns).toBe('1fr 1fr')
    expect(style.gridTemplateRows).toBe('auto auto')
    expect(style.gridAutoFlow).toBe('row')
    expect(style.gap).toBe('16px')
  })

  test('mode:"free" has no flex/grid properties at all', () => {
    const style = containerStyleFor(node({ layout: { mode: 'free' } }))
    expect(style.display).toBeUndefined()
    expect(style.position).toBe('relative')
    expect(style.gridTemplateColumns).toBeUndefined()
    expect(style.flexDirection).toBeUndefined()
  })
})

describe('capturedPositionStyleFor', () => {
  test('always absolutely positions a node from its own (parent-relative) bounds, regardless of parent layout mode', () => {
    const child = node({ bounds: { x: 30, y: 40, width: 200, height: 60 } })
    const style = capturedPositionStyleFor(child)
    expect(style.position).toBe('absolute')
    expect(style.left).toBe('30px')
    expect(style.top).toBe('40px')
    expect(style.width).toBe('200px')
    expect(style.height).toBe('60px')
  })
})

describe('appearanceStyleFor', () => {
  test('maps the radius array to a CSS border-radius shorthand', () => {
    const appearance: StructuredAppearance = { radius: [4, 8, 12, 16], opacity: 1, rotation: 0, clip: false }
    expect(appearanceStyleFor(appearance).borderRadius).toBe('4px 8px 12px 16px')
  })

  test('opacity 1 is omitted (CSS default), non-1 is passed through', () => {
    expect(appearanceStyleFor({ radius: [0, 0, 0, 0], opacity: 1, rotation: 0, clip: false }).opacity).toBeUndefined()
    expect(appearanceStyleFor({ radius: [0, 0, 0, 0], opacity: 0.5, rotation: 0, clip: false }).opacity).toBe(0.5)
  })

  test('rotation becomes a CSS transform, blur becomes a CSS filter, clip becomes overflow:hidden', () => {
    const style = appearanceStyleFor({ radius: [0, 0, 0, 0], opacity: 1, rotation: 15, blur: 4, clip: true })
    expect(style.transform).toBe('rotate(15deg)')
    expect(style.filter).toBe('blur(4px)')
    expect(style.overflow).toBe('hidden')
  })

  test('a border object becomes a CSS border shorthand', () => {
    const style = appearanceStyleFor({ radius: [0, 0, 0, 0], opacity: 1, rotation: 0, clip: false, border: { width: 2, style: 'solid', color: '#000' } })
    expect(style.border).toBe('2px solid #000')
  })
})

describe('typographyStyleFor', () => {
  test('maps every field through to its CSS equivalent', () => {
    const typography: StructuredTypography = {
      text: 'Hello', fontFamily: 'Inter', fontSize: 16, fontWeight: '600',
      lineHeight: 24, letterSpacing: 0.5, textAlign: 'center', color: '#111',
    }
    const style = typographyStyleFor(typography)
    expect(style.fontFamily).toBe('Inter')
    expect(style.fontSize).toBe('16px')
    expect(style.fontWeight).toBe('600')
    expect(style.lineHeight).toBe('24px')
    expect(style.letterSpacing).toBe('0.5px')
    expect(style.textAlign).toBe('center')
    expect(style.color).toBe('#111')
  })
})

describe('styleToInlineCss', () => {
  test('converts camelCase keys to kebab-case', () => {
    expect(styleToInlineCss({ backgroundColor: '#fff', flexDirection: 'row' })).toBe('background-color:#fff;flex-direction:row')
  })

  test('skips undefined values entirely, never emitting "key:undefined"', () => {
    expect(styleToInlineCss({ color: '#000', backgroundColor: undefined })).toBe('color:#000')
  })

  test('a unitless numeric property passes through bare', () => {
    expect(styleToInlineCss({ opacity: 0.5 })).toBe('opacity:0.5')
  })

  test('a non-unitless numeric property gets a px suffix', () => {
    expect(styleToInlineCss({ width: 200 })).toBe('width:200px')
  })
})
