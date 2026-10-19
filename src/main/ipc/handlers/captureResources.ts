import {captureImageMime} from '@core/capture-compiler/imageMime'
import type { WebContents } from 'electron'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import type { VisualPage } from '@shared/types/visualDesign'

type Rect = { x: number; y: number; width: number; height: number }

export function clipRectToViewport(
  rect: Rect,
  viewport: { width: number; height: number },
): Rect {
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const right = Math.min(viewport.width, rect.x + rect.width)
  const bottom = Math.min(viewport.height, rect.y + rect.height)
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

type FrameObservation = {
  captureRect: Rect
  elementRect: Rect
  restore?: { x: number; y: number }
}

async function captureFrameRect(
  contents: WebContents,
  el: CapturedElement,
  viewport: { width: number; height: number },
): Promise<FrameObservation | null> {
  const selector = el.attributes?.captureSelector
  const fallback = {
    x: Math.round(el.rect.x),
    y: Math.round(el.rect.y),
    width: Math.max(0, Math.round(el.rect.width)),
    height: Math.max(0, Math.round(el.rect.height)),
  }
  if (!selector)
    return {
      captureRect: clipRectToViewport(fallback, viewport),
      elementRect: fallback,
    } satisfies FrameObservation
  const observed = await contents.executeJavaScript(`(async () => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element || !(element instanceof Element)) return null
    const toRect = () => {
      const rect = element.getBoundingClientRect()
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    const before = toRect()
    const intersects = before.width > 0 && before.height > 0 && before.x + before.width > 0 && before.y + before.height > 0 && before.x < innerWidth && before.y < innerHeight
    if (intersects) return { rect: before }
    const restore = { x: window.scrollX, y: window.scrollY }
    try {
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    } catch (_) {
      try {
        element.scrollIntoView()
      } catch (_) {}
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const after = toRect()
    return after.width > 0 && after.height > 0 ? { rect: after, restore } : null
  })()`)
  if (!observed) return null
  return {
    captureRect: clipRectToViewport(observed.rect, viewport),
    elementRect: observed.rect,
    restore: observed.restore,
  } satisfies FrameObservation
}

/**
 * Splices ONE `<iframe>`/`<frame>` element in place into a raster `<img>`
 * fallback via `contents.capturePage(rect)` — the same technique
 * `spliceCanvasFallback` (domSnapshot.ts) uses for `<canvas>`. Does not
 * recurse; callers walk the tree themselves (`embed()` below and
 * `embedIframeFallbacks`, Stage 9 sub-slice 2,
 * docs/CAPTURE_ENGINE_REBUILD_SPEC.md §22, both already recurse for their
 * own reasons). Chromium's compositor can retain a cross-origin frame's
 * visible appearance without reading its DOM or disabling the browser's
 * same-origin protections.
 */
async function spliceIframeFallback(
  contents: WebContents,
  el: CapturedElement,
  viewport: { width: number; height: number },
  signal: AbortSignal,
  warnings: string[] = [],
): Promise<void> {
  const observation = await captureFrameRect(contents, el, viewport).catch(() => null)
  const frameRect = observation?.captureRect
  if (!frameRect || frameRect.width <= 0 || frameRect.height <= 0) {
    warnings.push('An embedded view could not be captured because it was out of view. Re-capture that screen while the embedded view is visible.')
  }
  let frameImage: string | undefined
  try {
    if (frameRect && frameRect.width > 0 && frameRect.height > 0) {
      const image = await contents.capturePage(frameRect)
      if (!image.isEmpty()) frameImage = image.toDataURL()
    }
  } catch {
    signal.throwIfAborted()
    warnings.push('An embedded view snapshot could not be created. The rest of the screen was captured.')
  } finally {
    if (observation?.restore)
      await contents
        .executeJavaScript(
          `window.scrollTo(${Math.round(observation.restore.x)}, ${Math.round(
            observation.restore.y,
          )})`,
        )
        .catch(() => {})
  }
  const frameAttributes = {
    ...(el.attributes ?? {}),
    alt: 'Embedded view (image)',
    // Stage 9 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §22): same marker
    // `spliceCanvasFallback` (domSnapshot.ts) sets for canvas — read by
    // `compile.ts` to assign `RasterFallback` instead of `Image`.
    'data-frameui-raster-fallback': 'iframe',
  } as Record<string, string>
  if (frameImage) frameAttributes.src = frameImage
  else delete frameAttributes.src
  el.tag = 'img'
  el.attributes = frameAttributes
  el.children = []
  if (frameRect && observation) {
    el.rect = {
      x: el.rect.x + frameRect.x - observation.elementRect.x,
      y: el.rect.y + frameRect.y - observation.elementRect.y,
      width: frameRect.width,
      height: frameRect.height,
    }
  }
}

/**
 * Stage 9 sub-slice 2 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §22) — walks a
 * captured tree and splices every `<iframe>`/`<frame>` into a raster `<img>`
 * fallback via `spliceIframeFallback`, independent of `captureResources()`'s
 * own image/font embedding pass below. Exists because the interactive
 * capture path's structured-v2 source tree (`domSnapshotRoot` in
 * designIde.handlers.ts) never goes through `captureResources()`'s `embed()`
 * at all — only the separate legacy `CAPTURE_SCRIPT` tree does — so without
 * this, an interactively-captured page's iframes reached `compile.ts`
 * unspliced (stayed a bare, unrecognized `<iframe>` tag) even though the
 * batch capture path has always spliced them for free.
 */
export async function embedIframeFallbacks(contents: WebContents, root: CapturedElement, signal: AbortSignal, warnings: string[] = []): Promise<void> {
  const viewport = await contents.executeJavaScript('({width:innerWidth,height:innerHeight})') as { width: number; height: number }
  async function walk(el: CapturedElement): Promise<void> {
    signal.throwIfAborted()
    if(el.styles.transform?.startsWith('matrix3d('))warnings.push('A 3D transform may need visual review; its layers remain editable.')
    if(['clipPath','filter','maskImage'].some(key=>/url\(["']?#/.test(el.styles[key]||'')))warnings.push('A referenced SVG clipping or filter definition may not be portable; review this effect against the original app.')
    if (el.tag === 'iframe' || el.tag === 'frame') {
      await spliceIframeFallback(contents, el, viewport, signal, warnings)
      return
    }
    for (const child of el.children) await walk(child)
  }
  await walk(root)
}

/** One authenticated resource path for batch and interactive captures. */
export async function captureResources(contents: WebContents, root: CapturedElement, url: string, signal: AbortSignal, cache = new Map<string, Promise<string>>(), warnings: string[] = []) {
  const read = (address: string, image: boolean) => {
    const asset = new URL(address, url)
    if (!['http:', 'https:', 'data:', 'blob:'].includes(asset.protocol)) throw new Error('Unsupported resource protocol')
    const key = `${image}:${asset.href}`
    if (!cache.has(key)) cache.set(key, (async () => {
      if (asset.protocol === 'data:') {
        if (asset.href.length > (image ? 28000000 : 7000000)) throw new Error('Resource too large')
        return asset.href
      }
      if (asset.protocol === 'blob:') return await contents.executeJavaScript(`(async () => {
        const response=await fetch(${JSON.stringify(asset.href)}, {signal:AbortSignal.timeout(8000)});
        const blob=await response.blob();
        if(blob.size>${image ? 20000000 : 5000000} || (${image} && !blob.type.startsWith('image/')))throw new Error('Unsupported blob');
        return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Blob unavailable'));reader.readAsDataURL(blob)})
      })()`)
      const response = await contents.session.fetch(asset.href, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) })
      const mime = response.headers.get('content-type')?.split(';')[0] || ''
      if (!response.ok) throw new Error('Resource unavailable')
      const data = Buffer.from(await response.arrayBuffer())
      if (data.length > (image ? 20000000 : 5000000)) throw new Error('Resource too large')
      return `data:${image?captureImageMime(data,mime):mime||'font/woff2'};base64,${data.toString('base64')}`
    })())
    return cache.get(key)!
  }
  const viewport = await contents.executeJavaScript('({width:innerWidth,height:innerHeight})') as {width:number;height:number}
  async function embed(el: CapturedElement, svgResources=false): Promise<void> {
    svgResources=svgResources||!!el.attributes?.['data-frameui-svg-definitions']&&el.attributes['data-frameui-svg-definitions']!=='[]'
    signal.throwIfAborted()
    if(el.styles.transform?.startsWith('matrix3d('))warnings.push('A 3D transform may need visual review; its layers remain editable.')
    if(['clipPath','filter','maskImage'].some(key=>/url\(["']?#/.test(el.styles[key]||'')))warnings.push('A referenced SVG clipping or filter definition may not be portable; review this effect against the original app.')
    if (el.tag === 'iframe' || el.tag === 'frame') {
      await spliceIframeFallback(contents, el, viewport, signal, warnings)
      return
    }
    for (const key of ['src', 'backgroundSrc', 'poster']) {
      const address = el.attributes?.[key]
      if (!address) continue
      if (key === 'src' && el.tag !== 'img') continue
      if (key === 'poster' && el.tag !== 'video') continue
      if (address.startsWith('data:image/') && address.length < 28000000) continue
      try { el.attributes![key] = await read(address, true) }
      catch (error) { if(process.env.FRAMEUI_AUDIT_DEBUG)console.warn('Image embed diagnostic',new URL(address,url).pathname,(error as Error).message);signal.throwIfAborted(); warnings.push('An image could not be embedded. Check the screenshot preview for its appearance.'); delete el.attributes![key] }
    }
    for(const key of ['backgroundImage','maskImage']){
      const css=el.styles[key];if(!css)continue
      let result=css
      for(const match of css.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/g)){
        const address=match[1]||match[2]||match[3].trim()
        if(svgResources){try{const reference=new URL(address,url);if(reference.hash&&reference.href.split('#')[0]===new URL(url).href.split('#')[0])continue}catch{/* handled by the normal resource warning */}}
        try{result=result.replace(match[0],`url("${await read(address,true)}")`)}catch{signal.throwIfAborted();warnings.push(`A ${key==='maskImage'?'mask':'background'} resource could not be embedded; its appearance may differ.`)}
      }
      el.styles[key]=result
    }
    for (const child of el.children) await embed(child,svgResources)
  }
  await embed(root)
  // A stylesheet loaded cross-origin without `crossorigin` set (the
  // everyday case for a raw Google Fonts <link>) throws SecurityError on
  // `cssRules` access — that used to mean silently zero fonts embedded
  // despite `fontFamily` capturing correctly. Sheets that throw are
  // collected by href instead, and their raw CSS text is fetched
  // out-of-band below (`contents.session.fetch` isn't subject to the
  // page's CORS policy — it's the same mechanism already used for images).
  const { fonts: directRules, externalSheets } = await contents.executeJavaScript(`(() => {
    const fonts=[]; const visited=new Set(); const externalSheets=new Set();
    const walk=(rules,base)=>{for(const rule of rules){if(rule.type===5){const match=rule.style.src.match(/url\\(["']?([^"')]+)["']?\\)/);if(match)fonts.push({family:rule.style.fontFamily,weight:rule.style.fontWeight||'400',style:rule.style.fontStyle||'normal',unicodeRange:rule.style.unicodeRange||undefined,stretch:rule.style.fontStretch||undefined,url:new URL(match[1],base).href})}try{if(rule.styleSheet){const sheet=rule.styleSheet;try{walk(sheet.cssRules,sheet.href||base)}catch{if(sheet.href)externalSheets.add(sheet.href)}}else if(rule.cssRules)walk(rule.cssRules,base)}catch{}}};
    const sheets=scope=>{for(const sheet of [...(scope.styleSheets||[]),...(scope.adoptedStyleSheets||[]),...Array.from(scope.querySelectorAll('style,link[rel=stylesheet]')).map(el=>el.sheet).filter(Boolean)]){if(visited.has(sheet))continue;visited.add(sheet);try{walk(sheet.cssRules,sheet.href||document.baseURI)}catch{if(sheet.href)externalSheets.add(sheet.href)}};for(const el of scope.querySelectorAll('*'))if(el.shadowRoot)sheets(el.shadowRoot)};
    sheets(document);return {fonts:fonts.slice(0,40),externalSheets:[...externalSheets].slice(0,20)}
  })()`) as {fonts:{family:string;weight:string;style:string;unicodeRange?:string;stretch?:string;url:string}[];externalSheets:string[]}
  const rules = [...directRules]
  for (const sheetUrl of externalSheets) {
    signal.throwIfAborted()
    try {
      const response = await contents.session.fetch(sheetUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) })
      if (!response.ok) continue
      const text = await response.text()
      const fontFaceRe = /@font-face\s*{([^}]*)}/g
      let match: RegExpExecArray | null
      while ((match = fontFaceRe.exec(text))) {
        const block = match[1]
        const family = /font-family\s*:\s*['"]?([^;'"]+)['"]?\s*;/.exec(block)?.[1]?.trim()
        const weight = /font-weight\s*:\s*([^;]+);/.exec(block)?.[1]?.trim() || '400'
        const style = /font-style\s*:\s*([^;]+);/.exec(block)?.[1]?.trim() || 'normal'
        const unicodeRange = /unicode-range\s*:\s*([^;]+);/.exec(block)?.[1]?.trim()
        const stretch = /font-stretch\s*:\s*([^;]+);/.exec(block)?.[1]?.trim()
        const urlMatch = /url\(["']?([^"')]+)["']?\)/.exec(block)
        if (!family || !urlMatch) continue
        try { rules.push({ family, weight, style, unicodeRange, stretch, url: new URL(urlMatch[1], sheetUrl).href }) } catch { /* malformed url */ }
      }
    } catch { /* best-effort — this stylesheet's fonts just won't embed */ }
  }
  const fonts: NonNullable<VisualPage['fonts']> = []
  for (const rule of rules) {
    signal.throwIfAborted()
    try { fonts.push({family:rule.family,weight:rule.weight,style:rule.style,unicodeRange:rule.unicodeRange,stretch:rule.stretch,data:await read(rule.url,false)}) }
    catch { signal.throwIfAborted(); warnings.push('A font could not be embedded; a fallback font may be used.') }
  }
  return fonts
}
