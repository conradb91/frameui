import {CSS_SVG_MASK_ICONS_SCRIPT,attachCssSvgMaskIcons} from './cssSvgMaskIcons'
import { raceAbort } from '../capture/raceAbort'
import { CONTENT_METRICS_SCRIPT } from '../capture/contentHeight'
import { SVG_RESOURCE_TAGS, SVG_RESOURCE_ATTRIBUTES } from '@core/capture-compiler/svgDefinitions'
import { normalizeCaptureScale } from './normalizeCaptureScale'
import type { WebContents } from 'electron'
import type { Protocol } from 'devtools-protocol'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import { CAPTURED_STYLE_PROPERTIES } from '@shared/captureStyleProperties'
import { withDebugger } from './withDebugger'
import { reconstructSnapshotTree } from './reconstructSnapshotTree'

/** Mirrors `CAPTURE_SCRIPT`'s own `captureSelector` derivation so canvas
 * elements found here match the ones `reconstructSnapshotTree.ts` tags. */
const CANVAS_SCRIPT = `(() => {
  function captureSelectorOf(el) {
    var path = []; var cursor = el
    while (cursor && cursor.parentElement && cursor !== document.documentElement) {
      var index = Array.prototype.indexOf.call(cursor.parentElement.children, cursor) + 1
      path.unshift(cursor.tagName.toLowerCase() + ':nth-child(' + index + ')')
      cursor = cursor.parentElement
    }
    return 'html>' + path.join('>')
  }
  return Array.from(document.querySelectorAll('canvas')).map(function (canvas) {
    try { return { captureSelector: captureSelectorOf(canvas), dataUrl: canvas.toDataURL('image/png') } }
    catch (_) { return null }
  }).filter(Boolean)
})()`

/**
 * `CAPTURED_STYLE_PROPERTIES` is written in the JS `CSSStyleDeclaration`
 * spelling (`fontSize`, `boxSizing`) because that's what `getComputedStyle()`
 * indexes with in the shared in-page script. CDP's `DOMSnapshot`, though,
 * validates its `computedStyles` request against real CSS property syntax
 * — kebab-case — and rejects the camelCase form outright with "invalid CSS
 * property". Only the outgoing request needs converting; the response is
 * zipped back against the original (camelCase) list positionally, so the
 * `CapturedElement.styles` keys stay exactly as every other consumer
 * expects. Confirmed against a real Electron/Chromium build, not assumed —
 * see `scripts/smoke-capture-registry.cjs`.
 */
export function toCssPropertyName(camelCase: string): string {
  return camelCase.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function spliceCanvasFallback(el: CapturedElement, canvases: Map<string, string>) {
  const selector = el.attributes?.captureSelector
  const dataUrl = selector ? canvases.get(selector) : undefined
  if (dataUrl) {
    el.tag = 'img'
    // Stage 9 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §22): marks this `<img>`
    // as a substitute for content that couldn't be captured structurally,
    // not a real `<img>` — read by `compile.ts` to assign `RasterFallback`
    // instead of `Image`. Invisible to the legacy pipeline (`normalize.ts`
    // only reads a fixed set of known attribute keys, never copies unknown
    // ones verbatim), so this is safe to add unconditionally.
    el.attributes = { alt: 'Canvas (image)', ...el.attributes, src: dataUrl, 'data-frameui-raster-fallback': 'canvas' }
    el.children = []
    return
  }
  for (const child of el.children) spliceCanvasFallback(child, canvases)
}

/**
 * Replaces `executeJavaScript(CAPTURE_SCRIPT)` as the primary capture step:
 * pulls real layout + computed-style data from Chromium itself via CDP's
 * `DOMSnapshot.captureSnapshot`, instead of re-deriving it with a hand-rolled
 * JS walk. Errors propagate — this is a primary data source, not an
 * enhancement, so nothing here catches and swallows failures the way
 * `captureVisualStates.ts` does; the caller's existing per-job error
 * handling in `designIde.handlers.ts` is what's meant to catch these.
 *
 * Takes a plain `WebContents` rather than a `BrowserWindow` (the caller
 * supplies the viewport size explicitly instead of it being derived from
 * `BrowserWindow.getContentSize()`) so this also works for a `<webview>`
 * guest resolved via `electron.webContents.fromId()`, which has no
 * `getContentSize()` — the same generalization `captureVisualStates.ts`
 * already went through, for the same reason. Callers with a `BrowserWindow`
 * just pass `win.webContents` and `win.getContentSize()`.
 */
export async function captureDomSnapshot(
  contents: WebContents,
  viewport: { width: number; height: number },
  jobSignal?: AbortSignal,
): Promise<CapturedElement> {
  const signal=jobSignal?AbortSignal.any([jobSignal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)
  const execute=(script:string)=>raceAbort(contents.executeJavaScript(script),signal)
  signal.throwIfAborted()
  const snapshot = await withDebugger(contents, '1.3', async (send) => {
    await send('DOM.enable')
    await send('CSS.enable')
    await send('DOMSnapshot.enable')
    const request: Protocol.DOMSnapshot.CaptureSnapshotRequest = {
      computedStyles: CAPTURED_STYLE_PROPERTIES.map(toCssPropertyName),
      includeDOMRects: true,
    }
    return send<Protocol.DOMSnapshot.CaptureSnapshotResponse>(
      'DOMSnapshot.captureSnapshot',
      request,
    )
  }, signal)
  // DOMSnapshot bounds can be emitted in device pixels on scaled macOS
  // displays, while computed CSS styles and the design viewport remain in
  // CSS pixels. Calibrate against the same body's live DOM rect rather than
  // guessing from devicePixelRatio (which does not always describe CDP's
  // coordinate space).
  const contentMetrics = await execute(CONTENT_METRICS_SCRIPT) as {width:number;height:number}
  const liveBodyWidth = contentMetrics.width
  const doc = snapshot.documents[0]
  const bodyIndex = doc?.nodes.nodeName?.findIndex((name) => snapshot.strings[name]?.toLowerCase() === 'body') ?? -1
  const bodyLayoutIndex = doc?.layout.nodeIndex.indexOf(bodyIndex) ?? -1
  const snapshotBodyWidth = bodyLayoutIndex >= 0 ? doc?.layout.bounds[bodyLayoutIndex]?.[2] : undefined
  const ratio = snapshotBodyWidth && liveBodyWidth > 0 ? snapshotBodyWidth / liveBodyWidth : 1
  const coordinateScale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  const root = reconstructSnapshotTree(snapshot, CAPTURED_STYLE_PROPERTIES, viewport, coordinateScale)
  attachCssSvgMaskIcons(root,await execute(CSS_SVG_MASK_ICONS_SCRIPT) as Parameters<typeof attachCssSvgMaskIcons>[1])
  const placeholderStyles = await execute(`(() => {
    const result = {};
    for (const input of document.querySelectorAll('input[placeholder]')) {
      if (input.value) continue;
      const parts = []; let cursor = input;
      while (cursor && cursor.parentElement && cursor !== document.documentElement) {
        parts.unshift(cursor.tagName.toLowerCase() + ':nth-child(' + (Array.prototype.indexOf.call(cursor.parentElement.children, cursor) + 1) + ')'); cursor = cursor.parentElement;
      }
      const style = getComputedStyle(input, '::placeholder');
      result['html>' + parts.join('>')] = { color: style.color, opacity: style.opacity };
    }
    return result;
  })()`) as Record<string, { color: string; opacity: string }>
  const applyPlaceholderStyles = (element: CapturedElement): void => {
    const style = placeholderStyles[element.attributes?.captureSelector??''];
    if(style&&element.tag==='input'){element.attributes={...element.attributes,'data-frameui-placeholder-color':style.color,'data-frameui-placeholder-opacity':style.opacity}}
    const hasPlaceholder = element.attributes?.['data-frameui-placeholder'];
    if (style&&hasPlaceholder) for (const child of element.children) if (child.tag === 'frameui-text') Object.assign(child.styles, style);
    element.children.forEach(applyPlaceholderStyles);
  }
  applyPlaceholderStyles(root)
  const controlDetails=await execute(`(() => {
    const result={};
    for(const el of document.querySelectorAll('input,select,textarea')){
      const parts=[];let cursor=el;while(cursor&&cursor.parentElement&&cursor!==document.documentElement){parts.unshift(cursor.tagName.toLowerCase()+':nth-child('+(Array.prototype.indexOf.call(cursor.parentElement.children,cursor)+1)+')');cursor=cursor.parentElement}
      const info={'data-frameui-appearance':getComputedStyle(el).appearance};
      if(el.tagName==='SELECT'){info.controlValue=el.value;info['data-frameui-options']=JSON.stringify(Array.from(el.options).slice(0,1000).map(option=>({value:option.value,label:option.label,disabled:option.disabled})))}
      if(el.tagName==='TEXTAREA')info.controlValue=el.value;
      result['html>'+parts.join('>')]=info;
    }
    return result;
  })()` ) as Record<string,Record<string,string>>
  const attachControls=(el:CapturedElement):void=>{const detail=controlDetails[el.attributes?.captureSelector??''];if(detail)el.attributes={...el.attributes,...detail};el.children.forEach(attachControls)};attachControls(root)

  const canvases = (await execute(CANVAS_SCRIPT)) as {
    captureSelector: string
    dataUrl: string
  }[]
  if (canvases.length)
    spliceCanvasFallback(root, new Map(canvases.map((c) => [c.captureSelector, c.dataUrl])))
  const svgResources = await execute(`(() => {
    const tags = new Set(${JSON.stringify(SVG_RESOURCE_TAGS)}), attributes = new Set(${JSON.stringify(SVG_RESOURCE_ATTRIBUTES)});
    function selector(el) { const parts=[]; while(el&&el.parentElement&&el!==document.documentElement){parts.unshift(el.tagName.toLowerCase()+':nth-child('+(Array.prototype.indexOf.call(el.parentElement.children,el)+1)+')');el=el.parentElement}return 'html>'+parts.join('>') }
    let budget=4000;
    function resource(el,depth=0){if(depth>32||budget--<=0||!tags.has(el.tagName))return null;const a={};for(const attr of el.attributes)if(attributes.has(attr.name))a[attr.name]=attr.value;const style=getComputedStyle(el);for(const key of ['fill','fill-opacity','stroke','stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin','fill-rule','clip-rule','opacity','stop-color','stop-opacity','flood-color','flood-opacity','color-interpolation-filters'])if(style.getPropertyValue(key)&&style.getPropertyValue(key)!==getComputedStyle(el.parentElement||el).getPropertyValue(key))a[key]=style.getPropertyValue(key);return {tag:el.tagName,attributes:a,children:Array.from(el.children).map(c=>resource(c,depth+1)).filter(Boolean)}}
    function referencedIds(root){const ids=new Set();for(const el of [root,...root.querySelectorAll('*')]){for(const attr of ['href','xlink:href']){const v=el.getAttribute(attr);if(v&&v.startsWith('#'))ids.add(v.slice(1))}const style=getComputedStyle(el);for(const key of ['fill','stroke','filter','clip-path','mask-image']){const value=style.getPropertyValue(key);for(const m of value.matchAll(/url\\(\\s*["']?([^"')]+)["']?\\s*\\)/g)){try{const url=new URL(m[1],document.baseURI);if(url.href.split('#')[0]===location.href.split('#')[0]&&url.hash)ids.add(decodeURIComponent(url.hash.slice(1)))}catch{}}}}return ids}
    return Array.from(document.querySelectorAll('svg')).map(el=>{budget=4000;const pending=[...referencedIds(el)],seen=new Set(),definitions=[];while(pending.length&&seen.size<128){const id=pending.shift();if(seen.has(id))continue;seen.add(id);const target=document.getElementById(id);if(!target)continue;const value=resource(target);if(value)definitions.push(value);for(const nested of referencedIds(target))if(!seen.has(nested))pending.push(nested)}return {selector:selector(el),definitions:JSON.stringify(definitions)}});
  })()` ) as {selector:string;definitions:string}[]
  const resources = new Map(svgResources.map(item=>[item.selector,item.definitions]))
  const attachSvgResources=(el:CapturedElement):void=>{if(el.tag==='svg'){const defs=resources.get(el.attributes?.captureSelector??'');if(defs&&defs.length<=2_000_000)el.attributes={...el.attributes,'data-frameui-svg-definitions':defs}}el.children.forEach(attachSvgResources)}
  attachSvgResources(root)
  const gradientPaints = await execute(`(() => {
 const paints={};
 for(const el of document.querySelectorAll('span,strong,b,em,i,h1,h2,h3,h4,p,label,a')){
 const style=getComputedStyle(el);if(!style.backgroundClip.includes('text')||style.backgroundImage==='none')continue;
 const parts=[];let cursor=el;
 while(cursor&&cursor.parentElement&&cursor!==document.documentElement){parts.unshift(cursor.tagName.toLowerCase()+':nth-child('+(Array.prototype.indexOf.call(cursor.parentElement.children,cursor)+1)+')');cursor=cursor.parentElement}
 paints['html>'+parts.join('>')]={clone:style.getPropertyValue('box-decoration-break')==='clone'||style.getPropertyValue('-webkit-box-decoration-break')==='clone',fragments:Array.from(el.getClientRects()).map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))};
 }
 return paints;
})()`) as Record<string,unknown>
  const attachGradientPaint=(el:CapturedElement):void=>{const paint=gradientPaints[el.attributes?.captureSelector??''];if(paint)el.attributes={...el.attributes,'data-frameui-gradient-paint':JSON.stringify(paint)};el.children.forEach(attachGradientPaint)}
  attachGradientPaint(root)
  if(root.tag==='frameui-root'&&Number.isFinite(contentMetrics.height)){
    root.rect.height=contentMetrics.height
    const containsModal=(el:CapturedElement):boolean=>el.attributes?.['data-drawer']!==undefined||el.attributes?.['data-side-panel']!==undefined||/\b(drawer|side-panel)\b/.test(el.classes??'')||el.aria?.['aria-modal']==='true'||el.aria?.role==='dialog'||el.attributes?.role==='dialog'||el.tag==='dialog'||el.children.some(containsModal)
    const expandBackdrops=(el:CapturedElement):void=>{if(el.styles.position==='fixed'&&el.rect.x<=1&&el.rect.y<=1&&el.rect.width>=viewport.width-2&&el.rect.height>=viewport.height-2&&(containsModal(el)||/backdrop|scrim/.test(el.classes??'')))el.rect.height=Math.max(1,contentMetrics.height-el.rect.y);el.children.forEach(expandBackdrops)};expandBackdrops(root)
  }
  return normalizeCaptureScale(root)
}
