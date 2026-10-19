import svgpath from 'svgpath'
import { parseSVG as parse } from 'svg-path-parser'
import type Sketch from '@sketch-hq/sketch-file-format-ts'
type CurvePoint = Sketch.CurvePoint
const pt = (x: number, y: number) => `{${x}, ${y}}`
export function pathContours(
  path: string,
  width: number,
  height: number,
  transform = '',
): { points: CurvePoint[]; closed: boolean }[] {
  const normalized = svgpath(path).transform(transform).abs().unshort().unarc()
  const error = (normalized as typeof normalized & { err?: string }).err
  if (error) throw new Error(error)
  const commands = parse(normalized.toString())
  const contours: { points: CurvePoint[]; closed: boolean }[] = []
  let points: CurvePoint[] = []
  let x = 0,
    y = 0
  const norm = (a: number, b: number) => pt(a / (width || 1), b / (height || 1))
  const add = (a: number, b: number) => {
    const p = norm(a, b)
    points.push({
      _class: 'curvePoint',
      point: p,
      curveFrom: p,
      curveTo: p,
      hasCurveFrom: false,
      hasCurveTo: false,
      curveMode: 1,
      cornerRadius: 0,
      cornerStyle: 0,
    })
    x = a
    y = b
  }
  for (const c of commands) {
    if (c.code === 'M') {
      points = []
      contours.push({ points, closed: false })
      add(c.x, c.y)
    } else if (c.code === 'Z') {
      contours[contours.length - 1].closed = true
    } else if (c.code === 'C' || c.code === 'Q') {
      const prev = points[points.length - 1]
      if (!prev) throw new Error('Path curve without starting point')
      const x1 = c.code === 'Q' ? x + ((c.x1 - x) * 2) / 3 : c.x1,
        y1 = c.code === 'Q' ? y + ((c.y1 - y) * 2) / 3 : c.y1
      const x2 = c.code === 'Q' ? c.x + ((c.x1 - c.x) * 2) / 3 : 'x2' in c ? c.x2 : c.x,
        y2 = c.code === 'Q' ? c.y + ((c.y1 - c.y) * 2) / 3 : 'y2' in c ? c.y2 : c.y
      prev.curveFrom = norm(x1, y1)
      prev.hasCurveFrom = true
      prev.curveMode = 4
      add(c.x, c.y)
      const next = points[points.length - 1]
      next.curveTo = norm(x2, y2)
      next.hasCurveTo = true
      next.curveMode = 4
    } else if (c.code === 'L') add(c.x, c.y)
    else if (c.code === 'H') add(c.x, y)
    else if (c.code === 'V') add(x, c.y)
  }
  return contours.filter((c) => c.points.length)
}
export function geometryPath(
  tag: string,
  g: Record<string, string>,
  w: number,
  h: number,
): string | undefined {
  const n = (k: string, d = 0) => Number(g[k] ?? d)
  const x = n('x'),
    y = n('y')
  if (g.d) return g.d
  if (tag === 'rect') {
    const a = n('width', w),
      b = n('height', h),
      rx = Math.min(n('rx', n('ry')), a / 2),
      ry = Math.min(n('ry', rx), b / 2)
    return rx || ry
      ? `M${x + rx} ${y}H${x + a - rx}Q${x + a} ${y} ${x + a} ${y + ry}V${y + b - ry}Q${x + a} ${y + b} ${x + a - rx} ${y + b}H${x + rx}Q${x} ${y + b} ${x} ${y + b - ry}V${y + ry}Q${x} ${y} ${x + rx} ${y}Z`
      : `M${x} ${y}h${a}v${b}h${-a}Z`
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = n('cx'),
      cy = n('cy'),
      rx = n('rx', n('r')),
      ry = n('ry', n('r'))
    return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`
  }
  if (tag === 'line') return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`
  if (g.points) return `M${g.points}${tag === 'polygon' ? 'Z' : ''}`
  return undefined
}
