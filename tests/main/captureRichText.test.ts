import { expect, test } from 'bun:test'
import { compileStructuredNodes } from '../../src/core/capture-compiler/compile'
import { makeStructuredFrame } from '../../src/core/capture-compiler/document'
import { structuredFrameSchema } from '../../src/core/capture-compiler/schema'
import { renderStructuredFrameToHtml } from '../../src/core/capture-compiler/renderStructuredFrameToHtml'
import { applyTextStyle, textSegments } from '../../src/core/visual/textRuns'
import type { CapturedElement } from '../../src/shared/types/runtimeCapture'
const el = (
  tag: string,
  styles: Record<string, string> = {},
  children: CapturedElement[] = [],
  textPreview?: string,
): CapturedElement => ({
  tag,
  rect: { x: 24, y: 30, width: 300, height: 40 },
  styles: {
    fontFamily: 'Arial',
    fontSize: '24px',
    lineHeight: '30px',
    fontWeight: '400',
    color: '#123',
    ...styles,
  },
  children,
  textPreview,
})
const text = (value: string, styles: Record<string, string> = {}) => ({
  ...el('frameui-text', styles, [], value),
  attributes: { 'data-frameui-exact-text': 'true' },
})
test('mixed weight, italic and gradient ranges stay in one editable owner and survive serialization', () => {
  const heading = el('h1', {}, [
    text('1 '),
    el('strong', { fontWeight: '700' }, [text('Admin', { fontWeight: '700' })]),
    el(
      'span',
      {
        fontStyle: 'italic',
        backgroundClip: 'text',
        backgroundImage: 'linear-gradient(90deg, #00b5e2, #ff8a1f)',
        color: 'transparent',
      },
      [text(' included', { fontStyle: 'italic', color: 'transparent' })],
    ),
  ])
  const frame = structuredFrameSchema.parse(
    JSON.parse(
      JSON.stringify(
        makeStructuredFrame(heading, {
          name: 'Rich',
          route: '/',
          width: 390,
          height: 844,
          durationMs: 0,
        }),
      ),
    ),
  )
  expect(frame.children).toHaveLength(1)
  const t = frame.children[0].typography!
  expect(t.text).toBe('1 Admin included')
  expect(t.textRuns?.some((r) => r.fontWeight === '700')).toBe(true)
  expect(t.textRuns?.some((r) => r.fontStyle === 'italic' && r.gradient)).toBe(true)
  expect(renderStructuredFrameToHtml(frame)).toContain('-webkit-text-fill-color:transparent')
  expect(renderStructuredFrameToHtml(frame)).toContain('linear-gradient')
})
test('formatting part of a gradient as a solid colour preserves unaffected styles', () => {
  const runs = [
    { start: 0, end: 10, fontWeight: '700', gradient: { image: 'linear-gradient(red,blue)' } },
  ]
  const updated = applyTextStyle('Hello team', runs, 0, 5, { color: '#f00' })
  const segments = textSegments('Hello team', updated)
  expect(segments[0].gradient).toBeUndefined()
  expect(segments[0].fontWeight).toBe('700')
  expect(segments[0].color).toBe('#f00')
  expect(segments[1].gradient).toBeDefined()
})
test('older captures with transparent text inherit retained text paint without changing their saved tree', () => {
  const parent = el(
    'div',
    { backgroundClip: 'text', backgroundImage: 'linear-gradient(red,blue)', padding: '2px' },
    [text('Visible again', { color: 'transparent' })],
  )
  const frame = makeStructuredFrame(parent, {
      name: 'Old',
      route: '/',
      width: 390,
      height: 844,
      durationMs: 0,
    }),
    before = JSON.stringify(frame),
    html = renderStructuredFrameToHtml(frame)
  expect(html.match(/background-image:linear-gradient/g)!.length).toBeGreaterThan(1)
  expect(JSON.stringify(frame)).toBe(before)
})
test('empty inline wrappers terminate and never regroup themselves indefinitely', () => {
  expect(() =>
    compileStructuredNodes(el('div', {}, [el('span', { display: 'inline' }), text(' ')])),
  ).not.toThrow()
})
