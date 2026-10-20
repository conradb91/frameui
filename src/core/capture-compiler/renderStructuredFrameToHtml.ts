import {inheritedTextPaint,childTextPaint,capturedTextParts,textRunStyle,gradientTextStyle} from './textPaint'
import { renderSvgDefinitions, scopeSvgValue } from './svgDefinitions'
import { textSegments } from '@core/visual/textRuns'
import type { StructuredFrame, StructuredNode, StructuredTypography } from '@shared/types/structuredDesign'
import { controlStyleFor, appearanceStyleFor, capturedPositionStyleFor, containerStyleFor, styleToInlineCss as serializeStyle, typographyStyleFor } from './structuredNodeStyle'
import type { CSSLikeStyle } from './structuredNodeStyle'

// Same escaping this codebase's other pure string-serializer already uses
// (src/core/export/svgSerializer.ts's `esc`) — safe for both element
// content and double-quoted attribute values.
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// CSS values such as font-family:"Inter Variable" and url("...") contain
// quotes. They must be escaped when embedded in a double-quoted HTML style
// attribute; otherwise the browser truncates the entire style at the quote.
function styleToInlineCss(style: CSSLikeStyle): string {
  return esc(serializeStyle(style))
}

const DEFAULT_TYPOGRAPHY: StructuredTypography = {
  text: '', fontFamily: 'sans-serif', fontSize: 16, fontWeight: '400', lineHeight: 19, letterSpacing: 0, textAlign: 'left',
}

/** Stage 8 (spec §13) — same `@font-face` template as `VisualSvg.tsx`'s
 * `FontDefinitions` React component (deliberately not escaped, matching
 * that exact precedent) — reimplemented as a plain string here since this
 * module can't import a React component (no React/Electron dependency, by
 * design — see this file's own top comment). This deliberately does NOT
 * use `esc()` (this file's HTML-content/attribute escaper) — `<style>`
 * block content isn't HTML-entity-decoded, so escaping it here would be
 * actively wrong, not just unnecessary; `frame.fonts` values come from
 * `getComputedStyle()`/repository font metadata, not arbitrary text. */
function fontFaceCss(fonts: StructuredFrame['fonts']): string {
  if (!fonts?.length) return ''
  return fonts
    .map((font) => `@font-face{font-family:${font.family};font-weight:${font.weight};font-style:${font.style};${font.unicodeRange ? `unicode-range:${font.unicodeRange};` : ''}${font.stretch ? `font-stretch:${font.stretch};` : ''}src:url("${font.data}")}`)
    .join('\n')
}

/**
 * Stage 4 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md
 * §20) — a pure, main-process-callable HTML string builder, mirroring
 * `src/core/export/svgSerializer.ts`'s shape (no React/Electron import).
 * Produces the same visual result `StructuredFrameView.tsx` renders live
 * (same tag choices per `node.type`, same style computation via the
 * shared `structuredNodeStyle.ts` functions) as a standalone HTML document
 * string, so `renderAndCompareStructuredCapture.ts` can load it into a
 * hidden `BrowserWindow` and screenshot it for a Pixelmatch diff against
 * the original capture.
 */
export function renderStructuredFrameToHtml(frame: StructuredFrame): string {
  const rootStyle = styleToInlineCss({ position: 'relative', width: frame.width, height: frame.height, overflow: 'hidden', background: '#fff' })
  const body = frame.children.map(node=>renderNode(node)).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box}[data-captured-control]::placeholder{color:var(--frameui-placeholder-color,#757575);opacity:var(--frameui-placeholder-opacity,1)}${fontFaceCss(frame.fonts)}</style></head><body style="margin:0"><div style="${rootStyle}">${body}</div></body></html>`
}

function renderText(t:StructuredTypography):string{
 if(t.captureLines?.length&&t.textOverflow!=='ellipsis')return capturedTextParts(t).map(line=>'<span style="'+styleToInlineCss({position:'absolute',left:line.x,top:line.y,width:line.width,height:line.height,whiteSpace:'pre',textAlign:'left',lineHeight:line.height+'px',...gradientTextStyle(t.gradient,line)})+'">'+line.segments.map(segment=>'<span style="'+styleToInlineCss(textRunStyle(segment,line))+'">'+esc(segment.text)+'</span>').join('')+'</span>').join('')
 return textSegments(t.text,t.textRuns).map(segment=>'<span style="'+styleToInlineCss(textRunStyle(segment))+'">'+esc(segment.text)+'</span>').join('')
}
function renderNode(node: StructuredNode,inheritedGradient?:import('@shared/types/richText').TextGradient): string {
  const paint=inheritedTextPaint(node,inheritedGradient)
  const typography=node.typography?{...node.typography,gradient:node.typography.gradient===null?undefined:node.typography.gradient??paint}:undefined
  if (!node.visibility) return ''
  const positionStyle = capturedPositionStyleFor(node)
  const appearanceStyle = appearanceStyleFor(node.appearance)
  if(node.type==='SVG')for(const [key,value] of Object.entries(appearanceStyle))if(typeof value==='string')appearanceStyle[key]=scopeSvgValue(value,node.id)

  if ((node.type === 'Text'||node.typography&&!node.children.length)&&!node.source.control) {
    const style = { ...positionStyle, ...appearanceStyle, ...typographyStyleFor(typography ?? DEFAULT_TYPOGRAPHY), display: 'block' }
    return '<span data-frameui-text="'+esc(node.id)+'" data-frameui-parent="'+esc(node.parentId??'')+'" style="'+styleToInlineCss(style)+'">'+(typography?renderText(typography):'')+'</span>'
  }

  // Stage 9 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §22): same already-spliced
  // `source.imageSrc` an `Image` node has, just a different reason.
  if (node.source.control) {
    const c = node.source.control
    const attrs = Object.entries(c).filter(([key,value])=>!['options','appearance','placeholderColor','placeholderOpacity','type','value'].includes(key)&&value!==undefined&&value!==false).map(([key,value])=>value===true?key:`${key}="${esc(String(value))}"`).join(' ')
    const style=styleToInlineCss({...controlStyleFor(node),pointerEvents:'none'})
    const body=c.type==='select'?`<select data-captured-control="true" ${attrs} tabindex="-1" style="${style}">${(c.options??[]).map(option=>`<option value="${esc(option.value)}"${option.value===c.value?' selected':''}${option.disabled?' disabled':''}>${esc(option.label)}</option>`).join('')}</select>`:c.type==='textarea'?`<textarea data-captured-control="true" ${attrs} readonly tabindex="-1" style="${style}">${esc(c.value??'')}</textarea>`:`<input data-captured-control="true" type="${esc(c.type)}" ${c.value===undefined?'':`value="${esc(c.value)}" `}${attrs} readonly tabindex="-1" style="${style}">`
    return `<div style="${styleToInlineCss(positionStyle)}">${body}</div>`
  }

  if (node.type === 'Image' || node.type === 'RasterFallback') {
    if (node.source.imageSrc)
      return `<img src="${esc(node.source.imageSrc)}" alt="" style="${styleToInlineCss({ ...positionStyle, ...appearanceStyle })}">`
    return `<div style="${styleToInlineCss({ ...positionStyle, ...appearanceStyle, background: appearanceStyle.backgroundColor ?? '#e5e5e5' })}"></div>`
  }

  if (node.type === 'Divider') {
    const thickness = node.appearance.strokeWidth ?? node.appearance.border?.width ?? Math.max(1, node.bounds.height)
    const color = node.appearance.stroke ?? node.appearance.border?.color ?? 'currentColor'
    const lineStyle = styleToInlineCss({ position: 'absolute', left: 0, top: '50%', width: '100%', height: thickness, transform: 'translateY(-50%)', backgroundColor: color })
    return `<div style="${styleToInlineCss({ ...positionStyle, ...appearanceStyle })}"><div aria-hidden="true" style="${lineStyle}"></div></div>`
  }

  if (node.type === 'SVG') {
    const shapes = node.children.filter((child) => child.type === 'Shape'||child.source.tag==='frameui-richtext').map(child=>renderShape(child,node.id)).join('')
    return `<svg fill="${esc(node.appearance.fill??'black')}" stroke="${esc(node.appearance.stroke??'none')}" stroke-width="${node.appearance.strokeWidth??1}" stroke-linecap="${esc(node.source.svgGeometry?.['stroke-linecap']??'butt')}" stroke-linejoin="${esc(node.source.svgGeometry?.['stroke-linejoin']??'miter')}" style="${styleToInlineCss({ ...positionStyle, ...appearanceStyle, color:node.source.svgGeometry?.color })}" viewBox="${esc(node.source.svgGeometry?.viewBox ?? '')}" width="${node.bounds.width}" height="${node.bounds.height}"><defs>${renderSvgDefinitions(node.source.svgGeometry?.definitions,node.id)}</defs>${shapes}</svg>`
  }

  const containerStyle = containerStyleFor(node)
  const children = node.children.map(child=>renderNode(child,childTextPaint(paint,child))).join('')
  return `<div style="${styleToInlineCss({ ...containerStyle, ...positionStyle, ...appearanceStyle })}">${children}</div>`
}

/** Only ever reached as a direct child of an `SVG`-type node's own branch
 * above, mirroring `StructuredFrameView.tsx`'s `StructuredShapeView`. */
function renderShape(node: StructuredNode,scope:string): string {
  const geo = node.source.svgGeometry ?? {}
  const extra = ['filter','mask','clip-path','transform', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'fill-rule'].map(key => geo[key] ? ` ${key}="${esc(scopeSvgValue(geo[key],scope)!)}"` : '').join('')
  const paint = (node.appearance.opacity===1?'':` opacity="${node.appearance.opacity}"`)+ extra + `${node.appearance.fill ? ` fill="${esc(scopeSvgValue(node.appearance.fill,scope)!)}"` : ''}${node.appearance.stroke ? ` stroke="${esc(scopeSvgValue(node.appearance.stroke,scope)!)}"` : ''}${node.appearance.strokeWidth ? ` stroke-width="${node.appearance.strokeWidth}"` : ''}`
  switch (node.source.tag) {
    case 'use': { const href=geo.href??geo['xlink:href'];return href?.startsWith('#')?`<use href="${esc(scopeSvgValue('url('+href+')',scope)!.slice(4,-1))}" x="${esc(geo.x??'0')}" y="${esc(geo.y??'0')}" width="${esc(geo.width??'100%')}" height="${esc(geo.height??'100%')}"${paint}/>`:'' }
    case 'frameui-richtext':
    case 'g':
      return `<g${paint}>${node.children.map(child=>renderShape(child,scope)).join('')}</g>`
    case 'rect':
      return `<rect x="${esc(geo.x ?? '0')}" y="${esc(geo.y ?? '0')}" width="${esc(geo.width ?? '0')}" height="${esc(geo.height ?? '0')}" rx="${esc(geo.rx ?? '0')}" ry="${esc(geo.ry ?? geo.rx ?? '0')}"${paint}/>`
    case 'circle':
      return `<circle cx="${esc(geo.cx ?? '0')}" cy="${esc(geo.cy ?? '0')}" r="${esc(geo.r ?? '0')}"${paint}/>`
    case 'ellipse':
      return `<ellipse cx="${esc(geo.cx ?? '0')}" cy="${esc(geo.cy ?? '0')}" rx="${esc(geo.rx ?? '0')}" ry="${esc(geo.ry ?? '0')}"${paint}/>`
    case 'line':
      return `<line x1="${esc(geo.x1 ?? '0')}" y1="${esc(geo.y1 ?? '0')}" x2="${esc(geo.x2 ?? '0')}" y2="${esc(geo.y2 ?? '0')}"${paint}/>`
    case 'polygon':
      return geo.points ? `<polygon points="${esc(geo.points)}"${paint}/>` : ''
    case 'polyline':
      return geo.points ? `<polyline points="${esc(geo.points)}"${paint}/>` : ''
    default:
      return geo.d ? `<path d="${esc(geo.d)}"${paint}/>` : ''
  }
}
