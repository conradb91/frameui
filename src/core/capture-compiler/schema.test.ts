import { describe, expect, test } from 'bun:test'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import { makeStructuredFrame } from './document'
import { structuredFrameSchema } from './schema'

/**
 * Regression guard for the exact bug Stage 5 found while planning: Zod's
 * default `z.object({...})` strips unrecognized keys rather than erroring,
 * so if this schema ever drifts out of sync with what `compileStructuredNodes`
 * actually produces, `design:save` would silently lose data instead of this
 * test catching it first.
 */
describe('structuredFrameSchema', () => {
  test('accepts a real frame produced by compileStructuredNodes/makeStructuredFrame', () => {
    const root: CapturedElement = {
      tag: 'div',
      rect: { x: 0, y: 0, width: 1440, height: 900 },
      styles: { display: 'flex', flexDirection: 'column', gap: '24px', backgroundColor: '#ffffff' },
      children: [
        {
          tag: 'button',
          rect: { x: 20, y: 20, width: 120, height: 40 },
          styles: { backgroundColor: '#111111', borderRadius: '6px' },
          children: [],
        },
        {
          tag: 'img',
          rect: { x: 20, y: 80, width: 200, height: 120 },
          styles: {},
          attributes: { src: 'data:image/png;base64,AAAA' },
          children: [],
        },
        {
          tag: 'frameui-text',
          rect: { x: 20, y: 220, width: 300, height: 24 },
          styles: { fontSize: '16px', color: '#000000', whiteSpace: 'pre', fontStyle: 'italic', zIndex: '40' },
          textPreview: 'Hello world',
          children: [],
        },
      ],
    }
    const frame = makeStructuredFrame(root, { name: 'Homepage', route: '/home', width: 1440, height: 900, durationMs: 5 })
    const result = structuredFrameSchema.safeParse(frame)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(frame)
  })

  test('accepts a frame with fonts populated (Stage 8 sub-slice 2)', () => {
    const root: CapturedElement = { tag: 'div', rect: { x: 0, y: 0, width: 1440, height: 900 }, styles: {}, children: [] }
    const frame = makeStructuredFrame(root, { name: 'Homepage', route: '/home', width: 1440, height: 900, durationMs: 5 })
    const withFonts = { ...frame, fonts: [{ family: 'Inter', weight: '400', style: 'normal', data: 'data:font/woff2;base64,AAAA' }] }
    const result = structuredFrameSchema.safeParse(withFonts)
    expect(result.success).toBe(true)
  })
})
