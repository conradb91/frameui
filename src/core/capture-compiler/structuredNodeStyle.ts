import type { StructuredAppearance, StructuredNode, StructuredTypography } from '@shared/types/structuredDesign'

/**
 * Pure CSS-computation for `StructuredFrameView.tsx` (Stage 3 of the
 * capture-engine rebuild, docs/CAPTURE_ENGINE_REBUILD_SPEC.md §14) — plain
 * objects in, plain objects out, no React import, so this is trivially
 * unit-testable and portable, unlike `VisualSvg.tsx`'s inline approach.
 * `CSSLikeStyle` intentionally isn't `React.CSSProperties` so this module
 * has zero React dependency; the values are always valid CSS regardless.
 */
export type CSSLikeStyle = Record<string, string | number | undefined>

/** How a node's own `layout` lays out *its children* — flex/grid/free. */
export function containerStyleFor(node: StructuredNode): CSSLikeStyle {
  const { layout } = node
  if (layout.mode === 'stack') {
    return {
      position: 'relative',
      display: 'flex',
      flexDirection: flexDirectionOf(layout.direction, layout.reverse),
      flexWrap: layout.wrap ? 'wrap' : 'nowrap',
      alignItems: layout.align,
      justifyContent: layout.justify,
      alignContent: layout.alignContent,
      gap: pxOrUndefined(layout.gap),
      padding: paddingShorthand(layout.padding),
      minWidth: pxOrUndefined(layout.minWidth),
      maxWidth: pxOrUndefined(layout.maxWidth),
    }
  }
  if (layout.mode === 'grid') {
    return {
      position: 'relative',
      display: 'grid',
      gridTemplateColumns: layout.gridTemplateColumns,
      gridTemplateRows: layout.gridTemplateRows,
      gridAutoFlow: layout.gridAutoFlow,
      alignItems: layout.align,
      justifyContent: layout.justify,
      alignContent: layout.alignContent,
      gap: pxOrUndefined(layout.gap),
      padding: paddingShorthand(layout.padding),
      minWidth: pxOrUndefined(layout.minWidth),
      maxWidth: pxOrUndefined(layout.maxWidth),
    }
  }
  // 'free' — no flex/grid properties at all; children are positioned
  // absolutely via `capturedPositionStyleFor` instead.
  return {
    position: 'relative',
    padding: paddingShorthand(layout.padding),
    minWidth: pxOrUndefined(layout.minWidth),
    maxWidth: pxOrUndefined(layout.maxWidth),
  }
}

/** A captured frame records actual laid-out boxes. Replaying flex/grid flow
 * with fixed child dimensions can wrap differently after fonts and nested
 * wrappers are reconstructed, so render the captured boxes at their measured
 * positions while retaining the original layout metadata for editing. */
export function capturedPositionStyleFor(child: StructuredNode): CSSLikeStyle {
  return {
    position: 'absolute',
    left: `${child.bounds.x}px`,
    top: `${child.bounds.y}px`,
    width: `${child.bounds.width}px`,
    height: `${child.bounds.height}px`,
  }
}

function flexDirectionOf(direction: 'horizontal' | 'vertical' | undefined, reverse: boolean | undefined): string {
  const base = direction === 'vertical' ? 'column' : 'row'
  return reverse ? `${base}-reverse` : base
}

function paddingShorthand(padding: StructuredNode['layout']['padding']): string | undefined {
  if (!padding) return undefined
  return `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`
}

function pxOrUndefined(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value}px`
}

export function appearanceStyleFor(appearance: StructuredAppearance): CSSLikeStyle {
  const transforms: string[] = []
  if (appearance.rotation) transforms.push(`rotate(${appearance.rotation}deg)`)
  return {
    zIndex: appearance.zIndex,
    backgroundColor: appearance.backgroundColor,
    backgroundImage: appearance.backgroundImage,
    border: appearance.border ? `${appearance.border.width}px ${appearance.border.style ?? 'solid'} ${appearance.border.color ?? 'currentColor'}` : undefined,
    borderRadius: `${appearance.radius[0]}px ${appearance.radius[1]}px ${appearance.radius[2]}px ${appearance.radius[3]}px`,
    boxShadow: appearance.boxShadow,
    opacity: appearance.opacity === 1 ? undefined : appearance.opacity,
    objectFit: appearance.objectFit,
    filter: appearance.blur ? `blur(${appearance.blur}px)` : undefined,
    transform: transforms.length ? transforms.join(' ') : undefined,
    overflow: appearance.clip ? 'hidden' : undefined,
  }
}

export function typographyStyleFor(typography: StructuredTypography): CSSLikeStyle {
  return {
    whiteSpace: typography.whiteSpace === 'normal' ? 'pre-wrap' : typography.whiteSpace || 'pre-wrap',
    fontStyle: typography.fontStyle,
    fontFamily: typography.fontFamily,
    fontSize: `${typography.fontSize}px`,
    fontWeight: typography.fontWeight,
    lineHeight: `${typography.lineHeight}px`,
    letterSpacing: `${typography.letterSpacing}px`,
    textAlign: typography.textAlign,
    textDecoration: typography.textDecoration,
    color: typography.color,
  }
}

/** Properties this module's own functions ever emit as a raw number rather
 * than an already-suffixed string — a bare number for anything else still
 * gets a `px` suffix, matching React's own well-known unitless-property
 * convention, sized down to what's actually exercised today. */
const UNITLESS_CSS_PROPS = new Set(['opacity', 'flexShrink', 'flexGrow', 'zIndex', 'fontWeight', 'lineHeight', 'order'])

/** Stage 4 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
 * turns one of this module's style objects into an inline `style="..."`
 * attribute value, for `renderStructuredFrameToHtml.ts`'s pure HTML string
 * output (`StructuredFrameView.tsx` uses these same style objects directly
 * as React `style` props instead — this is the string-serialization path). */
export function styleToInlineCss(style: CSSLikeStyle): string {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const prop = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      const cssValue = typeof value === 'number' && !UNITLESS_CSS_PROPS.has(key) ? `${value}px` : value
      return `${prop}:${cssValue}`
    })
    .join(';')
}
