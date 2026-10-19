/** Shared allowlist for captured SVG resources. Never replay arbitrary website markup. */
export interface SvgDefinition {
  tag: string
  attributes: Record<string, string>
  children: SvgDefinition[]
}
export const SVG_RESOURCE_TAGS = [
  'defs',
  'symbol',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
  'use',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feFlood',
  'feComposite',
  'feBlend',
  'feMerge',
  'feMergeNode',
  'feColorMatrix',
  'feComponentTransfer',
  'feFuncR',
  'feFuncG',
  'feFuncB',
  'feFuncA',
  'feMorphology',
  'feTurbulence',
  'feDisplacementMap',
  'feDropShadow',
]
export const SVG_RESOURCE_ATTRIBUTES = [
  'id',
  'd',
  'points',
  'x',
  'y',
  'width',
  'height',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'viewBox',
  'preserveAspectRatio',
  'transform',
  'gradientTransform',
  'gradientUnits',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-rule',
  'clip-rule',
  'opacity',
  'clip-path',
  'mask',
  'maskUnits',
  'maskContentUnits',
  'filter',
  'filterUnits',
  'primitiveUnits',
  'color-interpolation-filters',
  'stdDeviation',
  'dx',
  'dy',
  'in',
  'in2',
  'result',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'mode',
  'type',
  'values',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'tableValues',
  'radius',
  'baseFrequency',
  'numOctaves',
  'seed',
  'stitchTiles',
  'scale',
  'xChannelSelector',
  'yChannelSelector',
  'flood-color',
  'flood-opacity',
  'href',
  'xlink:href',
]
const tags = new Set(SVG_RESOURCE_TAGS),
  attrs = new Set(SVG_RESOURCE_ATTRIBUTES)
const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function svgResourceId(scope: string, id: string): string {
  return `frameui-${scope.replace(/[^a-zA-Z0-9_-]/g, '')}-${id.replace(/[^a-zA-Z0-9-]/g, (c) => '_' + c.charCodeAt(0).toString(16) + '_')}`
}
export function scopeSvgValue(value: string | undefined, scope: string): string | undefined {
  return value?.replace(
    /url\(\s*["']?(?:[^"'()]*#)([^\s"')]+)["']?\s*\)/g,
    (_, id) => `url(#${svgResourceId(scope, id)})`,
  )
}
export function renderSvgDefinitions(serialized: string | undefined, scope: string): string {
  if (!serialized || serialized.length > 2_000_000) return ''
  let data: unknown
  try {
    data = JSON.parse(serialized)
  } catch {
    return ''
  }
  let remaining = 4000
  const render = (value: unknown, depth: number): string => {
    if (!value || typeof value !== 'object' || depth > 32 || remaining-- <= 0) return ''
    const n = value as Partial<SvgDefinition>
    if (!n.tag || !tags.has(n.tag)) return ''
    const attributes = Object.entries(n.attributes ?? {})
      .flatMap(([key, raw]) => {
        if (!attrs.has(key) || typeof raw !== 'string' || raw.length > 500000) return []
        let v = raw
        if (key === 'id') v = svgResourceId(scope, v)
        else if (key === 'href' || key === 'xlink:href') {
          if (!/^#[^\s]+$/.test(v)) return []
          v = '#' + svgResourceId(scope, v.slice(1))
        } else if (/url\(/i.test(v)) {
          if (!/^url\(\s*["']?#[^\s"')]+["']?\s*\)$/.test(v)) return []
          v = scopeSvgValue(v, scope)!
        }
        return [` ${key}="${esc(v)}"`]
      })
      .join('')
    return `<${n.tag}${attributes}>${Array.isArray(n.children) ? n.children.map((c) => render(c, depth + 1)).join('') : ''}</${n.tag}>`
  }
  return Array.isArray(data) ? data.map((n) => render(n, 0)).join('') : ''
}
