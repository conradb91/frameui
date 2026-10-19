import type Sketch from '@sketch-hq/sketch-file-format-ts'
import { parse, converter } from 'culori'
const rgb = converter('rgb')
const clamp = (n: number) => Math.max(0, Math.min(1, n))
import type { FrameUiExportNode } from '@shared/types/frameuiExport'
export const context = (opacity = 1): Sketch.GraphicsContextSettings => ({
  _class: 'graphicsContextSettings',
  opacity,
  blendMode: 0,
})
export function color(value: string): Sketch.Color {
  const c = rgb(parse(value))
  if (!c) throw new Error(`Unsupported colour: ${value}`)
  return {
    _class: 'color',
    red: clamp(c.r),
    green: clamp(c.g),
    blue: clamp(c.b),
    alpha: clamp(c.alpha ?? 1),
  }
}
export function splitCss(value: string): string[] {
  let depth = 0,
    start = 0
  const out: string[] = []
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    if (value[i] === ')') depth--
    if (value[i] === ',' && !depth) {
      out.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(value.slice(start).trim())
  return out
}
const point = (x: number, y: number) => `{${Number(x.toFixed(8))}, ${Number(y.toFixed(8))}}`
export const defaultGradient = (): Sketch.Gradient => ({
  _class: 'gradient',
  gradientType: 0,
  elipseLength: 1,
  from: '{0.5, 0}',
  to: '{0.5, 1}',
  stops: [
    { _class: 'gradientStop', position: 0, color: color('black') },
    { _class: 'gradientStop', position: 1, color: color('white') },
  ],
})
export function gradient(value: string, w: number, h: number): Sketch.Gradient {
  const match = /^(linear|radial)-gradient\((.*)\)$/i.exec(value)
  if (!match) throw new Error('Gradient requires a visual fallback')
  const parts = splitCss(match[2])
  let head = ''
  if (!parse(parts[0].replace(/\s+[-\d.]+%$/, ''))) head = parts.shift()!
  const raw = parts.map((s) => {
    const m = /^(.*?)\s+(-?[\d.]+)%$/.exec(s)
    return { value: m ? m[1] : s, position: m ? Number(m[2]) / 100 : undefined }
  })
  if (!raw.length) throw new Error('Empty gradient')
  raw[0].position ??= 0
  raw[raw.length - 1].position ??= 1
  for (let i = 1; i < raw.length - 1; i++)
    if (raw[i].position === undefined) {
      let j = i + 1
      while (raw[j].position === undefined) j++
      const first = raw[i - 1].position!
      for (let k = i; k < j; k++)
        raw[k].position = first + ((raw[j].position! - first) * (k - i + 1)) / (j - i + 1)
      i = j - 1
    }
  const result = defaultGradient()
  result.stops = raw.map((s) => ({
    _class: 'gradientStop',
    position: s.position!,
    color: color(s.value),
  }))
  if (match[1] === 'radial') {
    if (!/^circle(?:\s|$)/.test(head))
      throw new Error('Elliptical radial gradient requires visual review')
    result.gradientType = 1
    let cx = 0.5,
      cy = 0.5
    const at = /at\s+([\d.]+)%\s+([\d.]+)%/.exec(head)
    if (at) {
      cx = +at[1] / 100
      cy = +at[2] / 100
    }
    if (head && !/^(circle|ellipse)?\s*(farthest-corner)?\s*(at\s+[\d.]+%\s+[\d.]+%)?$/.test(head))
      throw new Error('Radial gradient geometry requires review')
    const radius = Math.hypot(Math.max(cx, 1 - cx) * w, Math.max(cy, 1 - cy) * h)
    result.from = point(cx, cy)
    result.to = point(cx + radius / (w || 1), cy)
    result.elipseLength = 1
  } else {
    let deg = 180
    if (head) {
      if (/^-?[\d.]+deg$/.test(head)) deg = parseFloat(head)
      else {
        const map: Record<string, number> = {
          'to top': 0,
          'to right': 90,
          'to bottom': 180,
          'to left': 270,
        }
        if (map[head] === undefined) throw new Error('Gradient direction requires review')
        deg = map[head]
      }
    }
    const a = (deg * Math.PI) / 180,
      dx = Math.sin(a),
      dy = -Math.cos(a),
      length = Math.abs(w * dx) + Math.abs(h * dy)
    result.from = point(0.5 - (dx * length) / (2 * (w || 1)), 0.5 - (dy * length) / (2 * (h || 1)))
    result.to = point(0.5 + (dx * length) / (2 * (w || 1)), 0.5 + (dy * length) / (2 * (h || 1)))
  }
  return result
}
export function fill(value: string, w: number, h: number, opacity = 1): Sketch.Fill {
  return {
    _class: 'fill',
    isEnabled: true,
    color: /gradient\(/.test(value) ? color('black') : color(value),
    fillType: /gradient\(/.test(value) ? 1 : 0,
    noiseIndex: 0,
    noiseIntensity: 0,
    patternFillType: 1,
    patternTileScale: 1,
    contextSettings: context(opacity),
    gradient: /gradient\(/.test(value) ? gradient(value, w, h) : defaultGradient(),
  }
}
export function style(
  n: FrameUiExportNode,
  id: string,
  warn: (code: string, message: string) => void,
): Sketch.Style {
  const s: Sketch.Style = {
    _class: 'style',
    do_objectID: id,
    borderOptions: {
      _class: 'borderOptions',
      isEnabled: true,
      dashPattern: [],
      lineCapStyle: 0,
      lineJoinStyle: 0,
    },
    startMarkerType: 0,
    endMarkerType: 0,
    miterLimit: 10,
    windingRule: 1,
    innerShadows: [],
    shadows: [],
    fills: [],
    borders: [],
    contextSettings: context(n.opacity),
    colorControls: {
      _class: 'colorControls',
      isEnabled: false,
      brightness: 0,
      contrast: 1,
      hue: 0,
      saturation: 1,
    },
  }
  for (const p of n.fills)
    try {
      s.fills!.push(fill(p.type === 'SOLID' ? p.color : p.value, n.width, n.height, p.opacity))
    } catch (e) {
      warn('fill', String(e))
    }
  for (const p of n.strokes)
    try {
      if (n.strokeWidth > 0)
        s.borders!.push({
          _class: 'border',
          isEnabled: true,
          color: color(p.type === 'SOLID' ? p.color : 'black'),
          fillType: 0,
          position: 1,
          thickness: n.strokeWidth,
          contextSettings: context(p.opacity),
          gradient: defaultGradient(),
        })
    } catch (e) {
      warn('border', String(e))
    }
  for (const e of n.effects) {
    if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
      s.blur = {
        _class: 'blur',
        isEnabled: true,
        center: '{0.5, 0.5}',
        saturation: 1,
        type: e.type === 'LAYER_BLUR' ? 0 : 3,
        radius: e.radius ?? parseFloat(e.value),
      }
      continue
    }
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
      for (const part of splitCss(e.value)) {
        const rgba = part.match(
          /(?:rgba?|hsla?)\([^)]*\)|#[\da-f]+|\b(?:black|white|transparent)\b/i,
        )
        const lengths = part
          .replace(rgba?.[0] ?? '', '')
          .replace(/inset/g, '')
          .trim()
          .split(/\s+/)
          .map(parseFloat)
        try {
          if (lengths.length < 2 || lengths.some((v) => !Number.isFinite(v)))
            throw new Error('Unresolved shadow')
          const shadow = {
            isEnabled: true,
            blurRadius: lengths[2] ?? 0,
            color: color(rgba?.[0] ?? 'black'),
            contextSettings: context(),
            offsetX: lengths[0],
            offsetY: lengths[1],
            spread: lengths[3] ?? 0,
          }
          if (e.type === 'INNER_SHADOW') s.innerShadows.push({ _class: 'innerShadow', ...shadow })
          else s.shadows!.push({ _class: 'shadow', ...shadow })
          if (shadow.spread) warn('xd-shadow-spread', 'XD may omit shadow spread.')
        } catch {
          warn('shadow', 'Shadow could not be converted.')
        }
      }
    else warn('effect', 'Unsupported effect retained in the compatibility manifest.')
  }
  if (s.shadows!.length > 1) warn('xd-multiple-shadows', 'XD may import only the topmost shadow.')
  return s
}
