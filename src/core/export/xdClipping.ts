import type { FrameUiExportNode } from '@shared/types/frameuiExport'
import type { SvgDefinition } from '../capture-compiler/svgDefinitions'
import { geometryPath } from './sketchGeometry'
import svgpath from 'svgpath'
export type XdClipShape = Record<string, unknown>
const length = (value: string, size: number) =>
  value.endsWith('%') ? (parseFloat(value) * size) / 100 : parseFloat(value)
const position = (value: string | undefined, size: number) =>
  !value || value === 'center'
    ? size / 2
    : value === 'left' || value === 'top'
      ? 0
      : value === 'right' || value === 'bottom'
        ? size
        : length(value, size)
/** Native clipPath resource geometry, verified against Adobe's plugin sticker sheet. */
export function xdClipGeometry(
  n: FrameUiExportNode,
  definitions?: Map<string, SvgDefinition>,
): { regions: XdClipShape[][]; warnings: string[] } {
  const regions: XdClipShape[][] = [],
    warnings: string[] = []
  if (n.clipContent && n.parentId !== null) {
    const a = n.captureAppearance
    if (a?.clipX !== a?.clipY && (a?.clipX || a?.clipY))
      warnings.push(`One-axis overflow clipping approximates both axes: ${n.name}`)
    regions.push([
      {
        type: 'shape',
        shape: { type: 'rect', x: 0, y: 0, width: n.width, height: n.height, r: n.radius },
      },
    ])
  }
  const clip = n.captureAppearance?.clipPath
  if (clip && clip !== 'none') {
    const previousCount = regions.length
    let shape: XdClipShape | undefined
    const polygon = /^polygon\((.*)\)$/.exec(clip)
    const inset = /^inset\(([^)]+)\)$/.exec(clip)
    const circle = /^circle\(([^)]+)\)$/.exec(clip)
    const ellipse = /^ellipse\(([^)]+)\)$/.exec(clip)
    const path = /^path\(["'](.*)["']\)$/.exec(clip)
    const ref = /^url\(["']?#([^"')]+)["']?\)$/.exec(clip)
    if (polygon) {
      const points = polygon[1]
        .split(',')
        .map((p) => p.trim().split(/\s+/))
        .map(([x, y]) => ({ x: length(x, n.width), y: length(y, n.height) }))
      if (points.length >= 3 && points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
        shape = { type: 'polygon', points }
    } else if (inset) {
      const [edges, round] = inset[1].split(/\s+round\s+/),
        values = edges.trim().split(/\s+/)
      const t = length(values[0], n.height),
        r = length(values[1] ?? values[0], n.width),
        b = length(values[2] ?? values[0], n.height),
        l = length(values[3] ?? values[1] ?? values[0], n.width)
      if ([t, r, b, l].every(Number.isFinite) && (!round || /^[-\d.]+(?:px|%)?$/.test(round)))
        shape = {
          type: 'rect',
          x: l,
          y: t,
          width: Math.max(0, n.width - l - r),
          height: Math.max(0, n.height - t - b),
          r: Array(4).fill(round ? length(round, Math.min(n.width, n.height)) : 0),
        }
    } else if (circle || ellipse) {
      const [size, at] = (circle ?? ellipse)![1].split(/\s+at\s+/),
        p = at?.trim().split(/\s+/),
        cx = position(p?.[0], n.width),
        cy = position(p?.[1], n.height)
      if (circle) {
        const r = length(size, Math.hypot(n.width, n.height) / Math.SQRT2)
        if ([cx, cy, r].every(Number.isFinite)) shape = { type: 'circle', cx, cy, r }
      } else {
        const v = size.trim().split(/\s+/),
          rx = length(v[0], n.width),
          ry = length(v[1] ?? v[0], n.height)
        if ([cx, cy, rx, ry].every(Number.isFinite)) shape = { type: 'ellipse', cx, cy, rx, ry }
      }
    } else if (path) shape = { type: 'path', path: path[1] }
    else if (ref) {
      const resource = definitions?.get(ref[1])
      if (resource?.tag.toLowerCase() === 'clippath') {
        const shapes: XdClipShape[] = []
        const walk = (d: SvgDefinition, inherited = '') => {
          const a = d.attributes ?? {},
            p = geometryPath(d.tag, a, n.width, n.height),
            transform = inherited + ' ' + (a.transform ?? '')
          if (p)
            shapes.push({
              type: 'shape',
              shape: {
                type: 'path',
                path: svgpath(p).transform(transform).abs().unshort().unarc().toString(),
              },
            })
          d.children?.forEach((child) => walk(child, transform))
        }
        resource.children?.forEach((child) =>
          walk(
            child,
            resource.attributes?.clipPathUnits === 'objectBoundingBox'
              ? `scale(${n.width} ${n.height})`
              : '',
          ),
        )
        if (shapes.length && !shapes.some((s) => typeof s.transform === 'string'))
          regions.push(shapes)
        else warnings.push(`SVG clipping transform requires review: ${n.name}`)
      }
    }
    if (shape) regions.push([{ type: 'shape', shape }])
    else if (regions.length === previousCount)
      warnings.push(`Unsupported clip path: ${n.name} (${clip})`)
  }
  if (n.captureAppearance?.maskImage && n.captureAppearance.maskImage !== 'none')
    warnings.push(`CSS alpha/luminance mask requires review: ${n.name}`)
  return { regions, warnings }
}
