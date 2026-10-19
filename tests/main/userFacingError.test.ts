import { expect, test } from 'bun:test'
import { userFacingError } from '../../src/renderer/lib/userFacingError'

test('setup errors omit Electron transport details', () => {
  expect(userFacingError(new Error("Error invoking remote method 'project:verifyRuntime': Error: Verification file not found (404)."))).toBe('Verification file not found (404).')
  expect(userFacingError("Error: Error invoking remote method 'ai:connect': Error: Reconnect Claude." )).toBe('Reconnect Claude.')
})
test('capture validation errors show actionable messages without schema internals', () => {
  const details = JSON.stringify([{ code: 'custom', path: ['url'], message: 'Connect and verify this Runtime URL for the open project first.' }])
  expect(userFacingError(new Error(`Error invoking remote method 'design:capture': Error: ${details}`))).toBe('Connect and verify this Runtime URL for the open project first.')
})
test('plain error messages remain readable', () => {
  expect(userFacingError(new Error('Cannot reach Anthropic. Check your connection and retry.'))).toBe('Cannot reach Anthropic. Check your connection and retry.')
})
