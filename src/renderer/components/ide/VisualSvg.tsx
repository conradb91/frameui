import { memo } from 'react'
import { applyVisualLayout } from '@core/visual/model'
import type {
  VisualObject,
  DesignVariable,
  VisualPage,
} from '@shared/types/visualDesign'
import { textSegments } from '@core/visual/richText'
const noVariables: DesignVariable[] = []

let textMeasurementContext: CanvasRenderingContext2D | null = null

function measuredTextWidth(
  value: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: string,
  letterSpacing: number,
) {
  if (typeof document === 'undefined')
    return value.length * fontSize * 0.55 + Math.max(0, value.length - 1) * letterSpacing
  textMeasurementContext ??= document.createElement('canvas').getContext('2d')
  if (!textMeasurementContext)
    return value.length * fontSize * 0.55 + Math.max(0, value.length - 1) * letterSpacing
  textMeasurementContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  return (
    textMeasurementContext.measureText(value).width +
    Math.max(0, Array.from(value).length - 1) * letterSpacing
  )
}

/**
 * SVG text does not wrap to its object width. Recreate normal CSS word
 * wrapping so the painted text and the in-place HTML editor share the same
 * container geometry while remaining one editable VisualObject.
 */
// Shared by capture regression tests; keeping it beside the renderer makes
// the line-breaking implementation impossible to drift from canvas paint.
// eslint-disable-next-line react-refresh/only-export-components
export function wrapVisualText(
  value: string,
  width: number,
  fontFamily: string,
  fontSize: number,
  fontWeight: string,
  letterSpacing: number,
) {
  const measure = (line: string) =>
    measuredTextWidth(line, fontFamily, fontSize, fontWeight, letterSpacing)
  if (!Number.isFinite(width) || width <= 0) return value.split('\n')

  const lines: string[] = []
  for (const hardLine of value.split('\n')) {
    const words = hardLine.trim().split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (!line || measure(candidate) <= width) {
        line = candidate
        continue
      }
      lines.push(line)
      if (measure(word) <= width) {
        line = word
        continue
      }
      // Match overflow-wrap: break-word for an individual token wider than
      // the container, without splitting ordinary words unnecessarily.
      let fragment = ''
      for (const character of Array.from(word)) {
        const candidateFragment = fragment + character
        if (fragment && measure(candidateFragment) > width) {
          lines.push(fragment)
          fragment = character
        } else fragment = candidateFragment
      }
      line = fragment
    }
    lines.push(line)
  }
  return lines
}

export function VisualSvg({
  objects,
  variables = noVariables,
  editingTextId,
}: {
  objects: VisualObject[]
  variables?: DesignVariable[]
  editingTextId?: string | null
}) {
  return (
    <>
      {objects
        .filter((o) => !o.hidden)
        .map((o) => (
          <VisualObjectView key={o.id} raw={o} variables={variables} editingTextId={editingTextId} />
        ))}
    </>
  )
}
const VisualObjectView = memo(function VisualObjectView({
  raw,
  variables,
  editingTextId,
}: {
  raw: VisualObject
  variables: DesignVariable[]
  editingTextId?: string | null
}) {
  const o = {
    ...raw,
    layout: { ...raw.layout },
    children: raw.children,
  }
  for (const [key, id] of Object.entries(o.bindings ?? {})) {
    const v = variables.find((v) => v.id === id)
    if (!v) continue
    if (['fill', 'stroke', 'text', 'fontFamily', 'fontWeight', 'textAlign'].includes(key))
      Object.assign(o, { [key]: v.value })
    if (['width', 'height', 'fontSize', 'opacity', 'lineHeight', 'letterSpacing'].includes(key))
      Object.assign(o, { [key]: Number.parseFloat(v.value) || 0 })
    if (key === 'radius') {
      const radius = Number.parseFloat(v.value) || 0
      o.radius = [radius, radius, radius, radius]
    }
    if (key === 'hidden') o.hidden = v.value === 'true'
    if (key === 'gap' || key === 'padding') {
      o.children = o.children.map((child) => ({ ...child }))
      o.layout[key] = Number.parseFloat(v.value) || 0
      applyVisualLayout(o)
    }
  }
  if (o.hidden) return null
  const [tl, tr, br, bl] = o.radius.map((r) =>
    Math.min(r, o.width / 2, o.height / 2),
  )
  const outline = `M ${tl} 0 H ${o.width - tr} Q ${o.width} 0 ${o.width} ${tr} V ${o.height - br} Q ${o.width} ${o.height} ${o.width - br} ${o.height} H ${bl} Q 0 ${o.height} 0 ${o.height - bl} V ${tl} Q 0 0 ${tl} 0 Z`
  const gradient = o.gradient?.match(/(?:#[\da-f]{3,8}|rgba?\([^)]+\))/gi)
  const shadowColor = o.shadow?.match(/rgba?\([^)]+\)|#[a-f0-9]+/i)?.[0]
  const shadowValues = o.shadow
    ?.replace(/rgba?\([^)]+\)|#[a-f0-9]+/gi, '')
    .match(/-?[\d.]+px/g)
    ?.map(parseFloat)
  const hasShadow =
    !!shadowColor && !!shadowValues?.length && !o.shadow?.includes('inset')
  const paint = {
    fill: gradient?.length ? `url(#gradient-${o.id})` : o.fill,
    fillOpacity: o.fillOpacity,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
    strokeOpacity: o.strokeOpacity,
  }
  const textLines =
    o.kind === 'Text'
      ? wrapVisualText(
          o.text ?? '',
          o.width,
          o.fontFamily,
          o.fontSize,
          o.fontWeight,
          o.letterSpacing,
        )
      : []
  let textCursor = 0
  const richTextLines = textLines.map((line) => {
    const source = o.text ?? ''
    const found = line ? source.indexOf(line, textCursor) : textCursor
    const start = found >= 0 ? found : textCursor
    const end = Math.min(source.length, start + line.length)
    textCursor = Math.min(source.length, end + (source[end] === '\n' ? 1 : 0))
    return { line, segments: textSegments(source, o.textRuns, start, end) }
  })
  return (
    <g
      key={o.id}
      data-object-id={o.id}
      transform={`translate(${o.x} ${o.y}) rotate(${o.rotation} ${o.width / 2} ${o.height / 2})`}
      opacity={o.opacity}
    >
      <defs>
        {hasShadow && (
          <filter
            id={`shadow-${o.id}`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feDropShadow
              dx={shadowValues?.[0] ?? 0}
              dy={shadowValues?.[1] ?? 0}
              stdDeviation={(shadowValues?.[2] ?? 0) / 2}
              floodColor={shadowColor}
            />
          </filter>
        )}
        {o.arrow && (
          <marker
            id={`arrow-${o.id}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={o.stroke} />
          </marker>
        )}
        <clipPath id={`clip-${o.id}`}>
          <path d={outline} />
        </clipPath>
        {gradient && (
          <linearGradient id={`gradient-${o.id}`} x2="0" y2="1">
            {gradient.map((c, i) => (
              <stop
                key={i}
                offset={`${(i / Math.max(1, gradient.length - 1)) * 100}%`}
                stopColor={c}
              />
            ))}
          </linearGradient>
        )}
        {!!o.blur && (
          <filter id={`blur-${o.id}`}>
            <feGaussianBlur stdDeviation={o.blur} />
          </filter>
        )}
      </defs>
      <g
        clipPath={o.clip ? `url(#clip-${o.id})` : undefined}
        filter={
          o.blur
            ? `url(#blur-${o.id})`
            : hasShadow
              ? `url(#shadow-${o.id})`
              : undefined
        }
      >
        {o.kind === 'Text' ? (
          <text
            {...paint}
            visibility={o.id === editingTextId ? 'hidden' : undefined}
            fontFamily={o.fontFamily}
            fontSize={o.fontSize}
            fontWeight={o.fontWeight}
            letterSpacing={o.letterSpacing}
            textDecoration={o.textDecoration}
            textAnchor={
              o.textAlign === 'center'
                ? 'middle'
                : o.textAlign === 'right'
                  ? 'end'
                  : 'start'
            }
          >
            {richTextLines.map(({ line, segments }, i) => (
              <tspan
                key={i}
                x={
                  o.textAlign === 'center'
                    ? o.width / 2
                    : o.textAlign === 'right'
                      ? o.width
                      : 0
                }
                y={o.fontSize + i * o.lineHeight}
              >
                {segments.length ? segments.map((segment) => (
                  <tspan key={`${segment.start}-${segment.end}`} fontWeight={segment.fontWeight} fill={segment.color}>{segment.text}</tspan>
                )) : line}
              </tspan>
            ))}
          </text>
        ) : o.kind === 'Ellipse' || o.kind === 'Radio' ? (
          <ellipse
            cx={o.width / 2}
            cy={o.height / 2}
            rx={o.width / 2}
            ry={o.height / 2}
            {...paint}
          />
        ) : o.kind === 'Line' ? (
          <line
            markerEnd={o.arrow ? `url(#arrow-${o.id})` : undefined}
            x1={0}
            y1={o.height / 2}
            x2={o.width}
            y2={o.height / 2}
            {...paint}
          />
        ) : o.kind === 'Vector' && o.path ? (
          <path d={o.path} {...paint} />
        ) : o.kind === 'Image' || o.kind === 'Avatar' ? (
          <image
            href={o.src}
            width={o.width}
            height={o.height}
            preserveAspectRatio={
              o.imageFit === 'contain'
                ? 'xMidYMid meet'
                : o.imageFit === 'fill'
                  ? 'none'
                  : 'xMidYMid slice'
            }
            clipPath={`url(#clip-${o.id})`}
          />
        ) : (
          <path d={outline} {...paint} />
        )}
        {o.kind === 'Icon' && o.viewBox ? (
          <svg width={o.width} height={o.height} viewBox={o.viewBox}>
            <VisualSvg objects={o.children} variables={variables} editingTextId={editingTextId} />
          </svg>
        ) : (
          <VisualSvg objects={o.children} variables={variables} editingTextId={editingTextId} />
        )}
      </g>
    </g>
  )
})

export const FontDefinitions = memo(function FontDefinitions({
  fonts = [],
}: {
  fonts?: VisualPage['fonts']
}) {
  return (
    <style>
      {fonts
        .map(
          (font) =>
            `@font-face{font-family:${font.family};font-weight:${font.weight};font-style:${font.style};src:url("${font.data}")}`,
        )
        .join('\n')}
    </style>
  )
})
