import { expect, test } from 'bun:test'
import { splitXdCssLayers, xdDiagnostic, xdImageSource } from './xdBackgrounds'
test('CSS background splitter respects functions, quoted URLs, commas and escaped quotes', () => {
  const value =
    'linear-gradient(120deg, rgba(3, 59, 95, 0.15), rgba(18, 113, 172, 0.15)), url("data:image/jpeg;base64,abcd")'
  expect(splitXdCssLayers(value)).toHaveLength(2)
  expect(xdImageSource(splitXdCssLayers(value)[1])).toBe('data:image/jpeg;base64,abcd')
  expect(splitXdCssLayers('url("image(1,2).png"), linear-gradient(red, blue)')).toHaveLength(2)
})
test('export diagnostics never expose base64 asset bytes or grow beyond 240 characters', () => {
  const value = xdDiagnostic('Unsupported color data:image/jpeg;base64,' + 'A'.repeat(5000))
  expect(value).toContain('[embedded asset]')
  expect(value).not.toContain('AAAA')
  expect(value.length).toBeLessThanOrEqual(240)
})
