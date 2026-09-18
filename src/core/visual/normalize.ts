import type { CapturedElement } from '../../shared/types/runtimeCapture'
import type { VisualObject, VisualKind } from '../../shared/types/visualDesign'
import { object } from './model'
const number = (s?: string) => Number.parseFloat(s ?? '') || 0
const visiblePaint = (s?: string) =>
  !!s && s !== 'transparent' && s !== 'rgba(0, 0, 0, 0)' && s !== 'none'

// Chromium now commonly serializes computed colours as `oklab(...)` and
// `oklch(...)`. Those values work in HTML/CSS, but Electron does not
// consistently honour them when they are later assigned to SVG presentation
// attributes (`fill`/`stroke`). Convert them to the broadly-supported sRGB
// syntax at the capture boundary so the editable SVG canvas never becomes a
// collection of outlines with invisible paint.
function normalizePaint(value?: string, fallback = 'none'): string {
  if (!value) return fallback
  const match = /^okl(ab|ch)\(\s*([^)]*)\s*\)$/i.exec(value)
  if (!match) return value
  const [channelsPart, alphaPart] = match[2].split('/').map((part) => part.trim())
  const channels = channelsPart.split(/[\s,]+/).filter(Boolean)
  if (channels.length < 3) return value
  const percent = (token: string, scale = 1) =>
    token.endsWith('%') ? (Number.parseFloat(token) / 100) * scale : Number.parseFloat(token)
  const L = percent(channels[0])
  let a: number
  let b: number
  if (match[1].toLowerCase() === 'ch') {
    const chroma = percent(channels[1], 0.4)
    const hueToken = channels[2].toLowerCase()
    const hue = Number.parseFloat(hueToken)
    const degrees = hueToken.endsWith('turn') ? hue * 360 : hueToken.endsWith('rad') ? (hue * 180) / Math.PI : hue
    a = chroma * Math.cos((degrees * Math.PI) / 180)
    b = chroma * Math.sin((degrees * Math.PI) / 180)
  } else {
    a = percent(channels[1], 0.4)
    b = percent(channels[2], 0.4)
  }
  if (![L, a, b].every(Number.isFinite)) return value
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const srgb = linear.map((channel) => {
    const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
  })
  const alpha = alphaPart ? Math.min(1, Math.max(0, percent(alphaPart))) : 1
  return alpha < 1 ? `rgba(${srgb.join(', ')}, ${Number(alpha.toFixed(3))})` : `rgb(${srgb.join(', ')})`
}
// `getComputedStyle` resolves `transform` to its computed matrix form, not
// the literal `rotate()` the author wrote — `matrix(a,b,c,d,e,f)`'s
// rotation component is `atan2(b,a)`. The literal-`rotate()` branch is a
// defensive fallback for the rare case a UA reports it unresolved.
function rotationFromTransform(value?: string): number {
  if (!value || value === 'none') return 0
  const matrixMatch = /^matrix\(([^,]+),\s*([^,]+),/.exec(value)
  if (matrixMatch) {
    const a = Number.parseFloat(matrixMatch[1])
    const b = Number.parseFloat(matrixMatch[2])
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.round((Math.atan2(b, a) * 180) / Math.PI)
  }
  const rotateMatch = /rotate\(([-\d.]+)deg\)/.exec(value)
  return rotateMatch ? Number.parseFloat(rotateMatch[1]) : 0
}
function blurFromFilter(value?: string): number | undefined {
  const match = value ? /blur\(([\d.]+)px\)/.exec(value) : null
  return match ? Number.parseFloat(match[1]) : undefined
}
const cleanName = (s: string) =>
  s
    .replace(/\.(vue|tsx?|jsx?|razor|svelte|php|html)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .trim()

// A semantic text owner is one editable text object even when its source
// contains inline spans or wraps across rendered lines. Keep interactive or
// replaced descendants separate so a paragraph containing a button/image is
// not incorrectly flattened into one string.
const TEXT_OWNER_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'label', 'li', 'td', 'th',
  'figcaption', 'blockquote', 'dt', 'dd',
])
const TEXT_OWNER_EXCLUDED_DESCENDANTS = new Set([
  'button', 'a', 'img', 'video', 'svg', 'input', 'textarea', 'select',
])
function isPureTextSubtree(el: CapturedElement): boolean {
  const tag = el.tag.toLowerCase()
  if (tag === 'frameui-text' || tag === 'br') return true
  if (TEXT_OWNER_EXCLUDED_DESCENDANTS.has(tag)) return false
  return el.children.every(isPureTextSubtree)
}
function collectOwnerText(el: CapturedElement): string {
  const parts: string[] = []
  const walk = (node: CapturedElement) => {
    const tag = node.tag.toLowerCase()
    if (tag === 'frameui-text') {
      if (node.textPreview?.trim()) parts.push(node.textPreview.trim())
    } else if (tag === 'br') parts.push('\n')
    else node.children.forEach(walk)
  }
  walk(el)
  let result = ''
  for (const part of parts) {
    if (part === '\n') result = result.replace(/ +$/, '') + '\n'
    else result += result && !result.endsWith('\n') ? ` ${part}` : part
  }
  return result.trim()
}

function horizontalRulePaint(styles: Record<string, string>, elementHeight: number) {
  const edges = [
    { width: number(styles.borderTopWidth), style: styles.borderTopStyle, color: styles.borderTopColor },
    { width: number(styles.borderBottomWidth), style: styles.borderBottomStyle, color: styles.borderBottomColor },
  ]
  const edge = edges.find(({ width, style, color }) =>
    width > 0 && style !== 'none' && style !== 'hidden' && visiblePaint(color),
  )
  if (edge) return { color: normalizePaint(edge.color), width: edge.width }
  if (visiblePaint(styles.backgroundColor))
    return { color: normalizePaint(styles.backgroundColor), width: Math.max(1, elementHeight) }
  return {
    color: normalizePaint(visiblePaint(styles.borderColor) ? styles.borderColor : styles.color, '#161616'),
    width: number(styles.borderWidth) || Math.max(1, elementHeight),
  }
}

type CapturedBorderEdge = {
  side: 'top' | 'right' | 'bottom' | 'left'
  width: number
  style?: string
  color?: string
}

/** Chromium exposes both the border shorthand and the resolved longhands.
 * The legacy canvas only has a uniform object stroke, so a one-sided CSS
 * border must be retained as its own line layer instead of being expanded
 * into a rectangular outline around the element. */
function capturedBorderEdges(styles: Record<string, string>): CapturedBorderEdge[] {
  const shorthand = (styles.borderWidth ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(number)
  const [top = 0, right = top, bottom = top, left = right] = shorthand
  const values = { top, right, bottom, left }
  return (['top', 'right', 'bottom', 'left'] as const).map((side) => {
    const title = `${side[0].toUpperCase()}${side.slice(1)}`
    return {
      side,
      width: number(styles[`border${title}Width`]) || values[side],
      style: styles[`border${title}Style`] || styles.borderStyle,
      color: styles[`border${title}Color`] || styles.borderColor,
    }
  })
}

function splitBorderEdges(styles: Record<string, string>): CapturedBorderEdge[] {
  // Old snapshots may only contain the shorthand. In that case the existing
  // uniform stroke is the safest representation; current captures always
  // include the resolved per-side longhands.
  if (!['Top', 'Right', 'Bottom', 'Left'].some((side) => styles[`border${side}Width`] !== undefined)) return []
  const edges = capturedBorderEdges(styles)
  const visible = edges.filter((edge) =>
    edge.width > 0 && edge.style !== 'none' && edge.style !== 'hidden' && visiblePaint(edge.color),
  )
  const first = edges[0]
  const uniform = edges.every((edge) =>
    edge.width === first.width && edge.style === first.style && edge.color === first.color,
  )
  return uniform ? [] : visible
}
/** Collapse structural wrappers, while keeping geometry, paint and source provenance. */
export function normalizeVisual(
  root: CapturedElement,
  source?: VisualObject['source'],
): VisualObject[] {
  function convert(
    el: CapturedElement,
    parentX: number,
    parentY: number,
  ): VisualObject[] {
    const s = el.styles,
      a = el.attributes ?? {},
      tag = el.tag.toLowerCase(),
      role = el.aria?.role
    if (s.display === 'contents') return el.children.flatMap(child => convert(child, parentX, parentY))
    if (
      s.display === 'none' ||
      s.visibility === 'hidden' ||
      (number(s.opacity) === 0 && s.opacity !== undefined) ||
      el.rect.width <= 0 ||
      el.rect.height <= 0
    )
      return []
    let kind: VisualKind = 'Group'
    const kinds: Record<string, VisualKind> = {
      button: 'Button',
      a: 'Button',
      input: 'Input',
      textarea: 'Input',
      select: 'Select',
      img: 'Image',
      video: 'Image',
      svg: 'Icon',
      path: 'Vector',
      nav: 'Navigation',
      table: 'Table',
      dialog: 'Modal',
      hr: 'Line',
      circle: 'Ellipse',
    }
    kind = kinds[tag] ?? kinds[role ?? ''] ?? kind
    if (a.type === 'checkbox') kind = 'Checkbox'
    if (a.type === 'radio') kind = 'Radio'
    const hint = el.componentHint ? cleanName(el.componentHint) : ''
    const ownerText = TEXT_OWNER_TAGS.has(tag) && isPureTextSubtree(el)
      ? collectOwnerText(el)
      : ''
    const text = ownerText || el.textPreview?.trim()
    const paint =
      visiblePaint(s.backgroundColor) ||
      visiblePaint(s.backgroundImage) ||
      number(s.borderWidth) > 0 ||
      visiblePaint(s.boxShadow)
    if (kind === 'Group' && paint && number(s.borderRadius) > 0) kind = 'Card'
    if (kind === 'Group' && text && (!el.children.length || !!ownerText)) kind = 'Text'
    const label = el.aria?.['aria-label'] || a.alt || hint
    const children = ownerText
      ? []
      : el.children.flatMap((child) => convert(child, el.rect.x, el.rect.y))
    if (kind === 'Group' && !paint && !label && !text) {
      return children.map((child) => ({
        ...child,
        x: child.x + el.rect.x - parentX,
        y: child.y + el.rect.y - parentY,
      }))
    }
    const semantic =
      tag === 'header'
        ? 'Header'
        : tag === 'footer'
          ? 'Footer'
          : tag === 'aside'
            ? 'Sidebar'
            : undefined
    const firstText = children.find((c) => c.kind === 'Text')?.text
    const name = cleanName(
      label ||
        semantic ||
        (kind === 'Text'
          ? text?.slice(0, 48)
          : kind === 'Button'
            ? `${text || firstText || 'Action'} Button`
            : kind === 'Card' && firstText
              ? `${firstText.slice(0, 30)} Card`
              : kind) ||
        kind,
    )
    const radii = [
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
    ].map((k) => number(s[k] || s.borderRadius)) as VisualObject['radius']
    const divider = tag === 'hr' ? horizontalRulePaint(s, el.rect.height) : undefined
    const edgeBorders = divider ? [] : splitBorderEdges(s)
    const o = object(kind, {
      name: /^(div|span|container|wrapper|section|flex container|grid container|dom node)$/i.test(
        name,
      )
        ? 'Visual Group'
        : name,
      x: el.rect.x - parentX,
      y: el.rect.y - parentY + (divider ? Math.max(0, el.rect.height - divider.width) / 2 : 0),
      width: el.rect.width,
      height: divider ? divider.width : el.rect.height,
      rotation: rotationFromTransform(s.transform),
      imageFit:
        s.objectFit === 'cover' || s.objectFit === 'contain' || s.objectFit === 'fill'
          ? s.objectFit
          : undefined,
      blur: blurFromFilter(s.filter),
      fill:
        divider ? 'none' : kind === 'Text' ? normalizePaint(s.color, '#161616') : normalizePaint(s.backgroundColor),
      stroke: divider?.color ?? (edgeBorders.length ? 'none' : normalizePaint(s.borderColor || s.stroke)),
      strokeWidth: divider?.width ?? (edgeBorders.length ? 0 : number(s.borderWidth || s.strokeWidth)),
      opacity: s.opacity === undefined ? 1 : Number(s.opacity),
      radius: radii,
      fontFamily: s.fontFamily || 'sans-serif',
      fontSize: number(s.fontSize) || 16,
      fontWeight: s.fontWeight || '400',
      lineHeight: number(s.lineHeight) || number(s.fontSize) * 1.2,
      letterSpacing: number(s.letterSpacing),
      textAlign: s.textAlign || 'left',
      textDecoration: s.textDecoration && s.textDecoration !== 'none' ? s.textDecoration : undefined,
      shadow: s.boxShadow,
      gradient: s.backgroundImage?.includes('gradient')
        ? s.backgroundImage
        : undefined,
      clip: ['hidden', 'clip', 'scroll', 'auto'].includes(s.overflow),
      text: kind === 'Text' ? text : undefined,
      // A <video> has no frame to render directly — its poster is the
      // closest thing to an image representation of it.
      src: (tag === 'video' ? a.poster : a.src)?.startsWith('data:image/')
        ? (tag === 'video' ? a.poster : a.src)
        : undefined,
      path: a.d,
      viewBox: a.viewBox,
      source: {
        ...source,
        file: a['data-frameui-source'] || source?.file,
        component: hint || source?.component,
        selector: a.captureSelector,
        destination: a.href,
      },
      variant: a.visualState ? { State: a.visualState } : undefined,
      layout: {
        direction:
          s.display === 'grid'
            ? 'grid'
            : s.display === 'flex'
              ? s.flexDirection
              : 'none',
        alignment: s.alignItems || 'start',
        distribution: s.justifyContent || 'start',
        gap: number(s.gap),
        padding: number(s.padding),
        wrap: s.flexWrap === 'wrap',
        constraints: s.position === 'fixed' ? 'fixed' : 'left-top',
        minWidth: number(s.minWidth),
        maxWidth: number(s.maxWidth) || undefined,
        grid: s.gridTemplateColumns,
      },
      children,
    })
    for (const edge of edgeBorders) {
      const color = normalizePaint(edge.color)
      if (edge.side === 'top' || edge.side === 'bottom') {
        o.children.push(
          object('Line', {
            name: `${edge.side === 'top' ? 'Top' : 'Bottom'} border`,
            x: 0,
            y: edge.side === 'top' ? 0 : Math.max(0, o.height - edge.width),
            width: o.width,
            height: edge.width,
            fill: 'none',
            stroke: color,
            strokeWidth: edge.width,
          }),
        )
      } else {
        o.children.push(
          object('Rectangle', {
            name: `${edge.side === 'left' ? 'Left' : 'Right'} border`,
            x: edge.side === 'left' ? 0 : Math.max(0, o.width - edge.width),
            y: 0,
            width: edge.width,
            height: o.height,
            fill: color,
            stroke: 'none',
            strokeWidth: 0,
          }),
        )
      }
    }
    if (a.backgroundSrc?.startsWith('data:image/'))
      o.children.unshift(
        object('Image', {
          name: 'Background Image',
          src: a.backgroundSrc,
          width: o.width,
          height: o.height,
          radius: o.radius,
        }),
      )
    if (tag === 'svg') {
      const vector = (node: CapturedElement): VisualObject[] => {
        const attrs = node.attributes ?? {},
          style = node.styles
        const fill = normalizePaint(attrs.fill || style.fill, '#161616'),
          stroke = normalizePaint(attrs.stroke || style.stroke)
        let d = attrs.d
        if (node.tag === 'rect')
          d = `M ${number(attrs.x)} ${number(attrs.y)} h ${number(attrs.width)} v ${number(attrs.height)} h ${-number(attrs.width)} Z`
        if (node.tag === 'circle' || node.tag === 'ellipse') {
          const cx = number(attrs.cx),
            cy = number(attrs.cy),
            rx = number(attrs.rx || attrs.r),
            ry = number(attrs.ry || attrs.r)
          d = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`
        }
        if (node.tag === 'line')
          d = `M ${number(attrs.x1)} ${number(attrs.y1)} L ${number(attrs.x2)} ${number(attrs.y2)}`
        if (attrs.points)
          d = `M ${attrs.points} ${node.tag === 'polygon' ? 'Z' : ''}`
        const children = node.children.flatMap(vector)
        if (d)
          children.unshift(
            object('Vector', {
              name: 'Icon Path',
              path: d,
              fill,
              stroke,
              strokeWidth: number(attrs['stroke-width'] || style.strokeWidth),
              width: o.width,
              height: o.height,
            }),
          )
        return children
      }
      o.children = el.children.flatMap(vector)
    }
    if (kind === 'Vector') {
      o.fill = normalizePaint(a.fill || s.fill, '#161616')
      o.stroke = normalizePaint(a.stroke || s.stroke)
    }
    if (text && kind !== 'Text')
      o.children.push(
        object('Text', {
          name: 'Label',
          text,
          width: o.width,
          height: o.height,
          fill: normalizePaint(s.color, '#161616'),
          fontFamily: o.fontFamily,
          fontSize: o.fontSize,
          fontWeight: o.fontWeight,
          lineHeight: o.lineHeight,
        }),
      )
    return [o]
  }
  return convert(root, root.rect.x, root.rect.y)
}
