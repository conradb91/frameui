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
  const inherited = {
    fill: source.captureAppearance?.fill ?? (source.fills[0]?.type === 'SOLID' ? source.fills[0].color : 'black'),
    stroke: source.captureAppearance?.stroke ?? (source.strokes[0]?.type === 'SOLID' ? source.strokes[0].color : 'none'),
    'stroke-width': String(source.captureAppearance?.strokeWidth ?? source.strokeWidth ?? 1),
    color: source.vector?.geometry?.color ?? 'black',
  }
  const convert = (r: SvgDefinition, parent: Record<string, string> = inherited): FrameUiExportNode => {
    const inheritedStyle = Object.fromEntries(Object.entries(parent).filter(([key]) => ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'color', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit'].includes(key)))
    const a = { ...inheritedStyle, ...(r.attributes ?? {}) },
      resolve = (value: string) => value === 'currentColor' ? a.color : value,
      fill = resolve(a.fill),
      stroke = resolve(a.stroke)
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
      children: (r.children ?? []).map((child) => convert(child, a)),
      vector: { tag: r.tag, geometry: a, path: a.d },
      childIds: [],
    }
  }
  return resource.tag === 'symbol' || resource.tag === 'g'
    ? (resource.children ?? []).map((child) => convert(child, { ...inherited, ...(resource.attributes ?? {}) }))
    : [convert(resource)]
}
