import {gradientTextStyle} from './textPaint'
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
    minWidth: 0,
    maxWidth: 'none',
    minHeight: 0,
    maxHeight: 'none',
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
  if(appearance.transform)transforms.push(appearance.transform)
  if (appearance.rotation) transforms.push(`rotate(${appearance.rotation}deg)`)
  return {
    zIndex: appearance.zIndex,
    backgroundColor: appearance.backgroundColor,
    backgroundImage: appearance.backgroundImage,
    backgroundSize: appearance.backgroundSize,
    backgroundPosition: appearance.backgroundPosition,
    backgroundRepeat: appearance.backgroundRepeat,
    backgroundBlendMode: appearance.backgroundBlendMode,
    backgroundOrigin: appearance.backgroundOrigin,
    backgroundClip: appearance.backgroundClip,
    clipPath: appearance.clipPath,
    maskImage: appearance.maskImage,
    maskSize: appearance.maskSize,
    maskPosition: appearance.maskPosition,
    maskRepeat: appearance.maskRepeat,
    maskMode: appearance.maskMode,
    maskComposite: appearance.maskComposite,
    backdropFilter: appearance.backdropFilter,
    mixBlendMode: appearance.mixBlendMode,
    isolation: appearance.isolation,
    overflowClipMargin: appearance.overflowClipMargin,

    objectPosition: appearance.objectPosition,
    border: appearance.border ? `${appearance.border.width}px ${appearance.border.style ?? 'solid'} ${appearance.border.color ?? 'currentColor'}` : undefined,
    borderRadius: `${appearance.radius[0]}px ${appearance.radius[1]}px ${appearance.radius[2]}px ${appearance.radius[3]}px`,
    boxShadow: appearance.boxShadow,
    opacity: appearance.opacity === 1 ? undefined : appearance.opacity,
    objectFit: appearance.objectFit,
    filter: appearance.filter ?? (appearance.blur ? `blur(${appearance.blur}px)` : undefined),
    transformOrigin: appearance.transformOrigin,
    transform: transforms.length ? transforms.join(' ') : undefined,
    overflow: appearance.clipX === undefined && appearance.clipY === undefined && appearance.clip ? 'hidden' : undefined,
    overflowX: appearance.clipX === undefined ? undefined : appearance.clipX ? 'clip' : 'visible',
    overflowY: appearance.clipY === undefined ? undefined : appearance.clipY ? 'clip' : 'visible',
    accentColor: appearance.accentColor,
    colorScheme: appearance.colorScheme,
  }
}

export function typographyStyleFor(typography: StructuredTypography): CSSLikeStyle {
  return {
    whiteSpace: typography.whiteSpace === 'normal' ? 'pre-wrap' : typography.whiteSpace || 'pre-wrap',
    fontStyle: typography.fontStyle,
    textWrap: ['pre', 'nowrap'].includes(typography.whiteSpace || '') ? 'nowrap' : typography.textWrap,
    fontFeatureSettings: typography.fontFeatureSettings,
    fontVariationSettings: typography.fontVariationSettings,
    fontOpticalSizing: typography.fontOpticalSizing,
    fontKerning: typography.fontKerning,
    fontStretch: typography.fontStretch,
    wordSpacing: typography.wordSpacing,
    WebkitFontSmoothing: typography.WebkitFontSmoothing,
    fontFamily: typography.fontFamily,
    fontSize: `${typography.fontSize}px`,
    fontWeight: typography.fontWeight,
    lineHeight: `${typography.lineHeight}px`,
    letterSpacing: `${typography.letterSpacing}px`,
    textAlign: typography.textAlign,
    textDecoration: typography.textDecoration,
    color: typography.color,
    ...gradientTextStyle(typography.gradient,typography.gradient?.bounds?{x:0,y:0}:undefined),
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

/** Native controls must not inherit the editor/modal's form-field sizing or paint. */
export function controlStyleFor(node:StructuredNode):CSSLikeStyle {
 return {'--frameui-placeholder-color':node.source.control?.placeholderColor??'#757575','--frameui-placeholder-opacity':String(node.source.control?.placeholderOpacity??1),all:'initial',display:'block',boxSizing:'border-box',minWidth:0,minHeight:0,maxWidth:'none',maxHeight:'none',border:'none',backgroundColor:'transparent',margin:0,...appearanceStyleFor(node.appearance),...(node.typography?typographyStyleFor(node.typography):{}),padding:containerStyleFor(node).padding??0,width:'100%',height:'100%'}
}
