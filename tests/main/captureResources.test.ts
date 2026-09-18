import { describe, expect, test } from 'bun:test'
import { clipRectToViewport } from '../../src/main/ipc/handlers/captureResources'

describe('frame capture geometry', () => {
  test('clips every viewport edge without expanding the captured area', () => {
    expect(
      clipRectToViewport(
        { x: -100, y: -20, width: 240, height: 100 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ x: 0, y: 0, width: 140, height: 80 })
    expect(
      clipRectToViewport(
        { x: 260, y: 180, width: 100, height: 80 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ x: 260, y: 180, width: 40, height: 20 })
  })

  test('returns an empty rectangle for a fully offscreen frame', () => {
    expect(
      clipRectToViewport(
        { x: 20, y: 250, width: 100, height: 80 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ x: 20, y: 250, width: 100, height: 0 })
  })
})
