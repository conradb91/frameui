import { expect, test } from 'bun:test'
import { extractVisibilityRules } from './projectVisuals'

test('embedded font data does not cause quadratic visibility scanning', () => {
  const css = `@font-face{src:url(data:font/woff2;base64,${'A'.repeat(2_000_000)})}.hidden{display:none}@media(max-width:600px){.mobile{color:red; display: none !important}}`
  const started = performance.now()
  expect(extractVisibilityRules(css)).toEqual(['.hidden{display:none}', '.mobile{color:red; display: none !important}'])
  expect(performance.now() - started).toBeLessThan(1000)
})
