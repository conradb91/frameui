import { expect, test } from 'bun:test'
import { expandSvgResource } from './sketchSvgResources'
import type { FrameUiExportNode } from '@shared/types/frameuiExport'

test('SVG use expansion inherits source stroke and symbol style without inheriting geometry', () => {
  const source = { id: 'use', name: 'Info', fills: [], strokes: [], strokeWidth: 1.8,
    captureAppearance: { fill: 'none', stroke: 'rgb(52, 86, 115)', strokeWidth: 1.8 },
    vector: { geometry: { color: 'rgb(52, 86, 115)' } },
  } as unknown as FrameUiExportNode
  const expanded = expandSvgResource(source, { tag: 'symbol', attributes: { fill: 'none', 'stroke-linecap': 'round' }, children: [
    { tag: 'g', attributes: { transform: 'translate(2 3)', stroke: 'currentColor' }, children: [
      { tag: 'circle', attributes: { cx: '12', cy: '12', r: '9' }, children: [] },
    ] },
  ] })
  const leaf = expanded[0].children[0]
  expect(leaf.fills).toEqual([])
  expect(leaf.strokes).toEqual([{ type: 'SOLID', color: 'rgb(52, 86, 115)', opacity: 1 }])
  expect(leaf.strokeWidth).toBe(1.8)
  expect(leaf.vector?.geometry?.['stroke-linecap']).toBe('round')
  expect(leaf.vector?.geometry?.transform).toBeUndefined()
})
