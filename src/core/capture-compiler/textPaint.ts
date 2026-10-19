import type { TextGradient, TextStyleRun } from '@shared/types/richText'
import type { StructuredTypography } from '@shared/types/structuredDesign'
import { textSegments } from '../visual/textRuns'
import type { CSSLikeStyle } from './structuredNodeStyle'
export function gradientTextStyle(
  gradient: TextGradient | null | undefined,
  box?: { x: number; y: number },
): CSSLikeStyle {
  if (!gradient) return {}
  const bounds = box ? gradient.bounds : undefined
  const fragment = box
    ? gradient.fragments?.find(
        (f) =>
          box.x >= f.x - 2 &&
          box.x < f.x + f.width + 2 &&
          box.y >= f.y - 4 &&
          box.y < f.y + f.height,
      )
    : undefined
  const natural = !gradient.size || gradient.size === 'auto' || gradient.size === 'auto auto'
  const width = fragment
    ? gradient.clone
      ? fragment.width
      : gradient.fragments!.reduce((n, f) => n + f.width, 0)
    : bounds?.width
  const height = fragment ? fragment.height : bounds?.height
  return {
    backgroundImage: gradient.image,
    backgroundSize: bounds && natural ? width + 'px ' + height + 'px' : gradient.size,
    backgroundPosition: fragment
      ? fragment.x -
        box!.x -
        (gradient.clone ? 0 : fragment.offset) +
        'px ' +
        (fragment.y - box!.y) +
        'px'
      : bounds
        ? bounds.x - box!.x + 'px ' + (bounds.y - box!.y) + 'px'
        : gradient.position,
    backgroundRepeat: gradient.repeat ?? 'no-repeat',
    boxDecorationBreak: gradient.clone ? 'clone' : undefined,
    WebkitBoxDecorationBreak: gradient.clone ? 'clone' : undefined,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
  }
}
export function textRunStyle(
  run: Omit<TextStyleRun, 'start' | 'end'>,
  box?: { x: number; y: number },
): CSSLikeStyle {
  return {
    fontWeight: run.fontWeight,
    fontStyle: run.fontStyle,
    fontFamily: run.fontFamily,
    fontSize: run.fontSize,
    lineHeight: run.lineHeight === undefined ? undefined : run.lineHeight + 'px',
    letterSpacing: run.letterSpacing,
    textDecoration: run.textDecoration,
    color: run.color,
    WebkitTextFillColor: run.gradient ? undefined : run.color,
    ...gradientTextStyle(run.gradient, box),
  }
}
export function capturedTextParts(t: StructuredTypography) {
  let offset = 0
  return (t.captureLines ?? []).map((line) => {
    const start = line.start ?? t.text.indexOf(line.text, offset)
    offset = Math.max(offset, start + line.text.length)
    return {
      ...line,
      segments: textSegments(
        t.text,
        t.textRuns,
        Math.max(0, start),
        Math.max(0, start) + line.text.length,
      ),
    }
  })
}
/** Older captures kept text-clipped paint on a wrapper. Inherit it for display
 * without rewriting the saved design or guessing missing source information. */
export function inheritedTextPaint(
  node: import('@shared/types/structuredDesign').StructuredNode,
  inherited?: TextGradient,
): TextGradient | undefined {
  const a = node.appearance
  return a.backgroundClip?.includes('text') && a.backgroundImage
    ? {
        image: a.backgroundImage,
        size: a.backgroundSize,
        position: a.backgroundPosition,
        repeat: a.backgroundRepeat,
        bounds: { x: 0, y: 0, width: node.bounds.width, height: node.bounds.height },
      }
    : inherited
}
export function childTextPaint(
  paint: TextGradient | undefined,
  child: import('@shared/types/structuredDesign').StructuredNode,
): TextGradient | undefined {
  if (!paint) return undefined
  return {
    ...paint,
    bounds: paint.bounds
      ? { ...paint.bounds, x: paint.bounds.x - child.bounds.x, y: paint.bounds.y - child.bounds.y }
      : undefined,
  }
}
