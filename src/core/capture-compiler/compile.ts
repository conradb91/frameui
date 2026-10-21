import {emptyLegacyClip,legacyClipPath} from './legacyClip'
import {richTextFromCapture,captureTextGradient} from './capturedRichText'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import type {
  StructuredAppearance,
  StructuredConstraints,
  StructuredLayout,
  StructuredNode,
  StructuredNodeType,
  StructuredSource,
  StructuredTokenBindings,
  StructuredTypography,
  TokenBindableProperty,
} from '@shared/types/structuredDesign'

// Tiny pure CSS-parsing helpers, deliberately duplicated from
// `src/core/visual/normalize.ts` rather than shared. `normalize.ts` is
// live, tested, production-critical code for today's real captures; this
// module stays independent of it end to end (schema, kind table,
// collapse rule, and now these helpers too), matching the capture-engine
// spec's "legacy and V2 coexist independently" migration philosophy
// (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §38) rather than coupling a stage-2
// experiment to a file nothing about this stage needs to touch.
const number = (s?: string) => Number.parseFloat(s ?? '') || 0
const cssLength = (value?: string): number | undefined => {
  if (!value || value === 'none' || value === 'auto' || value === 'normal') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
const visiblePaint = (s?: string) =>
  !!s && s !== 'transparent' && s !== 'rgba(0, 0, 0, 0)' && s !== 'none'
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

/** Expands the CSS 1-4 value box shorthand. Only the shorthand string is
 * captured (no per-side longhands), and `getComputedStyle` always resolves
 * it to px-only tokens, so this is whitespace-split + `parseFloat` — no
 * unit-conversion concerns. */
function expandBoxShorthand(value?: string): { top: number; right: number; bottom: number; left: number } | undefined {
  if (!value) return undefined
  const parts = value.trim().split(/\s+/).map((p) => Number.parseFloat(p) || 0)
  if (!parts.length) return undefined
  const [top, right = top, bottom = top, left = right] = parts
  return { top, right, bottom, left }
}

function horizontalRulePaint(s: Record<string, string>, elementHeight: number) {
  const edges = [
    { width: number(s.borderTopWidth), style: s.borderTopStyle, color: s.borderTopColor },
    { width: number(s.borderBottomWidth), style: s.borderBottomStyle, color: s.borderBottomColor },
  ]
  const edge = edges.find(({ width, style, color }) =>
    width > 0 && style !== 'none' && style !== 'hidden' && visiblePaint(color),
  )
  if (edge) return { color: edge.color, width: edge.width }
  if (visiblePaint(s.backgroundColor))
    return { color: s.backgroundColor, width: Math.max(1, elementHeight) }
  return {
    color: visiblePaint(s.borderColor) ? s.borderColor : s.color || 'currentColor',
    width: number(s.borderWidth) || Math.max(1, elementHeight),
  }
}

type CapturedBorderEdge = {
  side: 'top' | 'right' | 'bottom' | 'left'
  width: number
  style?: string
  color?: string
}

function splitBorderEdges(s: Record<string, string>): CapturedBorderEdge[] {
  if (!['Top', 'Right', 'Bottom', 'Left'].some((side) => s[`border${side}Width`] !== undefined)) return []
  const shorthand = (s.borderWidth ?? '').trim().split(/\s+/).filter(Boolean).map(number)
  const [top = 0, right = top, bottom = top, left = right] = shorthand
  const fallback = { top, right, bottom, left }
  const edges = (['top', 'right', 'bottom', 'left'] as const).map((side) => {
    const title = `${side[0].toUpperCase()}${side.slice(1)}`
    return {
      side,
      width: number(s[`border${title}Width`]) || fallback[side],
      style: s[`border${title}Style`] || s.borderStyle,
      color: s[`border${title}Color`] || s.borderColor,
    }
  })
  const first = edges[0]
  if (edges.every((edge) => edge.width === first.width && edge.style === first.style && edge.color === first.color)) return []
  return edges.filter((edge) => edge.width > 0 && edge.style !== 'none' && edge.style !== 'hidden' && visiblePaint(edge.color))
}

function edgeBorderShadows(edges: CapturedBorderEdge[]): string | undefined {
  if (!edges.length) return undefined
  return edges.map((edge) => {
    const x = edge.side === 'left' ? edge.width : edge.side === 'right' ? -edge.width : 0
    const y = edge.side === 'top' ? edge.width : edge.side === 'bottom' ? -edge.width : 0
    return `inset ${x}px ${y}px 0 0 ${edge.color}`
  }).join(', ')
}

const SVG_SHAPE_TAGS = new Set(['use', 'g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path'])
const SECTION_TAGS = new Set(['header', 'footer', 'aside', 'nav', 'section', 'main', 'article'])
/** Block-level tags that are the semantic "owner" of the text inside them —
 * a heading/paragraph/label/list-item/table-cell must compile to exactly
 * ONE Text node using its own bounds and typography, never one node per
 * rendered line or one node per inline `<span>`/`<strong>` child. Excludes
 * `button`/`a`/component-ish tags on purpose: those already get their own
 * `TAG_KIND` (a real container with a Text child), which is the desired
 * shape for an interactive element's label. */
const TEXT_OWNER_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'label', 'li', 'td', 'th',
  'span','strong','b','em','i','small','frameui-richtext',
  'figcaption', 'blockquote', 'dt', 'dd',
])
/** Tags that make an element's content NOT a single plain-text run — a
 * paragraph containing a button or an image must keep its DOM structure
 * rather than being flattened into one Text node's string. */
const TEXT_OWNER_EXCLUDED_DESCENDANT_TAGS = new Set([
  'button', 'a', 'img', 'video', 'svg', 'input', 'textarea', 'select',
])
/** True when every leaf under `el` is plain text/`<br>` — safe to collapse
 * into one Text node's string regardless of how many inline wrapper
 * elements (`span`/`strong`/`em`/…) or rendered lines the browser used. */
function isPureTextSubtree(el: CapturedElement): boolean {
  const tag = el.tag.toLowerCase()
  if(/^(?:inline-)?(?:flex|grid)$/.test(el.styles.display??''))return false
  if (tag === 'frameui-text' || tag === 'br') return true
  if (tag === 'frameui-visual') return false
  if (TEXT_OWNER_EXCLUDED_DESCENDANT_TAGS.has(tag)) return false
  return el.children.every(isPureTextSubtree)
}
function inlineTextGroups(parent:CapturedElement):CapturedElement[] {
 if(parent.tag==='frameui-richtext'||['svg','g','defs','symbol','mask','clippath','marker','pattern','text','tspan'].includes(parent.tag.toLowerCase()))return parent.children
 const out:CapturedElement[]=[];let group:CapturedElement[]=[]
 const flush=()=>{if(group.length>1){const x=Math.min(...group.map(n=>n.rect.x)),y=Math.min(...group.map(n=>n.rect.y)),right=Math.max(...group.map(n=>n.rect.x+n.rect.width)),bottom=Math.max(...group.map(n=>n.rect.y+n.rect.height));out.push({tag:'frameui-richtext',styles:{...parent.styles,backgroundImage:'none',backgroundColor:'transparent',borderWidth:'0',padding:'0',opacity:'1',transform:'none'},rect:{x,y,width:right-x,height:bottom-y},children:group})}else out.push(...group);group=[]}
 for(const child of parent.children){if((child.tag==='frameui-text'||child.styles.display==='inline')&&isPureTextSubtree(child))group.push(child);else{flush();out.push(child)}}flush();return out
}
/** Retain exact spacing from current snapshots; older capture trees trimmed
 * each run, so retain their historical space-joining fallback. Explicit br
 * elements remain newlines, independent of browser wrapping. */
function collectOwnerText(el: CapturedElement): string {
  const parts: string[] = []
  let exact = false
  const walk = (e: CapturedElement): void => {
    if(emptyLegacyClip(e.styles.clip)||e.styles.display==='none'||e.styles.visibility==='hidden'||e.styles.opacity==='0')return
    const tag = e.tag.toLowerCase()
    if (tag === 'frameui-text') { if (e.textPreview) parts.push(e.textPreview); if (e.attributes?.['data-frameui-exact-text']) exact = true }
    else if (tag === 'br') parts.push('\n')
    else e.children.forEach(walk)
  }
  walk(el)
  let out = ''
  for (const part of parts) {
    if (part === '\n') out = out.replace(/ +$/, '') + '\n'
    else out += (!exact && out && !out.endsWith('\n') ? ' ' : '') + part
  }
  return out.trim()
}
/** Real HTML/ARIA tag → kind. Synthetic tags from `reconstructSnapshotTree`
 * (`frameui-text`, `frameui-visual`) are handled separately below — they
 * have no element identity of their own to look up here. */
const TAG_KIND: Record<string, StructuredNodeType> = {
  button: 'Button',
  a: 'Link',
  input: 'Input',
  textarea: 'Input',
  select: 'Input',
  img: 'Image',
  video: 'Image',
  svg: 'SVG',
  hr: 'Divider',
}

function layoutOf(s: Record<string, string>): StructuredLayout {
  const isFlex = s.display === 'flex'
  const isGrid = s.display === 'grid'
  const mode: StructuredLayout['mode'] = isGrid ? 'grid' : isFlex ? 'stack' : 'free'
  const padding = expandBoxShorthand(s.padding)
  return {
    mode,
    direction: isFlex ? (s.flexDirection?.startsWith('column') ? 'vertical' : 'horizontal') : undefined,
    reverse: isFlex ? s.flexDirection === 'row-reverse' || s.flexDirection === 'column-reverse' : undefined,
    wrap: isFlex ? s.flexWrap === 'wrap' : undefined,
    align: isFlex || isGrid ? s.alignItems || undefined : undefined,
    justify: isFlex || isGrid ? s.justifyContent || undefined : undefined,
    alignContent: isFlex || isGrid ? s.alignContent || undefined : undefined,
    gap: s.gap ? number(s.gap) : undefined,
    gridTemplateColumns: isGrid ? s.gridTemplateColumns || undefined : undefined,
    gridTemplateRows: isGrid ? s.gridTemplateRows || undefined : undefined,
    gridAutoFlow: isGrid ? s.gridAutoFlow || undefined : undefined,
    padding,
    minWidth: cssLength(s.minWidth),
    maxWidth: cssLength(s.maxWidth),
  }
}

function constraintsOf(s: Record<string, string>): StructuredConstraints {
  return { position: (s.position as StructuredConstraints['position']) || 'static' }
}

function appearanceOf(s: Record<string, string>, tag?: string, elementHeight = 0, elementWidth = 0): StructuredAppearance {
  const overflow = (s.overflow || '').split(/\s+/)
  const clips = (value: string) => ['hidden', 'clip', 'scroll', 'auto'].includes(value)
  const clipX = clips(s.overflowX || overflow[0])
  const clipY = clips(s.overflowY || overflow[1] || overflow[0])
  const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
    .map((k) => {const value=s[k]||s.borderRadius||'0';return value.trim().endsWith('%')?number(value)*elementHeight/100:number(value)}) as StructuredAppearance['radius']
  const edgeBorders = tag === 'hr' ? [] : splitBorderEdges(s)
  const edgeShadow = edgeBorderShadows(edgeBorders)
  const authoredShadow = visiblePaint(s.boxShadow) ? s.boxShadow : undefined
  const appearance: StructuredAppearance = {
    zIndex: s.zIndex && s.zIndex !== 'auto' ? number(s.zIndex) : undefined,
    backgroundColor: visiblePaint(s.backgroundColor) ? s.backgroundColor : undefined,
    backgroundImage: visiblePaint(s.backgroundImage) ? s.backgroundImage : undefined,
    backgroundSize: s.backgroundSize || undefined,
    backgroundPosition: s.backgroundPosition || undefined,
    backgroundRepeat: s.backgroundRepeat || undefined,
    backgroundBlendMode: s.backgroundBlendMode && s.backgroundBlendMode !== 'none' ? s.backgroundBlendMode : undefined,
    backgroundOrigin: s.backgroundOrigin && s.backgroundOrigin !== 'none' ? s.backgroundOrigin : undefined,
    backgroundClip: s.backgroundClip && s.backgroundClip !== 'none' ? s.backgroundClip : undefined,
    clipPath: s.clipPath && s.clipPath !== 'none' ? s.clipPath : legacyClipPath(s.clip,elementWidth,elementHeight),
    maskImage: s.maskImage && s.maskImage !== 'none' ? s.maskImage : undefined,
    maskSize: s.maskSize && s.maskSize !== 'none' ? s.maskSize : undefined,
    maskPosition: s.maskPosition && s.maskPosition !== 'none' ? s.maskPosition : undefined,
    maskRepeat: s.maskRepeat && s.maskRepeat !== 'none' ? s.maskRepeat : undefined,
    maskMode: s.maskMode && s.maskMode !== 'none' ? s.maskMode : undefined,
    maskComposite: s.maskComposite && s.maskComposite !== 'none' ? s.maskComposite : undefined,
    filter: s.filter && s.filter !== 'none' ? s.filter : undefined,
    backdropFilter: s.backdropFilter && s.backdropFilter !== 'none' ? s.backdropFilter : undefined,
    mixBlendMode: s.mixBlendMode && s.mixBlendMode !== 'none' ? s.mixBlendMode : undefined,
    isolation: s.isolation && s.isolation !== 'none' ? s.isolation : undefined,
    overflowClipMargin: s.overflowClipMargin && s.overflowClipMargin !== 'none' ? s.overflowClipMargin : undefined,

    objectPosition: s.objectPosition || undefined,
    border: edgeBorders.length ? undefined : number(s.borderWidth) > 0 ? { width: number(s.borderWidth), style: s.borderStyle, color: s.borderColor } : undefined,
    radius: radii,
    boxShadow: [authoredShadow, edgeShadow].filter(Boolean).join(', ') || undefined,
    opacity: s.opacity === undefined ? 1 : Number(s.opacity),
    fill: s.fill || undefined,
    stroke: visiblePaint(s.stroke) ? s.stroke : undefined,
    strokeWidth: s.strokeWidth ? number(s.strokeWidth) : undefined,
    objectFit: s.objectFit === 'cover' || s.objectFit === 'contain' || s.objectFit === 'fill' ? s.objectFit : undefined,
    blur: blurFromFilter(s.filter),
    transform: s.frameuiTransform,
    transformOrigin: s.frameuiTransformOrigin,
    rotation: rotationFromTransform(s.transform),
    clip: clipX || clipY,
    clipX, clipY,
    accentColor: s.accentColor || undefined,
    colorScheme: s.colorScheme || undefined,
  }
  if (tag === 'hr') {
    const divider = horizontalRulePaint(s, elementHeight)
    appearance.backgroundColor = undefined
    appearance.backgroundImage = undefined
    appearance.border = undefined
    appearance.fill = undefined
    appearance.stroke = divider.color
    appearance.strokeWidth = divider.width
  }
  return appearance
}

function typographyOf(s: Record<string, string>, text: string): StructuredTypography {
  return {
    text,
    textOverflow: s.textOverflow,
    whiteSpace: s.whiteSpace,
    fontStyle: s.fontStyle,
    textWrap: s.textWrap || undefined,
    fontFeatureSettings: s.fontFeatureSettings || undefined,
    fontVariationSettings: s.fontVariationSettings || undefined,
    fontOpticalSizing: s.fontOpticalSizing || undefined,
    fontKerning: s.fontKerning || undefined,
    fontStretch: s.fontStretch || undefined,
    wordSpacing: s.wordSpacing || undefined,
    WebkitFontSmoothing: s.WebkitFontSmoothing || undefined,
    fontFamily: s.fontFamily || 'sans-serif',
    fontSize: number(s.fontSize) || 16,
    fontWeight: s.fontWeight || '400',
    lineHeight: number(s.lineHeight) || number(s.fontSize) * 1.2,
    letterSpacing: number(s.letterSpacing),
    textAlign: s.textAlign || 'left',
    textDecoration: s.textDecoration && s.textDecoration !== 'none' ? s.textDecoration : undefined,
    color: s.color || undefined,
  }
}

const TOKEN_BINDABLE: TokenBindableProperty[] = [
  'backgroundColor', 'color', 'borderColor', 'fontSize', 'fontFamily', 'fontWeight',
  'lineHeight', 'letterSpacing', 'padding', 'margin', 'gap', 'borderRadius', 'boxShadow',
]
/** Spec §10/§11: store the raw browser value now; `.token` is left
 * `undefined` on every entry until a later stage's repository style index
 * exists — see the field's own doc comment in structuredDesign.ts. */
function tokenBindingsOf(s: Record<string, string>): StructuredTokenBindings | undefined {
  const bindings: StructuredTokenBindings = {}
  let any = false
  for (const prop of TOKEN_BINDABLE) {
    const value = s[prop]
    if (value !== undefined && value !== '') {
      bindings[prop] = { value }
      any = true
    }
  }
  return any ? bindings : undefined
}

/** Raw SVG presentation/geometry attributes worth carrying forward verbatim
 * for `SVG`/`Shape`-type nodes — deliberately not every attribute, just
 * enough to redraw the primitive (fill/stroke come from `appearance`
 * already, via computed style, not from here). */
const SVG_GEOMETRY_ATTRS = ['vector-effect','href','xlink:href','filter','mask','clip-path','d', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'x', 'y', 'width', 'height', 'viewBox', 'transform', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'fill-rule']
function svgGeometryOf(el: CapturedElement, tag: string): Record<string, string> | undefined {
  if (tag !== 'svg' && !SVG_SHAPE_TAGS.has(tag)) return undefined
  const a = el.attributes ?? {}
  const geometry: Record<string, string> = {}
  if(a['data-frameui-svg-definitions'])geometry.definitions=a['data-frameui-svg-definitions']
  for (const attr of SVG_GEOMETRY_ATTRS) if (a[attr] !== undefined) geometry[attr] = a[attr]
  if(el.styles.color)geometry.color=el.styles.color
  for (const [css, attr] of [['strokeLinecap', 'stroke-linecap'], ['strokeLinejoin', 'stroke-linejoin'], ['strokeDasharray', 'stroke-dasharray'], ['strokeDashoffset', 'stroke-dashoffset'], ['fillRule', 'fill-rule']]) if (el.styles[css]) geometry[attr] = el.styles[css]
  return Object.keys(geometry).length ? geometry : undefined
}
/** Same acceptance rule legacy `normalize.ts` already uses: only a safe,
 * already-inlined `data:image/...` URI, never a live/unstable browser URL. */
function imageSrcOf(el: CapturedElement, tag: string): string | undefined {
  const a = el.attributes ?? {}
  const candidate = tag === 'video' ? a.poster : a.src
  return candidate?.startsWith('data:image/') ? candidate : undefined
}

function sourceOf(el: CapturedElement, tag: string, ctx?: { file?: string; route?: string }): StructuredSource {
  const a = el.attributes ?? {}
  return {
    tag: el.tag,
    domId: el.id,
    classes: el.classes,
    file: a['data-frameui-source'] || ctx?.file,
    component: el.componentHint ? cleanName(el.componentHint) : undefined,
    selector: a.captureSelector,
    href: a.href,
    imageSrc: imageSrcOf(el, tag),
    svgGeometry: svgGeometryOf(el, tag),
    control: ['select','textarea'].includes(tag)?{type:tag as 'select'|'textarea',appearance:a['data-frameui-appearance'],value:a.controlValue??'',options:tag==='select'?parseControlOptions(a['data-frameui-options']):undefined,disabled:a.visualState==='Disabled'}:tag==='input'&&!['hidden','file','color','button','submit','reset','image'].includes(a.type)?{type:(['text','email','password','number','range','checkbox','radio','date','time'].includes(a.type)?a.type:'text') as NonNullable<StructuredSource['control']>['type'],appearance:a['data-frameui-appearance'],placeholder:a.placeholder,placeholderColor:a['data-frameui-placeholder-color'],placeholderOpacity:a['data-frameui-placeholder-opacity']===undefined?undefined:Number(a['data-frameui-placeholder-opacity']),value:a.type==='password'?'':a.controlValue,checked:a.controlChecked==='true',disabled:a.visualState==='Disabled',min:a.min,max:a.max,step:a.step}:undefined,
  }
}

/**
 * Compiles a captured DOM tree (sourced from CDP `DOMSnapshot`, via
 * `captureDomSnapshot`/`reconstructSnapshotTree`) into the new FrameUI
 * Design Model (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §36). Mirrors
 * `normalizeVisual`'s shape (`CapturedElement` in, array out, since a root
 * can splice/collapse away) but targets a different, richer schema and
 * diverges from it deliberately in several places — see this module's
 * top-of-file comment and docs/CAPTURE_ENGINE_REBUILD_SPEC.md.
 */
export function compileStructuredNodes(
  root: CapturedElement,
  ctx?: { file?: string; route?: string },
): StructuredNode[] {
  function convert(el: CapturedElement, parentX: number, parentY: number, parentId: string | null): StructuredNode[] {
    const s = el.styles
    const tag = el.tag.toLowerCase()
    if (s.display === 'contents') return el.children.flatMap((child) => convert(child, parentX, parentY, parentId))
    if (
      emptyLegacyClip(s.clip) ||
      s.display === 'none' ||
      s.visibility === 'hidden' ||
      (number(s.opacity) === 0 && s.opacity !== undefined)
    )
      return []
    // Absolute/fixed descendants may remain visible outside a zero-height body or wrapper.
    if(el.rect.width<=0||el.rect.height<=0){
      const clipped=(axis:string)=>/^(hidden|clip|scroll|auto)$/.test(s['overflow'+axis]||s.overflow||'')
      if(el.rect.width<=0&&clipped('X')||el.rect.height<=0&&clipped('Y'))return []
      return el.children.flatMap(child=>convert(child,parentX,parentY,parentId))
    }

    if (TEXT_OWNER_TAGS.has(tag) && !Object.values(expandBoxShorthand(s.padding)??{}).some(value=>value!==0) && !Object.values(expandBoxShorthand(s.borderWidth)??{}).some(value=>value!==0) && isPureTextSubtree(el)) {
      const rich = richTextFromCapture(el)
      const ownerText = rich.text || collectOwnerText(el)
      if (ownerText) {
        const id = crypto.randomUUID()
        const typography={...typographyOf(s,ownerText),...rich,text:ownerText}
        const runs=rich.textRuns??[],first=runs[0]
        if(first)Object.assign(typography,Object.fromEntries((['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing'] as const).flatMap(key=>first[key]!==undefined&&runs.every(run=>run[key]===first[key])?[[key,first[key]]]:[])))
        return [
          {
            id,
            type: 'Text',
            name: cleanName(ownerText.slice(0, 48)) || 'Text',
            parentId,
            children: [],
            bounds: { x: el.rect.x - parentX, y: el.rect.y - parentY, width: el.rect.width, height: el.rect.height },
            layout: layoutOf(s),
            appearance: appearanceOf(s, tag, el.rect.height, el.rect.width),
            typography,
            source: sourceOf(el, tag, ctx),
            tokenBindings: tokenBindingsOf(s),
            componentBinding: undefined,
            constraints: constraintsOf(s),
            visibility: true,
            locked: false,
            captureConfidence: undefined,
          },
        ]
      }
    }

    const layout = layoutOf(s)
    const appearance = appearanceOf(s, tag, el.rect.height, el.rect.width)
    const a = el.attributes ?? {}
    if (a.backgroundSrc?.startsWith('data:image/') && appearance.backgroundImage)
      appearance.backgroundImage = appearance.backgroundImage.replace(/url\((?:"[^"]+"|'[^']+'|[^)]*)\)/, `url("${a.backgroundSrc}")`)
    const text = tag === 'frameui-text' ? el.textPreview ?? '' : el.textPreview?.trim()
    const paint = !!(appearance.backgroundColor || appearance.backgroundImage || appearance.border || appearance.boxShadow || appearance.filter || appearance.backdropFilter || appearance.clipPath || appearance.maskImage || appearance.mixBlendMode && appearance.mixBlendMode!=='normal' || appearance.isolation==='isolate' || appearance.rotation || appearance.transform)
    const label = el.aria?.['aria-label'] || a.alt || (el.componentHint ? cleanName(el.componentHint) : '')

    let type: StructuredNodeType
    if (tag === 'frameui-text') type = 'Text'
    else if (SVG_SHAPE_TAGS.has(tag)) type = 'Shape'
    else if (SECTION_TAGS.has(tag)) type = 'Section'
    // Stage 9 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §22): `spliceCanvasFallback`
    // (domSnapshot.ts) and `captureResources.ts`'s iframe/frame splice both
    // already rewrite unrenderable content to `<img>` upstream, before this
    // compiler ever runs — this marker (set by both) distinguishes that
    // substitution from a real `<img>`, checked ahead of `TAG_KIND.img`
    // ('Image') below so it wins.
    else if (a['data-frameui-raster-fallback']) type = 'RasterFallback'
    else if (TAG_KIND[tag]) type = TAG_KIND[tag]
    else type = el.children.length ? 'Container' : 'Group'
    if (type === 'Group' && !el.children.length && text) type = 'Text'

    // Deliberate divergence from `normalizeVisual`'s unconditional
    // wrapper-collapse: a paint-less/label-less/text-less wrapper only
    // collapses when it has no layout intent of its own (`mode==='free'`).
    // A paint-less flex/grid wrapper is KEPT, because dropping it would
    // destroy the very layout relationship this schema exists to preserve
    // (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §7).
    const interactive = ['summary','button','a','input','select','textarea'].includes(tag)||['tab','button'].includes(el.aria?.role??'')||a['data-frameui-interactive']==='true'||el.aria?.['aria-expanded']!==undefined
    const isPlainWrapper = !interactive && (type === 'Container' || type === 'Group') && !paint && !label && !text && appearance.zIndex === undefined && !appearance.clip && appearance.opacity === 1
    const borderInset = appearance.border?.width ?? 0
    const children = sourceOf(el,tag,ctx).control?[]:inlineTextGroups(el).flatMap((child) => convert(child, el.rect.x + borderInset, el.rect.y + borderInset, null))
    if (isPlainWrapper && layout.mode === 'free' && !Object.values(layout.padding??{}).some(value=>value!==0)) {
      return children.map((child) => ({
        ...child,
        parentId,
        bounds: {
          ...child.bounds,
          x: child.bounds.x + el.rect.x - parentX,
          y: child.bounds.y + el.rect.y - parentY,
        },
      }))
    }

    const id = crypto.randomUUID()
    const rebasedChildren = children.map((child) => ({ ...child, parentId: id }))
    const name = cleanName(label || (tag === 'hr' ? 'Horizontal rule' : type === 'Text' ? (text ?? '').slice(0, 48) : type) || type) || type

    const node: StructuredNode = {
      id,
      type,
      name,
      parentId,
      children: rebasedChildren,
      bounds: tag === 'hr'
        ? { x: el.rect.x - parentX, y: el.rect.y - parentY + Math.max(0, el.rect.height - (appearance.strokeWidth ?? 1)) / 2, width: el.rect.width, height: appearance.strokeWidth ?? 1 }
        : { x: el.rect.x - parentX, y: el.rect.y - parentY, width: el.rect.width, height: el.rect.height },
      layout,
      appearance,
      typography: type==='Text'||sourceOf(el,tag,ctx).control?typographyOf(s,sourceOf(el,tag,ctx).control?(a.controlValue||a.placeholder||''):text??''):undefined,
      source: sourceOf(el, tag, ctx),
      tokenBindings: tokenBindingsOf(s),
      componentBinding: undefined,
      constraints: constraintsOf(s),
      visibility: true,
      locked: false,
      captureConfidence: undefined,
    }
    if(node.typography)node.typography.gradient=captureTextGradient(el)
    if(node.typography&&a['data-frameui-text-lines']){
      try{const lines=JSON.parse(a['data-frameui-text-lines']);if(Array.isArray(lines)&&lines.every(line=>typeof line.text==='string'&&['x','y','width','height'].every(k=>Number.isFinite(line[k]))))node.typography.captureLines=lines}catch{/* ordinary text fallback */}
    }
    return [node]
  }
  return convert(root, root.rect.x, root.rect.y, null)
}

function parseControlOptions(value?:string):NonNullable<StructuredSource['control']>['options'] {
 try { const options:unknown=JSON.parse(value??'[]');return Array.isArray(options)?options.filter((option):option is {value:string;label:string;disabled?:boolean}=>!!option&&typeof option.value==='string'&&typeof option.label==='string').slice(0,1000):[] } catch { return [] }
}
