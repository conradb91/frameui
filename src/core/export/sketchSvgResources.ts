import type { FrameUiExportNode } from '@shared/types/frameuiExport'
import type { SvgDefinition } from '../capture-compiler/svgDefinitions'
export function svgDefinitionMap(serialized?: string): Map<string, SvgDefinition> {
  const result = new Map<string, SvgDefinition>()
  if (!serialized || serialized.length > 2_000_000) return result
  try {
    const data = JSON.parse(serialized)
    let count = 0
    const walk = (nodes: SvgDefinition[], depth = 0) => {
      if (!Array.isArray(nodes) || depth > 32) return
      for (const n of nodes) {
        if (++count > 4000) return
        if (n.attributes?.id) result.set(n.attributes.id, n)
        walk(n.children, depth + 1)
      }
    }
    walk(data)
  } catch {
    /* unsupported resources remain in the compatibility report */
  }
  return result
}
export function expandSvgResource(
  source: FrameUiExportNode,
  resource: SvgDefinition,
): FrameUiExportNode[] {
  let index = 0
  const convert = (r: SvgDefinition): FrameUiExportNode => {
    const a = r.attributes ?? {},
      fill = a.fill ?? 'black',
      stroke = a.stroke ?? 'none'
    return {
      ...source,
      id: source.id + ':resource:' + index++,
      name: source.name + ' / ' + r.tag,
      component: undefined,
      captureAppearance: undefined,
      type: 'VECTOR',
      x: 0,
      y: 0,
      rotation: 0,
      opacity: Number(a.opacity ?? 1),
      fills:
        fill === 'none'
          ? []
          : [{ type: 'SOLID', color: fill, opacity: Number(a['fill-opacity'] ?? 1) }],
      strokes:
        stroke === 'none'
          ? []
          : [{ type: 'SOLID', color: stroke, opacity: Number(a['stroke-opacity'] ?? 1) }],
      strokeWidth: Number(a['stroke-width'] ?? 1),
      effects: [],
      children: (r.children ?? []).map(convert),
      vector: { tag: r.tag, geometry: a, path: a.d },
      childIds: [],
    }
  }
  return resource.tag === 'symbol' || resource.tag === 'g'
    ? (resource.children ?? []).map(convert)
    : [convert(resource)]
}
