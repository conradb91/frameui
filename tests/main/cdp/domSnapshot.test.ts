import { describe, expect, test } from 'bun:test'
import { captureDomSnapshot, toCssPropertyName } from '../../../src/main/ipc/handlers/cdp/domSnapshot'
import { CAPTURED_STYLE_PROPERTIES } from '../../../src/shared/captureStyleProperties'

describe('toCssPropertyName', () => {
  test('converts the JS CSSStyleDeclaration spelling to real CSS property syntax', () => {
    expect(toCssPropertyName('fontSize')).toBe('font-size')
    expect(toCssPropertyName('boxSizing')).toBe('box-sizing')
    expect(toCssPropertyName('borderTopLeftRadius')).toBe('border-top-left-radius')
    expect(toCssPropertyName('zIndex')).toBe('z-index')
    expect(toCssPropertyName('WebkitFontSmoothing')).toBe('-webkit-font-smoothing')
    // Already-lowercase, single-word properties pass through unchanged.
    expect(toCssPropertyName('display')).toBe('display')
    expect(toCssPropertyName('color')).toBe('color')
  })

  // Regression coverage for a real bug found against a live Electron/Chromium
  // build: `DOMSnapshot.captureSnapshot` rejects the camelCase JS spelling
  // with "invalid CSS property" — every requested property must convert.
  test('every entry in CAPTURED_STYLE_PROPERTIES converts to a plausible kebab-case CSS property', () => {
    for (const prop of CAPTURED_STYLE_PROPERTIES) {
      const kebab = toCssPropertyName(prop)
      expect(kebab).toMatch(/^-?[a-z]+(-[a-z]+)*$/)
    }
  })
})

describe('captureDomSnapshot', () => {
  // Stage 1 of the capture-engine rebuild reuses this for the interactive
  // "Capture screen" path, which operates on a `<webview>` guest's
  // `WebContents` — there is no `BrowserWindow` to call `getContentSize()`
  // on. The stub below deliberately has no `getContentSize` at all, so a
  // regression back to deriving the viewport from a `BrowserWindow` would
  // fail this test with "getContentSize is not a function" rather than
  // silently passing.
  function makeContentsStub() {
    const calls: string[] = []
    const debuggerApi = {
      attach() { calls.push('attach') },
      detach() { calls.push('detach') },
      isAttached: () => false,
      async sendCommand(method: string) {
        calls.push(method)
        if (method === 'DOMSnapshot.captureSnapshot') return { documents: [], strings: [] }
        return {}
      },
    }
    const contents = {
      debugger: debuggerApi,
      executeJavaScript: async () => [],
    } as unknown as import('electron').WebContents
    return { contents, calls }
  }

  test('takes an explicit viewport instead of deriving one from a BrowserWindow', async () => {
    const { contents, calls } = makeContentsStub()
    const root = await captureDomSnapshot(contents, { width: 390, height: 844 })
    expect(root).toEqual({ tag: 'body', rect: { x: 0, y: 0, width: 0, height: 0 }, styles: {}, children: [] })
    expect(calls).toContain('DOMSnapshot.captureSnapshot')
  })
})
