import { expect, test } from 'bun:test'
import { xdClipGeometry } from './xdClipping'
import type { FrameUiExportNode } from '@shared/types/frameuiExport'
const node = (clipPath: string) =>
  ({
    id: 'clip',
    name: 'Clipped element',
    parentId: 'parent',
    width: 200,
    height: 100,
    radius: [8, 8, 8, 8],
    clipContent: false,
    captureAppearance: { clipPath },
  }) as FrameUiExportNode
test('CSS geometric clips produce bounded editable native geometry', () => {
  expect(xdClipGeometry(node('polygon(0% 0%, 100% 0%, 50% 100%)')).regions[0][0]).toEqual({
    type: 'shape',
    shape: {
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 100, y: 100 },
      ],
    },
  })
  expect(xdClipGeometry(node('inset(10px 20px round 8px)')).regions[0][0]).toMatchObject({
    shape: { type: 'rect', x: 20, y: 10, width: 160, height: 80, r: [8, 8, 8, 8] },
  })
  expect(xdClipGeometry(node('ellipse(25% 40% at 50% 50%)')).regions[0][0]).toMatchObject({
    shape: { type: 'ellipse', cx: 100, cy: 50, rx: 50, ry: 40 },
  })
  expect(xdClipGeometry(node('circle(20px at 25% 50%)')).regions[0][0]).toMatchObject({
    shape: { type: 'circle', cx: 50, cy: 50, r: 20 },
  })
})
test('unsupported alpha masks and complex clips remain explicit instead of silently disappearing', () => {
  const n = node('inset(2px round 4px / 8px)')
  n.captureAppearance!.maskImage = 'linear-gradient(black, transparent)'
  const result = xdClipGeometry(n)
  expect(result.regions).toHaveLength(0)
  expect(result.warnings).toHaveLength(2)
})
