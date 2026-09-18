import { editSiblings, applyVisualLayout, resizeVisualObject } from './model'
import { visualObjectSchema } from './schema'
import { describe, test, expect } from 'bun:test'
import { normalizeVisual } from './normalize'
import { object, cloneObject, routePattern, safeRoute } from './model'
import type { CapturedElement } from '../../shared/types/runtimeCapture'
const el = (props: Partial<CapturedElement> = {}): CapturedElement => ({
  tag: 'div',
  rect: { x: 10, y: 20, width: 200, height: 100 },
  styles: {},
  children: [],
  ...props,
})
describe('Visual normalizer', () => {
  test('removes wrappers without changing visible geometry', () => {
    const result = normalizeVisual(
      el({
        children: [
          el({
            tag: 'span',
            textPreview: 'Account balance',
            rect: { x: 30, y: 40, width: 100, height: 20 },
          }),
        ],
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('Text')
    expect(result[0].name).toBe('Account balance')
    expect(result[0].x).toBe(20)
    expect(result[0].y).toBe(20)
  })
  test('keeps a wrapped heading with inline spans as one editable text object', () => {
    const [heading] = normalizeVisual(el({
      tag: 'h1',
      rect: { x: 30, y: 40, width: 520, height: 116 },
      styles: { fontSize: '56px', fontWeight: '700', lineHeight: '58px' },
      children: [
        el({ tag: 'span', children: [el({ tag: 'frameui-text', textPreview: 'Know where your' })] }),
        el({ tag: 'span', children: [el({ tag: 'frameui-text', textPreview: 'money stands.' })] }),
      ],
    }))
    expect(heading.kind).toBe('Text')
    expect(heading.text).toBe('Know where your money stands.')
    expect(heading.children).toHaveLength(0)
    expect(heading.width).toBe(520)
    expect(heading.height).toBe(116)
  })
  test('does not merge a paragraph with an interactive descendant', () => {
    const result = normalizeVisual(el({
      tag: 'p',
      children: [
        el({ tag: 'frameui-text', textPreview: 'Read' }),
        el({ tag: 'button', children: [el({ tag: 'frameui-text', textPreview: 'more' })] }),
      ],
    }))
    expect(JSON.stringify(result)).not.toContain('Read more')
    expect(JSON.stringify(result)).toContain('more')
  })
  test('keeps an HTML horizontal rule as a line with its exact edge paint', () => {
    const [divider] = normalizeVisual(el({
      tag: 'hr',
      rect: { x: 30, y: 80, width: 420, height: 1 },
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
    expect(divider.kind).toBe('Line')
    expect(divider.name).toBe('Line')
    expect(divider.width).toBe(420)
    expect(divider.height).toBe(1)
    expect(divider.fill).toBe('none')
    expect(divider.stroke).toBe('rgb(218, 224, 234)')
    expect(divider.strokeWidth).toBe(1)
  })
  test('keeps a one-sided container border as a line instead of a box stroke', () => {
    const [footer] = normalizeVisual(el({
      rect: { x: 30, y: 80, width: 384, height: 41 },
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
      children: [el({ tag: 'span', textPreview: 'New here?', rect: { x: 100, y: 102, width: 74, height: 17 } })],
    }))
    expect(footer.stroke).toBe('none')
    expect(footer.strokeWidth).toBe(0)
    expect(footer.children.find((child) => child.name === 'Top border')).toMatchObject({
      kind: 'Line',
      x: 0,
      y: 0,
      width: 384,
      height: 1,
      stroke: 'rgb(233, 238, 245)',
      strokeWidth: 1,
    })
  })
  test('retains rounded surfaces and semantic button labels', () => {
    const [button] = normalizeVisual(
      el({
        tag: 'button',
        styles: {
          backgroundColor: '#6750a4',
          borderRadius: '12px',
          opacity: '0.8',
        },
        children: [
          el({
            tag: 'span',
            textPreview: 'Save',
            rect: { x: 20, y: 30, width: 40, height: 20 },
          }),
        ],
      }),
      { file: 'Button.vue' },
    )
    expect(button.kind).toBe('Button')
    expect(button.name).toBe('Save Button')
    expect(button.radius).toEqual([12, 12, 12, 12])
    expect(button.opacity).toBe(0.8)
    expect(button.source?.file).toBe('Button.vue')
    expect(button.children[0].text).toBe('Save')
  })
  test('does not persist remote image URLs or invisible layers', () => {
    expect(normalizeVisual(el({ styles: { display: 'none' } }))).toEqual([])
    expect(
      normalizeVisual(
        el({
          tag: 'img',
          attributes: { src: 'http://localhost:3000/private.png' },
        }),
      )[0].src,
    ).toBeUndefined()
  })
  test('converts Chromium OKLab paint to SVG-compatible sRGB', () => {
    const [card] = normalizeVisual(el({
      styles: {
        backgroundColor: 'oklab(0.7 0.1 -0.1)',
        borderColor: 'oklch(60% 0.15 250 / 50%)',
        borderWidth: '1px',
      },
    }))
    expect(card.fill).toMatch(/^rgb\(/)
    expect(card.stroke).toMatch(/^rgba\(/)
    expect(card.fill).not.toContain('oklab')
    expect(card.stroke).not.toContain('oklch')
  })
  test('copies nested objects with independent identities', () => {
    const master = object('Component', {
      children: [object('Text', { text: 'Label' })],
    })
    const copy = cloneObject(master)
    expect(copy.id).not.toBe(master.id)
    expect(copy.children[0].id).not.toBe(master.children[0].id)
  })
})
describe('Read-only page discovery', () => {
  test('collapses records to representative route patterns', () => {
    expect(routePattern('/projects/123')).toBe('/projects/:id')
    expect(routePattern('/projects/456')).toBe('/projects/:id')
    expect(routePattern('/projects/123/edit')).toBe('/projects/:id/edit')
  })
  test('rejects actions, query actions and external destinations', () => {
    for (const route of [
      '/logout',
      '/projects/123/delete',
      '/admin/send',
      '/payment/pay',
      '/users?delete=1',
      'https://example.com',
    ])
      expect(safeRoute(route, 'http://localhost:3000')).toBe(false)
    expect(safeRoute('/projects/123', 'http://localhost:3000')).toBe(true)
  })
})

describe('Editable imported designs', () => {
  test('structural edits reach nested captured objects without moving their parent', () => {
    const child = object('Text', { text: 'Balance' }),
      root = object('Card', { x: 80, y: 120, children: [child] })
    const next = editSiblings([root], new Set([child.id]), (siblings) => [
      ...siblings,
      cloneObject(siblings[0]),
    ])
    expect(next[0].children).toHaveLength(2)
    expect(next[0].x).toBe(80)
    expect(next[0].children[0].id).toBe(child.id)
  })
  test('row layout applies spacing and alignment to child geometry', () => {
    const parent = object('Group', {
      width: 300,
      height: 100,
      children: [
        object('Rectangle', { width: 50, height: 20 }),
        object('Rectangle', { width: 70, height: 20 }),
      ],
    })
    parent.layout = {
      ...parent.layout,
      direction: 'row',
      padding: 10,
      gap: 12,
      alignment: 'center',
    }
    applyVisualLayout(parent)
    expect(parent.children.map((c) => c.x)).toEqual([10, 72])
    expect(parent.children.map((c) => c.y)).toEqual([40, 40])
  })
  test('persistence rejects remote assets and invalid paint values', () => {
    expect(
      visualObjectSchema.safeParse(
        object('Image', { src: 'http://localhost:5173/image.png' }),
      ).success,
    ).toBe(false)
    expect(
      visualObjectSchema.safeParse(object('Rectangle', { opacity: 2 })).success,
    ).toBe(false)
    expect(
      visualObjectSchema.safeParse(
        object('Image', { src: 'data:image/png;base64,AA==' }),
      ).success,
    ).toBe(true)
  })
})

test('resizing respects right, center and stretch constraints', () => {
  const right = object('Button', {
    x: 70,
    width: 20,
    height: 20,
    layout: { ...object('Button').layout, constraints: 'right-top' },
  })
  const center = object('Text', {
    x: 40,
    y: 40,
    width: 20,
    height: 20,
    layout: { ...object('Text').layout, constraints: 'center' },
  })
  const stretch = object('Rectangle', {
    width: 80,
    height: 80,
    layout: { ...object('Rectangle').layout, constraints: 'stretch' },
  })
  const frame = object('Frame', {
    width: 100,
    height: 100,
    children: [right, center, stretch],
  })
  resizeVisualObject(frame, 200, 150)
  expect(right.x).toBe(170)
  expect(center.x).toBe(90)
  expect(center.y).toBe(65)
  expect(stretch.width).toBe(180)
  expect(stretch.height).toBe(130)
})
test('grid places children in rows with editable gaps', () => {
  const frame = object('Frame', {
    width: 220,
    height: 200,
    children: [
      object('Rectangle', { height: 30 }),
      object('Rectangle', { height: 30 }),
      object('Rectangle', { height: 30 }),
    ],
  })
  frame.layout = {
    ...frame.layout,
    direction: 'grid',
    grid: '2',
    gap: 10,
    padding: 10,
  }
  applyVisualLayout(frame)
  expect(frame.children.map((c) => [c.x, c.y, c.width])).toEqual([
    [10, 10, 95],
    [115, 10, 95],
    [10, 50, 95],
  ])
})
