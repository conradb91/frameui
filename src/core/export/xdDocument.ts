import {embeddedFontResolver} from './embeddedFonts'
import {iconFontResolver,isIconFontText,type IconFontCache} from './xdIconFonts'
import { upgradeFlowGuides } from '../prototype/flowIntroductions'
import {xdPositionedText} from './xdText'
/** Native AGC/DCX writer. No Sketch serialization or conversion is involved.
 * Structure is based on AdobeXD/xd-to-flutter-plugin/test_suite/tests_suite.xd.
 * Archive checks do not certify Adobe XD application compatibility.
 */
import { createHash, randomUUID } from 'node:crypto'
import { parse, converter } from 'culori'
import svgpath from 'svgpath'
import { imageSize } from 'image-size'
import type { ExportFontFace } from './sketchFonts'
import { resolveXdCssFont, xdFontKey, xdFontStyle, type XdRenderedFontFace } from './xdFonts'
import { buildFrameUiPackage } from './frameuiPackage'
import { geometryPath } from './sketchGeometry'
import { xdClipGeometry } from './xdClipping'
import { xdArtboardProjection, xdCanvasPlacement } from './xdArtboards'
import { xdImageColorFilter, xdObjectImageBounds, type XdRenderedImageEffect } from './xdImages'
import { splitXdCssLayers, xdDiagnostic, xdImageSource } from './xdBackgrounds'
import { svgDefinitionMap, expandSvgResource } from './sketchSvgResources'
import type { SvgDefinition } from '../capture-compiler/svgDefinitions'
import type {
  FrameUiExportNode,
  FrameUiExportPage,
  FrameUiExportAsset,
  FrameUiPaint,
} from '@shared/types/frameuiExport'
import type { XdExportRequest, XdExportReport } from '@shared/types/xdExport'
import { crc32, type StoredZipEntry } from '../../main/export/storedZip'

const rgb = converter('rgb')
const MIME = 'application/vnd.adobe.sparkler.project+dcxucf'
type Agc = Record<string, unknown>
function color(value: string) {
  const c = rgb(parse(value))
  if (!c) throw new Error(`Unsupported XD colour: ${xdDiagnostic(value)}`)
  const alpha = c.alpha ?? 1
  return {
    mode: 'RGB',
    value: { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) },
    ...(alpha !== 1 ? { alpha } : {}),
  }
}
const split = splitXdCssLayers
const idFor = (value: string) => {
  const h = createHash('sha256').update(value).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const jsonEntry = (path: string, value: unknown): StoredZipEntry => ({
  path,
  data: Buffer.from(JSON.stringify(value)),
})
const component = (path: string, type: string) => ({
  rel: 'primary',
  type,
  state: 'unmodified',
  id: randomUUID(),
  name: '',
  path,
})
const folder = (path: string, children: Agc[] = [], components: Agc[] = []): Agc => ({
  id: randomUUID(),
  name: path,
  path,
  children,
  components,
})

export function buildXdDocument(
  request: XdExportRequest,
  progress: (stage: string) => void = () => {},
  fonts: ExportFontFace[] = [],
  renderedFonts: XdRenderedFontFace[] = [],
  renderedImages: XdRenderedImageEffect[] = [],
  renderedLines: Record<string,NonNullable<NonNullable<FrameUiExportNode['text']>['captureLines']>> = {},
) {
  const measured = new Map(
    renderedFonts.map((face) => [xdFontKey(face.stack, face.weight, face.style), face]),
  )
  const embeddedFont=embeddedFontResolver(request.document.pages.flatMap(p=>p.structured?.fonts??p.fonts??[]))
  const resolvedCache = new Map<string, ExportFontFace | undefined>()
  const resolveFont = (
    stack: string,
    weight: string,
    style: string,
  ): ExportFontFace | undefined => {
    const embedded=embeddedFont(stack,weight,style)
    if(embedded)return embedded
    const actual = measured.get(xdFontKey(stack, weight, style))
    if (actual)
      return {
        family: actual.family,
        postscript: actual.postscript,
        style:
          actual.fontStyle ??
          xdFontStyle(weight,style),
      }
    const key = xdFontKey(stack, weight, style)
    if (resolvedCache.has(key)) return resolvedCache.get(key)
    const fallback = resolveXdCssFont(fonts, stack, weight, style)
    resolvedCache.set(key, fallback)
    return fallback
  }
  const sourcePages = request.document.prototype ? upgradeFlowGuides(request.document.pages, request.document.prototype) : request.document.pages
  const selected = sourcePages.filter(
    (p) =>
      request.scope === 'all' ||
      (request.scope === 'current' ? p.id === request.pageId : request.pageIds?.includes(p.id)),
  )
  const iconFontCache:IconFontCache=new Map()
  const iconResolvers = new Map(selected.map(p=>[p.id,iconFontResolver(p.structured?.fonts??p.fonts??[],iconFontCache)]))
  if (!selected.length) throw new Error('Select at least one artboard to export.')
  const built = buildFrameUiPackage({
    documents: [{ ...request.document, pages: selected }],
    activeDocumentId: request.document.id,
    activePageId: selected[0].id,
    selectionIds: [],
    structuredSelectionIds: [],
    target: 'adobe-xd',
    frameuiVersion: '0.1.0',
    options: {
      scope: 'design',
      includeComponents: true,
      includeTokens: true,
      includePrototype: request.includePrototype,
      includeHiddenLayers: true,
      includeAnnotations: false,
      rasterizeUnsupported: 'never',
      outlineMissingFonts: false,
    },
  })
  const errors = built.warnings.filter((w) => w.severity === 'error')
  if (errors.length) throw new Error(errors.map((w) => w.message).join('\n'))
  const read = <T>(path: string): T => JSON.parse(built.files.find((f) => f.path === path)!.content)
  const pages = read<{ pages: FrameUiExportPage[] }>('document.json').pages
  const report: XdExportReport = {
    format: 'xd',
    structuralValidation: 'passed',
    applicationValidation: 'unverified',
    artboards: pages.length,
    layers: 0,
    editableText: 0,
    editableVectors: 0,
    images: 0,
    components: 0,
    linkedInstances: 0,
    clippingMasks: 0,
    nativeEffects: 0,
    warnings: [
      ...new Set(
        built.warnings
          .filter(
            (w) => !(w.code === 'unsupported-effect' && w.message.includes('background effect')),
          )
          .map((w) => xdDiagnostic(w.message)),
      ),
      'Adobe XD open, edit, save and reopen validation has not been performed. Fonts must be installed on the receiving computer.',
    ],
  }
  const warn = (input: string) => {
    const message = xdDiagnostic(input)
    if (!report.warnings.includes(message)) report.warnings.push(message)
  }
  for(const page of selected)for(const note of page.captureWarnings??[])warn(`Capture note: ${note}`)
  if(request.includePrototype&&selected.some(p=>p.artifactSource))warn('Imported HTML interactions represent captured states and observed click connections. JavaScript execution, data filtering, file generation and other HTML runtime behaviour are not embedded in Adobe XD.')
  const safeColor = (value: string) => {
    try {
      return color(value)
    } catch {
      warn(`Unsupported colour was omitted: ${value}`)
      return color('transparent')
    }
  }
  const imageEffects = new Map<string, Map<string, string>>()
  for (const effect of renderedImages) {
    try {
      if (!xdImageColorFilter.test(effect.filter)) continue
      const parsed = /^data:(image\/(?:png|jpeg|gif));base64,([\s\S]+)$/i.exec(effect.data)
      if (!parsed) throw new Error('Unsupported effect image format')
      const size = imageSize(Buffer.from(parsed[2], 'base64'))
      if (!size.width || !size.height) throw new Error('Invalid effect image size')
      const bySource = imageEffects.get(effect.filter) ?? new Map<string, string>()
      bySource.set(effect.source, effect.data)
      imageEffects.set(effect.filter, bySource)
    } catch {
      warn('An image-only colour effect could not be decoded; its original image was retained.')
    }
  }
  function renderedImage(n: FrameUiExportNode): string | undefined {
    if (n.children.length || n.text || n.control || !n.captureAppearance?.filter) return
    const layers = split(n.captureAppearance.backgroundImage ?? '')
    const source = layers.length === 1 ? xdImageSource(layers[0]) : undefined
    return source ? imageEffects.get(n.captureAppearance.filter)?.get(source) : undefined
  }
  const entries: StoredZipEntry[] = [{ path: 'mimetype', data: Buffer.from(MIME) }]
  const assets = read<{ assets: FrameUiExportAsset[] }>('assets.json').assets
  const imageRefs = new Map<string, { uid: string; width: number; height: number }>()
  const resourceComponents: Agc[] = []
  for (const asset of assets) {
    const file = built.files.find((f) => f.path === asset.path)
    if (!file) throw new Error(`Missing XD image resource: ${asset.name}`)
    if (asset.kind !== 'IMAGE') continue
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(asset.mimeType)) {
      warn(`Image format ${asset.mimeType} requires review: ${asset.name}`)
      continue
    }
    const data = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')
    const uid = createHash('md5').update(data).digest('hex')
    if (!entries.some((e) => e.path === `resources/${uid}`)) {
      entries.push({ path: `resources/${uid}`, data })
      resourceComponents.push(component(uid, asset.mimeType))
    }
    const size = imageSize(data)
    imageRefs.set(asset.id, { uid, width: size.width, height: size.height })
  }
  function backgroundImage(
    value: string,
    n: FrameUiExportNode,
    sizeValue = n.captureAppearance?.backgroundSize ?? 'auto',
    positionValue = n.captureAppearance?.backgroundPosition ?? '0% 0%',
  ): Agc | undefined {
    const originalSource = xdImageSource(value)
    if (!originalSource) return
    const src = renderedImage(n) ?? originalSource
    const match = /^data:(image\/(?:png|jpeg|gif));base64,([\s\S]+)$/i.exec(src)
    if (!match) {
      warn(`Background image format or external URL requires review: ${n.name}`)
      return { type: 'none' }
    }
    try {
      const data = Buffer.from(match[2], 'base64'),
        size = imageSize(data),
        uid = createHash('md5').update(data).digest('hex')
      if (!entries.some((e) => e.path === 'resources/' + uid)) {
        entries.push({ path: 'resources/' + uid, data })
        resourceComponents.push(component(uid, match[1]))
      }
      report.images++
      let width = size.width,
        height = size.height
      if (sizeValue === 'cover' || sizeValue === 'contain') {
        const scale = (sizeValue === 'cover' ? Math.max : Math.min)(
          n.width / size.width,
          n.height / size.height,
        )
        width = size.width * scale
        height = size.height * scale
      } else {
        const values = sizeValue.trim().split(/\s+/),
          dimension = (v: string | undefined, container: number) =>
            !v || v === 'auto'
              ? undefined
              : /^-?[\d.]+(?:px|%)?$/.test(v)
                ? parseFloat(v) * (v.endsWith('%') ? container / 100 : 1)
                : NaN
        const w = dimension(values[0], n.width),
          h = dimension(values[1], n.height)
        if (Number.isNaN(w) || Number.isNaN(h)) {
          warn(`Background image size requires review: ${n.name}`)
        } else if (w !== undefined && h !== undefined) {
          width = w
          height = h
        } else if (w !== undefined) {
          width = w
          height = (size.height * w) / size.width
        } else if (h !== undefined) {
          height = h
          width = (size.width * h) / size.height
        }
      }
      const positions = positionValue.trim().split(/\s+/)
      const coordinate = (v: string | undefined, space: number) =>
        v === 'center'
          ? space / 2
          : v === 'right' || v === 'bottom'
            ? space
            : v === 'left' || v === 'top'
              ? 0
              : /^-?[\d.]+%$/.test(v ?? '')
                ? (parseFloat(v!) * space) / 100
                : /^-?[\d.]+(?:px)?$/.test(v ?? '')
                  ? parseFloat(v!)
                  : 0
      if (positions.length > 2) warn(`Complex background image position requires review: ${n.name}`)
      const x = coordinate(positions[0], n.width - width),
        y = coordinate(positions[1] ?? '50%', n.height - height)
      return {
        type: 'pattern',
        $frameuiBounds: { x, y, width, height },
        pattern: {
          width: size.width,
          height: size.height,
          href: '/resources/' + uid,
          meta: { ux: { uid, scaleBehavior: 'fill' } },
        },
      }
    } catch {
      warn(`Background image could not be decoded: ${n.name}`)
      return { type: 'none' }
    }
  }
  function backgroundPaints(n: FrameUiExportNode): Agc[] {
    const appearance = n.captureAppearance
    const raw = appearance?.backgroundImage
    const result: Agc[] = []
    if (raw && raw !== 'none') {
      const base = appearance.backgroundColor
      if (base && base !== 'transparent')
        result.push(paint({ type: 'SOLID', color: base, opacity: 1 }, n.width, n.height))
      const layers = split(raw),
        sizes = split(appearance.backgroundSize ?? 'auto'),
        positions = split(appearance.backgroundPosition ?? '0% 0%')
      // CSS's first background is on top. AGC children paint in document order.
      for (let index = layers.length - 1; index >= 0; index--) {
        const value = layers[index]
        result.push(
          backgroundImage(
            value,
            n,
            sizes[index % sizes.length],
            positions[index % positions.length],
          ) ??
            paint(
              {
                type: /gradient\(/.test(value) ? 'GRADIENT' : 'SOLID',
                ...(/gradient\(/.test(value) ? { value } : { color: value }),
                opacity: 1,
              } as FrameUiPaint,
              n.width,
              n.height,
            ),
        )
      }
      return result
    }
    for (const fill of [...n.fills].reverse()) {
      if (fill.type === 'GRADIENT')
        for (const value of split(fill.value).reverse())
          result.push(backgroundImage(value, n) ?? paint({ ...fill, value }, n.width, n.height))
      else result.push(backgroundImage(fill.color, n) ?? paint(fill, n.width, n.height))
    }
    return result
  }
  const gradients: Record<string, unknown> = {}
  const clipPaths: Record<string, unknown> = {}
  function paint(p: FrameUiPaint | undefined, w: number, h: number): Agc {
    try {
      return unsafePaint(p, w, h)
    } catch {
      warn(`Unsupported paint was omitted: ${p?.type === 'GRADIENT' ? p.value : (p?.color ?? '')}`)
      return { type: 'none' }
    }
  }
  function unsafePaint(p: FrameUiPaint | undefined, w: number, h: number): Agc {
    if (!p) return { type: 'none' }
    if (p.type === 'SOLID') {
      if (/^url\(/.test(p.color)) {
        warn(`SVG paint reference requires review: ${p.color}`)
        return { type: 'none' }
      }
      const c = safeColor(p.color)
      {
        const alpha = (c.alpha ?? 1) * p.opacity
        if (alpha === 1) delete c.alpha
        else c.alpha = alpha
      }
      return { type: 'solid', color: c }
    }
    if (split(p.value).length > 1) {
      warn('Layered paint outside a background requires review.')
      return paint({ ...p, value: split(p.value)[0] }, w, h)
    }
    const match = /^(linear|radial)-gradient\((.*)\)$/.exec(p.value)
    if (!match) {
      warn(`Unsupported paint remains transparent: ${p.value}`)
      return { type: 'none' }
    }
    const parts = split(match[2])
    let direction = ''
    if (!parse(parts[0].replace(/\s+-?[\d.]+%$/, ''))) direction = parts.shift()!
    const stops = parts.map((s) => {
      const m = /^(.*?)\s+(-?[\d.]+)%$/.exec(s)
      const c = color(m ? m[1] : s)
      {
        const alpha = (c.alpha ?? 1) * p.opacity
        if (alpha === 1) delete c.alpha
        else c.alpha = alpha
      }
      return {
        offset: m ? Number(m[2]) / 100 : (undefined as number | undefined),
        color: c,
      }
    })
    if (!stops.length) throw new Error('Empty XD gradient')
    stops[0].offset ??= 0
    stops[stops.length - 1].offset ??= 1
    for (let i = 1; i < stops.length - 1; i++)
      if (stops[i].offset === undefined) {
        let end = i + 1
        while (stops[end].offset === undefined) end++
        const from = stops[i - 1].offset!,
          to = stops[end].offset!
        for (let j = i; j < end; j++)
          stops[j].offset = from + ((to - from) * (j - i + 1)) / (end - i + 1)
        i = end - 1
      }
    const ref = idFor('gradient:' + p.value + ':' + p.opacity + ':' + w + ':' + h)
    gradients[ref] = { type: match[1], stops }
    const angle = /deg/.test(direction)
      ? parseFloat(direction)
      : ({ 'to right': 90, 'to left': 270, 'to top': 0 }[direction] ?? 180)
    if (match[1] === 'radial') {
      const at = /at\s+([\d.]+)%\s+([\d.]+)%/.exec(direction)
      const cx = at ? Number(at[1]) / 100 : 0.5,
        cy = at ? Number(at[2]) / 100 : 0.5
      // XD's native radial definition is circular; CSS elliptical sizing is reported.
      if (!/^circle(?:\s|$)/.test(direction))
        warn('Elliptical radial gradients are approximated with editable circular gradients.')
      return {
        type: 'gradient',
        gradient: {
          meta: { ux: { gradientResources: gradients[ref] } },
          units: 'objectBoundingBox',
          cx,
          cy,
          fx: cx,
          fy: cy,
          r: Math.hypot(Math.max(cx, 1 - cx) * w, Math.max(cy, 1 - cy) * h) / (w || 1),
        },
      }
    }
    const a = (angle * Math.PI) / 180,
      dx = Math.sin(a),
      dy = -Math.cos(a),
      len = Math.abs(w * dx) + Math.abs(h * dy)
    return {
      type: 'gradient',
      gradient: {
        meta: { ux: { gradientResources: gradients[ref] } },
        units: 'objectBoundingBox',
        x1: 0.5 - (dx * len) / (2 * (w || 1)),
        y1: 0.5 - (dy * len) / (2 * (h || 1)),
        x2: 0.5 + (dx * len) / (2 * (w || 1)),
        y2: 0.5 + (dy * len) / (2 * (h || 1)),
      },
    }
  }
  const masterSources = read<{ components: FrameUiExportNode[] }>('components.json').components
  const symbols: Agc[] = []
  const masterCache = new Map<string, { node: Agc; source: FrameUiExportNode; symbolId: string }>()
  const activeMasters = new Set<string>()
  function ensureMaster(
    id: string,
  ): { node: Agc; source: FrameUiExportNode; symbolId: string } | undefined {
    if (masterCache.has(id)) return masterCache.get(id)
    const source = masterSources.find((m) => m.id === id)
    if (!source) {
      warn(`Component definition is unavailable: ${id}`)
      return
    }
    if (activeMasters.has(id)) {
      warn(`Circular component definition requires review: ${source.name}`)
      return
    }
    activeMasters.add(id)
    const previousNamespace = pageNamespace
    try {
      pageNamespace = 'component:' + id
      const definition = node({ ...source, x: 0, y: 0, component: undefined })
      const symbolId = idFor('symbol:' + id)
      definition.meta = {
        ux: {
          hasCustomName: true,
          symbolId,
          width: source.width,
          height: source.height,
          componentType: 'componentNoBounds',
          modTime: Date.parse(request.document.updatedAt) || 0,
        },
      }
      delete definition.transform
      const master = { node: definition, source, symbolId }
      masterCache.set(id, master)
      symbols.push(definition)
      report.components++
      return master
    } finally {
      pageNamespace = previousNamespace
      activeMasters.delete(id)
    }
  }
  function clipped(
    result: Agc,
    n: FrameUiExportNode,
    definitions?: Map<string, SvgDefinition>,
  ): Agc {
    const { regions, warnings } = xdClipGeometry(n, definitions)
    warnings.forEach(warn)
    if (!regions.length) return result
    let output = result
    for (const [index, children] of regions.entries()) {
      const ref = idFor(pageNamespace + ':' + n.id + ':clip:' + index)
      clipPaths[ref] = { type: 'clipPath', children }
      const group = output.group as { children: Agc[] } | undefined
      if (index === 0 && group) {
        output = { ...output, style: { ...(output.style as Agc), clipPath: { ref } } }
      } else {
        const content = {
          ...output,
          id: idFor(pageNamespace + ':' + n.id + ':clipped:' + index),
          transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        }
        output = {
          id: result.id,
          name: result.name,
          transform: result.transform,
          type: 'group',
          meta: result.meta,
          style: { clipPath: { ref } },
          group: { children: [content] },
        }
      }
    }
    report.clippingMasks += regions.length
    return output
  }
  let pageNamespace = ''
  function node(
    n: FrameUiExportNode,
    svg?: { transform: string; definitions: Map<string, SvgDefinition>; strokeScale?: number; viewportWidth?: number; viewportHeight?: number },
    ancestors = new Set<string>(),
  ): Agc {
    const lines=renderedLines[pageNamespace+':'+n.id]
    if(n.text&&lines?.length)n={...n,text:{...n.text,captureLines:lines}}
    report.layers++
    const a = (n.rotation * Math.PI) / 180
    const transform = {
      a: Math.cos(a),
      b: Math.sin(a),
      c: -Math.sin(a),
      d: Math.cos(a),
      tx: n.x + n.width / 2 - (Math.cos(a) * n.width) / 2 + (Math.sin(a) * n.height) / 2,
      ty: n.y + n.height / 2 - (Math.sin(a) * n.width) / 2 - (Math.cos(a) * n.height) / 2,
    }
    // CSS transforms apply around transform-origin; layout bounds remain untransformed.
    const css = n.captureAppearance?.transform
    if (css && css !== 'none') {
      const match = /^matrix\(([^)]+)\)$/.exec(css)
      const m = match?.[1].split(/[, ]+/).map(Number)
      if (m?.length === 6 && m.every(Number.isFinite)) {
        const origin = (n.captureAppearance?.transformOrigin ?? '50% 50%').split(/\s+/)
        const pos = (v: string, size: number) =>
          v.endsWith('%') ? (parseFloat(v) * size) / 100 : parseFloat(v) || 0
        const ox = pos(origin[0], n.width),
          oy = pos(origin[1] ?? '50%', n.height)
        Object.assign(transform, {
          a: m[0],
          b: m[1],
          c: m[2],
          d: m[3],
          tx: n.x + m[4] + ox - m[0] * ox - m[2] * oy,
          ty: n.y + m[5] + oy - m[1] * ox - m[3] * oy,
        })
      } else warn(`Unsupported transform requires review: ${n.name}`)
    }
    const base: Agc = {
      id: idFor(pageNamespace + ':' + n.id),
      name: n.name,
      transform,
      meta: { ux: { hasCustomName: true } },
      style: {
        opacity: n.opacity,
        fill:
          (n.captureAppearance?.backgroundImage &&
            n.captureAppearance.backgroundImage !== 'none') ||
          n.fills.some((f) => f.type === 'GRADIENT' && split(f.value).length > 1)
            ? { type: 'none' }
            : paint(n.fills[0], n.width, n.height),
        ...(n.strokes.length && n.strokeWidth > 0 ? { stroke: {
          ...paint(n.strokes[0], n.width, n.height),
          width: n.strokeWidth * (n.vector?.geometry?.['vector-effect'] === 'non-scaling-stroke' ? 1 : (svg?.strokeScale ?? 1)),
          ...(n.vector ? {} : { align: 'inside' }),
          ...(n.vector?.geometry?.['stroke-linecap'] ? { cap: n.vector.geometry['stroke-linecap'] } : {}),
          ...(n.vector?.geometry?.['stroke-linejoin'] ? { join: n.vector.geometry['stroke-linejoin'] } : {}),
        } } : {}),
      },
    }
    const nativeStyle = base.style as Agc
    if (!n.visible) nativeStyle.opacity = 0
    if (n.locked) base.meta = { ux: { hasCustomName: true, locked: true } }

    const filters: Agc[] = []
    const addBlur = (radius: number, background: boolean) => {
      if (!Number.isFinite(radius) || radius < 0) {
        warn(`Unresolved blur: ${n.name}`)
        return
      }
      const amount = Math.min(50, radius)
      if (amount !== radius)
        warn(`XD blur is limited to 50; ${radius}px blur was clamped: ${n.name}`)
      if (
        filters.some(
          (f) => f.type === 'uxdesign#blur' && (f.params as Agc).backgroundEffect === background,
        )
      )
        return
      filters.push({
        type: 'uxdesign#blur',
        global: true,
        params: {
          blurAmount: amount,
          brightnessAmount: 0,
          fillOpacity: 1,
          backgroundEffect: background,
        },
      })
    }
    for (const effect of n.effects) {
      if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
        for (const part of split(effect.value)) {
          const c = part.match(
            /(?:rgba?|hsla?)\([^)]*\)|#[\da-f]+|\b(?:black|white|transparent)\b/i,
          )
          const lengths = part
            .replace(c?.[0] ?? '', '')
            .replace(/\binset\b/g, '')
            .trim()
            .split(/\s+/)
            .map(parseFloat)
          if (lengths.length >= 2 && lengths.every(Number.isFinite)) {
            const shadow = {
              dx: lengths[0],
              dy: lengths[1],
              r: lengths[2] ?? 0,
              color: safeColor(c?.[0] ?? 'black'),
            }
            const inner = /\binset\b/.test(part)
            filters.push({
              type: inner ? 'uxdesign#innerShadow' : 'dropShadow',
              global: true,
              params: { [inner ? 'innerShadows' : 'dropShadows']: [shadow] },
            })
            if (lengths[3])
              warn(`Shadow spread has no native XD equivalent and is omitted: ${n.name}`)
          } else warn(`Unresolved shadow: ${n.name}`)
        }
      } else if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR')
        addBlur(effect.radius ?? parseFloat(effect.value), effect.type === 'BACKGROUND_BLUR')
      else if (!(
        effect.type === 'UNSUPPORTED' && n.captureAppearance?.backgroundImage === effect.value
      ))
        warn(`${effect.type} requires visual review in Adobe XD: ${n.name}`)
    }
    for (const [value, background] of [
      [n.captureAppearance?.filter, false],
      [n.captureAppearance?.backdropFilter, true],
    ] as const) {
      if (!value || value === 'none') continue
      if (!background && renderedImage(n)) {
        warn(
          'Image-only CSS colour effects were baked into an editable image resource; the original is retained in companion data.',
        )
        continue
      }
      const blur = /^blur\(([\d.]+)px\)$/.exec(value)
      if (blur) addBlur(Number(blur[1]), background)
      else warn(`Unsupported CSS ${background ? 'backdrop ' : ''}filter: ${n.name} (${value})`)
    }
    if (filters.length) {
      nativeStyle.filters = filters
      report.nativeEffects += filters.length
    }
    if (n.component) {
      const master = ensureMaster(n.component.componentId)
      const unchanged =
        master &&
        !n.children.length &&
        !n.component.overrides?.length &&
        !Object.keys(n.component.variant ?? {}).length &&
        n.width === master.source.width &&
        n.height === master.source.height &&
        !filters.some((f) => (f.params as Agc)?.backgroundEffect)
      if (unchanged) {
        const syncMap: Record<string, string> = {}
        const register = (v: unknown) => {
          if (!v || typeof v !== 'object') return
          if (Array.isArray(v)) {
            v.forEach(register)
            return
          }
          const value = v as Agc
          if (typeof value.id === 'string')
            syncMap[value.id] = idFor(pageNamespace + ':' + n.id + ':sync:' + value.id)
          Object.values(value).forEach(register)
        }
        const sourceChildren =
          (master.node.group as { children: Agc[] } | undefined)?.children ?? []
        sourceChildren.forEach(register)
        const references = sourceChildren.map((child) => ({
          type: 'syncRef',
          syncSourceGuid: child.id,
          guid: syncMap[String(child.id)],
        }))
        report.linkedInstances++
        return clipped(
          {
            ...base,
            type: 'group',
            meta: {
              ux: {
                hasCustomName: true,
                symbolId: master.symbolId,
                width: n.width,
                height: n.height,
                componentType: 'componentNoBounds',
                syncMap,
              },
            },
            style: {
              opacity: n.visible ? n.opacity : 0,
            },
            group: { children: references },
          },
          n,
          svg?.definitions,
        )
      }
      if (master && !n.children.length) {
        const sx = n.width / (master.source.width || 1),
          sy = n.height / (master.source.height || 1)
        const clone = (c: FrameUiExportNode): FrameUiExportNode => ({
          ...c,
          id: n.id + ':expanded:' + c.id,
          x: c.x * sx,
          y: c.y * sy,
          width: c.width * sx,
          height: c.height * sy,
          children: c.children.map(clone),
        })
        n = { ...n, children: master.source.children.map(clone) }
      }
      warn(
        `Component with local overrides, variants or resized bounds exports as editable groups: ${n.name}`,
      )
    }
    const geometry = n.vector?.geometry ?? {}
    let childSvg = svg
    if (n.vector?.tag === 'svg') {
      const vb = (n.vector.viewBox ?? `0 0 ${n.width} ${n.height}`).split(/[ ,]+/).map(Number)
      const scale = Math.min(n.width / (vb[2] || n.width || 1), n.height / (vb[3] || n.height || 1))
      childSvg = {
        transform: `translate(${(n.width - vb[2] * scale) / 2} ${(n.height - vb[3] * scale) / 2}) scale(${scale}) translate(${-vb[0]} ${-vb[1]})`,
        definitions: svgDefinitionMap(geometry.definitions),
        strokeScale: (svg?.strokeScale ?? 1) * scale,
        viewportWidth: vb[2] || n.width,
        viewportHeight: vb[3] || n.height,
      }
    }
    if (svg) Object.assign(transform, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })
    if (n.vector?.tag === 'use') {
      const ref = (geometry.href ?? geometry['xlink:href'])?.replace(/^#/, '')
      const resource = ref ? svg?.definitions.get(ref) : undefined
      if (resource && ref && !ancestors.has(ref)) {
        const resourceViewBox = resource.attributes?.viewBox?.trim().split(/[ ,]+/).map(Number)
        const viewportWidth = Number(geometry.width) || svg?.viewportWidth || n.width
        const viewportHeight = Number(geometry.height) || svg?.viewportHeight || n.height
        const symbolScale = resourceViewBox?.length === 4 && resourceViewBox[2] > 0 && resourceViewBox[3] > 0
          ? Math.min(viewportWidth / resourceViewBox[2], viewportHeight / resourceViewBox[3]) : 1
        const symbolTransform = resourceViewBox?.length === 4
          ? ` translate(${(viewportWidth - resourceViewBox[2] * symbolScale) / 2} ${(viewportHeight - resourceViewBox[3] * symbolScale) / 2}) scale(${symbolScale}) translate(${-resourceViewBox[0]} ${-resourceViewBox[1]})` : ''
        const context = svg
          ? {
              ...svg,
              transform:
                svg.transform + ` translate(${Number(geometry.x) || 0} ${Number(geometry.y) || 0})` + symbolTransform,
              strokeScale: (svg.strokeScale ?? 1) * symbolScale,
            }
          : undefined
        return {
          ...base,
          type: 'group',
          style: { opacity: n.opacity },
          group: {
            children: expandSvgResource(n, resource).map((c) =>
              node(c, context, new Set([...ancestors, ref])),
            ),
          },
        }
      }
      warn(`Unresolved SVG resource: ${n.name}`)
    }
    if (childSvg && geometry.transform)
      childSvg = {
        ...childSvg,
        transform: childSvg.transform + ' ' + geometry.transform,
      }
    // DOM order breaks CSS stacking when later pseudo visuals sit behind positioned content.
    const children = [...n.children].sort((a, b) => (a.captureAppearance?.zIndex ?? 0) - (b.captureAppearance?.zIndex ?? 0)).map((c) => node(c, childSvg, ancestors))
    const rect = {
      type: 'rect',
      x: 0,
      y: 0,
      width: n.width,
      height: n.height,
      r: n.radius,
    }
    if (n.text && !n.control) {
      if(isIconFontText(n.text.characters)){
        const t=n.text,face=measured.get(xdFontKey(t.fontFamily,t.fontWeight,t.fontStyle))
        const delta=face?.sourceBaselineBySize?.[String(t.fontSize)]??face?.baselineBySize?.[String(t.fontSize)]
        const path=iconResolvers.get(pageNamespace)?.(t,Number.isFinite(delta)?height=>height/2+delta!:undefined)
        if(path){report.editableVectors++;nativeStyle.fill=paint({type:'SOLID',color:t.color??'#000000',opacity:1},n.width,n.height);delete nativeStyle.stroke;return clipped({...base,type:'shape',shape:{type:'path',path}},n,svg?.definitions)}
        warn(`Icon font outline unavailable: ${n.name}. Recapture with its embedded font available.`)
      }
      const originalTransform={...transform}
      const appearance=n.captureAppearance
      const hasSurface=!!appearance && (!!appearance.backgroundColor || (!!appearance.backgroundImage&&appearance.backgroundImage!=='none') || !!appearance.border || !!appearance.boxShadow)
      const surface=hasSurface?node({...n,id:n.id+':text-surface',name:n.name+' background',type:'RECTANGLE',x:0,y:0,rotation:0,opacity:1,fills:appearance?.backgroundColor?[{type:'SOLID',color:appearance.backgroundColor,opacity:1}]:[],text:undefined,children:[],childIds:[],captureAppearance:{...appearance,transform:undefined}},undefined,ancestors):undefined
      report.editableText++
      const positioned = xdPositionedText(n.text)
      const t = {...n.text, characters:positioned.characters, runs:positioned.runs}
      const family = t.fontFamily.split(',')[0].replace(/["']/g, '').trim()
      const resolved = resolveFont(t.fontFamily, t.fontWeight, t.fontStyle)
      const postscript = resolved?.postscript
      if (resolved && resolved.family.toLowerCase() !== family.toLowerCase())
        warn(
          measured.get(xdFontKey(t.fontFamily, t.fontWeight, t.fontStyle))?.substitutedFrom
            ? `Editable font substitution: private macOS UI font → ${resolved.family}. Original text and styling remain in the FrameUI companion.`
            : measured.has(xdFontKey(t.fontFamily, t.fontWeight, t.fontStyle))
            ? `Browser-rendered fallback matched: ${family} → ${resolved.family}. The destination needs the matching font face.`
            : `Catalog font fallback: ${family} → ${resolved.family}. Browser metrics are not verified.`,
        )
      if (!postscript)
        warn(`Install and verify font face: ${family} ${t.fontWeight} ${t.fontStyle}`)
      else if(fonts.length&&!fonts.some(face=>face.postscript===postscript))
        warn(`Source font face is not installed: ${resolved?.family??family} ${resolved?.style??t.fontWeight} (${postscript}). XD may substitute its weight and metrics; install the matching source font before reviewing.`)
      const font = {
        family: resolved?.family ?? 'Arial',
        style: resolved?.style ?? 'Regular',
        size: t.fontSize,
        postscriptName: postscript ?? 'ArialMT',
      }
      nativeStyle.font = font
      nativeStyle.fill = paint(
        { type: 'SOLID', color: t.color ?? '#000000', opacity: 1 },
        n.width,
        n.height,
      )
      if (t.gradient) {
        nativeStyle.fill = paint(
          { type: 'GRADIENT', value: t.gradient.image, opacity: 1 },
          n.width,
          n.height,
        )
        warn('Text gradient geometry requires review in Adobe XD.')
      }
      const boundaries = [
        ...new Set([
          0,
          t.characters.length,
          ...(t.runs ?? []).flatMap((r) => [
            Math.max(0, r.start),
            Math.min(t.characters.length, r.end),
          ]),
        ]),
      ]
        .filter((v) => v >= 0 && v <= t.characters.length)
        .sort((a, b) => a - b)
      const rangedStyles = boundaries.slice(0, -1).map((start, index) => {
        const end = boundaries[index + 1],
          run = t.runs?.find((r) => r.start <= start && r.end >= end)
        const weight = run?.fontWeight ?? t.fontWeight,
          style = run?.fontStyle ?? t.fontStyle
        const c = safeColor(run?.color ?? t.color ?? '#000000')
        const runResolved = resolveFont(run?.fontFamily ?? t.fontFamily, weight, style)
        return {
          length: end - start,
          linkId: '',
          fontFamily: runResolved?.family ?? font.family,
          fontStyle: runResolved?.style ?? font.style,
          postscriptName: runResolved?.postscript ?? font.postscriptName,
          fontSize: run?.fontSize ?? t.fontSize,
          charSpacing: ((run?.letterSpacing ?? t.letterSpacing) / (run?.fontSize ?? t.fontSize)) * 1000,
          underline: /underline/.test(run?.textDecoration ?? t.decoration ?? ''),
          strikethrough: /line-through/.test(run?.textDecoration ?? t.decoration ?? ''),
          textTransform: 'none',
          textScript: 'none',
          fill: {
            value:
              ((Math.round((c.alpha ?? 1) * 255) << 24) |
                (c.value.r << 16) |
                (c.value.g << 8) |
                c.value.b) >>>
              0,
          },
        }
      })
      base.meta = {
        ux: { hasCustomName: true, singleTextObject: true, rangedStyles },
      }
      nativeStyle.textAttributes = {
        paragraphAlign:
          t.alignment === 'start' ? 'left' : t.alignment === 'end' ? 'right' : t.alignment,
      }
      const rawText = t.characters
      const measuredFace = measured.get(xdFontKey(t.fontFamily, t.fontWeight, t.fontStyle))
      const baselineDelta = measuredFace?.sourceBaselineBySize?.[String(t.fontSize)] ?? measuredFace?.baselineBySize?.[String(t.fontSize)]
      if (!Number.isFinite(baselineDelta))
        warn(
          'Text baselines are not browser-measured; Adobe XD font metrics require visual validation.',
        )
      const alignment = n.text.captureLines?.length ? 'left' : t.alignment === 'start' ? 'left' : t.alignment === 'end' ? 'right' : t.alignment
      const factor=alignment==='center'?0.5:alignment==='right'?1:0
      const positionedLines=positioned.lines.map(l=>{
        const text=t.characters.slice(l.from,l.to)
        const active=(t.runs??[]).find(run=>run.start<=l.from&&run.end>l.from)
        const lineSize=active?.fontSize??t.fontSize,lineFamily=active?.fontFamily??t.fontFamily,lineWeight=active?.fontWeight??t.fontWeight,lineStyle=active?.fontStyle??t.fontStyle
        const lineFace=measured.get(xdFontKey(lineFamily,lineWeight,lineStyle))??measuredFace
        const lineDelta=lineFace?.sourceBaselineBySize?.[String(lineSize)]??lineFace?.baselineBySize?.[String(lineSize)]
        const lineBaseline=Number.isFinite(lineDelta)?l.height/2+lineDelta!:lineSize
        const metric=lineFace?.inkByText?.[JSON.stringify([lineSize,text])]
        const mixed=(t.runs??[]).some(r=>r.start<l.to&&r.end>l.from&&((r.fontFamily&&r.fontFamily!==t.fontFamily)||(r.fontSize&&r.fontSize!==t.fontSize)||(r.fontWeight&&r.fontWeight!==t.fontWeight)||(r.fontStyle&&r.fontStyle!==t.fontStyle)))
        const sourceAdvance=metric&&!mixed?metric.sourceWidth+text.length*t.letterSpacing:n.width
        const targetAdvance=metric&&!mixed?metric.targetWidth+Math.max(0,text.length-1)*t.letterSpacing:n.width
        const dx=metric&&!mixed?metric.targetLeft-metric.sourceLeft:0
        const dy=metric&&!mixed?metric.targetAscent-metric.sourceAscent:0
        const pointX=l.x+factor*n.width+factor*(targetAdvance-sourceAdvance)+dx
        return {pointX,x:pointX-factor*targetAdvance,y:l.y+lineBaseline+dy,from:l.from,to:l.to}
      })
      // Native centered/right point text caches a negative line advance; its anchor is distinct.
      const anchorX=positionedLines[0]?.pointX??0,anchorY=positionedLines[0]?.y??0
      transform.tx+=transform.a*anchorX+transform.c*anchorY
      transform.ty+=transform.b*anchorX+transform.d*anchorY
      const lines=positionedLines.map(({x,y,from,to})=>({x:x-anchorX,y:y-anchorY,from,to}))
      // Captured x/y already include browser alignment; do not align them a second time.
      nativeStyle.textAttributes = {paragraphAlign:alignment,lineHeight:t.lineHeight,letterSpacing:(t.letterSpacing/t.fontSize)*1000}
      const textNode:Agc={...base,type:'text',text:{frame:{type:'positioned'},paragraphs:lines.map(l=>({lines:[[l]]})),rawText}}
      if(surface){
        delete nativeStyle.stroke
        delete nativeStyle.filters
        nativeStyle.opacity=1
        return clipped({...base,transform:originalTransform,type:'group',style:{opacity:n.visible?n.opacity:0},group:{children:[surface,{...textNode,id:idFor(pageNamespace+':'+n.id+':editable-text'),transform:{a:1,b:0,c:0,d:1,tx:anchorX,ty:anchorY}}]}},n,svg?.definitions)
      }
      // Keep the clipping coordinate system at the captured box. XD does not
      // reliably apply transforms on clipPath children; translating those by
      // the text baseline can mask almost the entire line. Move only the text.
      if(xdClipGeometry(n,svg?.definitions).regions.length)
        return clipped({...base,transform:originalTransform,type:'group',style:{opacity:n.visible?n.opacity:0},group:{children:[{...textNode,id:idFor(pageNamespace+':'+n.id+':editable-text'),style:{...nativeStyle,opacity:1},transform:{a:1,b:0,c:0,d:1,tx:anchorX,ty:anchorY}}]}},n,svg?.definitions)
      return textNode
    }
    let shape: Agc = rect
    if (n.type === 'ELLIPSE')
      shape = {
        type: 'ellipse',
        cx: n.width / 2,
        cy: n.height / 2,
        rx: n.width / 2,
        ry: n.height / 2,
      }
    if (n.type === 'LINE') shape = { type: 'line', x1: 0, y1: 0, x2: n.width, y2: n.height }
    if (n.vector) {
      const path =
        n.vector.path ??
        geometryPath(n.vector.tag ?? '', n.vector.geometry ?? {}, n.width, n.height)
      if (path) {
        shape = {
          type: 'path',
          path: svgpath(path)
            .transform(`${svg?.transform ?? ''} ${geometry.transform ?? ''}`)
            .abs()
            .unshort()
            .unarc()
            .toString(),
        }
      } else if (!n.children.length) warn(`Vector requires manual review: ${n.name}`)
    }
    if (n.image) {
      const image = imageRefs.get(n.image.assetId)
      if (image) {
        report.images++
        const fit = n.captureAppearance?.objectFit ?? (n.image.fit === 'CONTAIN' ? 'contain' : n.image.fit === 'FILL' ? 'fill' : 'cover')
        const objectBounds = xdObjectImageBounds(n.width, n.height, image.width, image.height, fit, n.captureAppearance?.objectPosition)
        nativeStyle.fill = {
          type: 'pattern',
          $frameuiBounds: objectBounds,
          pattern: {
            width: image.width,
            height: image.height,
            href: `/resources/${image.uid}`,
            meta: {
              ux: {
                uid: image.uid,
                scaleBehavior: 'fill',
              },
            },
          },
        }
      } else warn(`Image resource is unsupported: ${n.name}`)
    }
    if (n.control && ['radio', 'checkbox'].includes(n.control.type) && n.control.appearance !== 'none') {
      // Native browser controls paint a UA ring even when computed CSS has no border/fill.
      if (!n.fills.length) nativeStyle.fill = { type: 'solid', color: safeColor('#ffffff') }
      if (!n.strokes.length || !n.strokeWidth) nativeStyle.stroke = {
        type: 'solid', color: safeColor(n.control.checked ? (n.captureAppearance?.accentColor ?? '#2563eb') : '#767676'), width: 1, align: 'inside',
      }
      warn('Browser-native radio and checkbox appearance uses editable native geometry; verify platform styling in Adobe XD.')
    }
    if (n.control?.type === 'radio')
      shape = {
        type: 'ellipse',
        cx: n.width / 2,
        cy: n.height / 2,
        rx: n.width / 2,
        ry: n.height / 2,
      }
    if (n.control?.checked && ['radio', 'checkbox'].includes(n.control.type)) {
      const mark =
        n.control.type === 'radio'
          ? {
              type: 'ellipse',
              cx: n.width / 2,
              cy: n.height / 2,
              rx: n.width * 0.22,
              ry: n.height * 0.22,
            }
          : {
              type: 'path',
              path: `M${n.width * 0.2} ${n.height * 0.5} L${n.width * 0.43} ${n.height * 0.73} L${n.width * 0.8} ${n.height * 0.25}`,
            }
      const accent =
        n.captureAppearance?.accentColor && n.captureAppearance.accentColor !== 'auto'
          ? n.captureAppearance.accentColor
          : '#2563eb'
      children.push({
        id: idFor(pageNamespace + ':' + n.id + ':checked'),
        name: 'Checked indicator',
        type: 'shape',
        style: {
          fill:
            n.control.type === 'radio'
              ? { type: 'solid', color: safeColor(accent) }
              : { type: 'none' },
          stroke: {
            type: 'solid',
            color: safeColor(accent),
            width: Math.max(1, n.width * 0.12),
          },
        },
        shape: mark,
      })
    }
    if (n.control) {
      warn(
        'Form controls are exported as editable design geometry, without runtime input behavior.',
      )
      const controlText =
        n.control.type === 'select'
          ? (n.control.options?.find((option) => option.value === (n.control?.value ?? ''))
              ?.label ??
            n.control.options?.[0]?.label ??
            n.control.value)
          : n.control.type === 'password' && n.control.value
            ? '•'.repeat(n.control.value.length)
            : n.control.value || n.control.placeholder
      if (
        controlText &&
        !['radio', 'checkbox', 'range'].includes(n.control.type) &&
        !children.some((c) => c.type === 'text')
      ) {
        const padding = n.layout.padding,
          t = n.text
        const fontSize = t?.fontSize ?? 16
        const lineHeight = t?.lineHeight ?? fontSize * 1.2
        children.push(
          node({
            ...n,
            id: n.id + ':control-text',
            type: 'TEXT',
            name: n.control.type === 'select' ? 'Selected option' : 'Input text',
            x: padding.left,
            y: n.control.type === 'textarea' ? padding.top : (n.height - lineHeight) / 2,
            width: Math.max(1, n.width - padding.left - padding.right),
            height: n.control.type === 'textarea' ? Math.max(1, n.height - padding.top - padding.bottom) : lineHeight,
            opacity: 1,
            children: [],
            childIds: [],
            control: undefined,
            image: undefined,
            component: undefined,
            captureAppearance: undefined,
            effects: [],
            fills: [],
            strokes: [],
            strokeWidth: 0,
            clipContent: false,
            rotation: 0,
            text: {
              ...t,
              characters: controlText,
              fontFamily: t?.fontFamily ?? 'Arial',
              fontWeight: t?.fontWeight ?? '400',
              fontStyle: t?.fontStyle ?? 'Regular',
              fontSize,
              lineHeight: t?.lineHeight ?? fontSize * 1.2,
              letterSpacing: t?.letterSpacing ?? 0,
              alignment: t?.alignment ?? 'left',
              captureLines: undefined,
              runs: undefined,
              color:
                n.control.value || n.control.type === 'select'
                  ? (t?.color ?? '#172b40')
                  : (n.control.placeholderColor ?? t?.color ?? '#757575'),
            },
          }),
        )
      }
    }
    if (
      n.image ||
      children.length ||
      (n.captureAppearance?.backgroundImage && n.captureAppearance.backgroundImage !== 'none') ||
      n.fills.some((f) => f.type === 'GRADIENT' && split(f.value).length > 1) ||
      [
        'GROUP',
        'FRAME',
        'SECTION',
        'COMPONENT',
        'COMPONENT_INSTANCE',
        ...(n.vector?.tag === 'svg' || n.vector?.tag === 'g' ? ['VECTOR'] : []),
      ].includes(n.type)
    ) {
      if (filters.some((f) => f.type === 'uxdesign#blur' && !(f.params as Agc)?.backgroundEffect))
        warn(`Composite group blur requires visual review in Adobe XD: ${n.name}`)
      const backgrounds = backgroundPaints(n)
      if (n.control && ['radio', 'checkbox'].includes(n.control.type) && n.control.appearance !== 'none' && !backgrounds.length) backgrounds.push(nativeStyle.fill as Agc)
      if (n.image && nativeStyle.fill) backgrounds.push(nativeStyle.fill as Agc)
      if (!backgrounds.length && (nativeStyle.stroke || filters.length))
        backgrounds.push({ type: 'none' })
      const layers = backgrounds.map((input, index) => {
        const { $frameuiBounds, ...fill } = input
        const bounds = $frameuiBounds as
          { x: number; y: number; width: number; height: number } | undefined
        const shapeLayer: Agc = {
          ...base,
          id: idFor(pageNamespace + ':' + n.id + ':background:' + index),
          name: n.name + ' background ' + (index + 1),
          transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          style: {
            fill,
            opacity: 1,
            ...(index === backgrounds.length - 1 ? { stroke: nativeStyle.stroke } : {}),
            ...(filters.length && index === 0
              ? {
                  filters: filters.filter(
                    (f) =>
                      f.type === 'dropShadow' ||
                      f.type === 'uxdesign#innerShadow' ||
                      (f.params as Agc)?.backgroundEffect,
                  ),
                }
              : {}),
          },
          type: 'shape',
          shape: bounds ? { type: 'rect', ...bounds } : shape,
        }
        if (!bounds) return shapeLayer
        const ref = idFor(pageNamespace + ':' + n.id + ':background-clip:' + index)
        clipPaths[ref] = {
          type: 'clipPath',
          children: [
            {
              type: 'shape',
              shape: { type: 'rect', x: 0, y: 0, width: n.width, height: n.height, r: n.radius },
            },
          ],
        }
        report.clippingMasks++
        return {
          id: idFor(pageNamespace + ':' + n.id + ':background-mask:' + index),
          name: n.name + ' image crop',
          type: 'group',
          style: { clipPath: { ref } },
          group: { children: [shapeLayer] },
        }
      })
      children.unshift(...layers)
      const group: Agc = {
        ...base,
        style: {
          opacity: n.visible ? n.opacity : 0,
        },
        type: 'group',
        group: { children },
      }
      return clipped(group, n, svg?.definitions)
    }
    report.editableVectors++
    return clipped({ ...base, type: 'shape', shape }, n, svg?.definitions)
  }
  const artboards: Record<string, unknown> = {}
  const artwork: Agc[] = []
  const placement = xdCanvasPlacement(selected, request.document.prototype?.flows)
  if (placement.rearranged) warn('Artboards rearranged within Adobe XD canvas limits; original pixel dimensions are preserved.')
  for (const [index, p] of pages.entries()) {
    progress(`Serializing artboard ${index + 1} of ${pages.length}`)
    const source = selected.find((s) => s.id === p.id)!
    const id = idFor(p.id)
    const bounds = placement.bounds.get(p.id)!
    artboards[id] = { ...bounds, name: p.name }
    pageNamespace = p.id
    const interactionTargets = new Set(
      (request.document.prototype?.interactions ?? []).flatMap((interaction) =>
        [interaction.sourceElementId, interaction.targetElementId].filter(
          (id): id is string => !!id,
        ),
      ),
    )
    const projection = xdArtboardProjection(source, p.root.children, interactionTargets)
    const nativeChildren = projection.children.map((child) => node(child))
    // Native artboard children use document coordinates. Add the canvas origin exactly once.
    for (const child of nativeChildren) {
      const tr = child.transform as Record<string, number>
      tr.tx += bounds.x
      tr.ty += bounds.y
    }
    entries.push(
      jsonEntry(`artwork/artboard-${id}/graphics/graphicContent.agc`, {
        version: '1.5.0',
        children: [
          {
            type: 'artboard',
            id,
            style: {
              fill: projection.background
                ? paint(projection.background, p.width, p.height)
                : { type: 'solid', color: safeColor('#ffffff') },
            },
            artboard: {
              children: nativeChildren,
              meta: { ux: { path: id } },
              ref: id,
            },
          },
        ],
        resources: { href: '/resources/graphics/graphicContent.agc' },
        artboards: { href: '/resources/graphics/graphicContent.agc' },
      }),
    )
    artwork.push({
      ...folder(`artboard-${id}`, [
        folder(
          'graphics',
          [],
          [component('graphicContent.agc', 'application/vnd.adobe.agc.graphicsTree+json')],
        ),
      ]),
      name: p.name,
      'uxdesign#bounds': bounds,
    })
  }
  entries.push(
    jsonEntry('artwork/pasteboard/graphics/graphicContent.agc', {
      version: '1.5.0',
      children: [],
      resources: { href: '/resources/graphics/graphicContent.agc' },
      artboards: { href: '/resources/graphics/graphicContent.agc' },
    }),
  )
  artwork.unshift(
    folder('pasteboard', [
      folder(
        'graphics',
        [],
        [component('graphicContent.agc', 'application/vnd.adobe.agc.graphicsTree+json')],
      ),
    ]),
  )
  for (const master of masterSources) ensureMaster(master.id)
  entries.push(
    jsonEntry('resources/graphics/graphicContent.agc', {
      version: '1.5.0',
      children: [],
      resources: {
        gradients,
        clipPaths,
        meta: {
          ux: {
            symbols,
            symbolsMetadata: { usingNestedSymbolSyncing: true },
            colorSwatches: [],
            documentLibrary: { version: 4, elements: [] },
          },
        },
      },
      artboards,
    }),
  )
  const interactions: Record<string, Agc[]> = {}
  if (request.includePrototype)
    for (const interaction of request.document.prototype?.interactions ?? []) {
      if (!selected.some((p) => p.id === interaction.sourceArtboardId)) continue
      const sourceId = interaction.sourceElementId
        ? idFor(interaction.sourceArtboardId + ':' + interaction.sourceElementId)
        : idFor(interaction.sourceArtboardId)
      const append = (action: Agc) => {
        const sourceActions = (interactions[sourceId] ??= [])
        sourceActions.push({
          ...action,
          id: idFor(interaction.id),
          triggerEvent: 'tap',
        })
      }
      if (interaction.trigger !== 'click') {
        warn(`Unsupported prototype trigger: ${interaction.trigger}`)
        continue
      }
      if (
        interaction.action === 'navigate' &&
        selected.some((p) => p.id === interaction.destinationId)
      )
        append({
          action: 'artboard-transition',
          properties: {
            destination: idFor(interaction.destinationId!),
            transition: interaction.transition === 'fade' ? 'dissolve' : 'none',
            duration: interaction.transition === 'fade' ? 0.3 : 0,
            easing: 'ease-out',
            preserveScrollPosition: false,
          },
        })
      else if (interaction.action === 'back')
        append({ action: 'previous-artboard', properties: {} })
      else warn(`Prototype action requires reconnecting in Adobe XD: ${interaction.action}`)
    }
  entries.push(
    jsonEntry('interactions/interactions.json', {
      version: '0.24',
      interactions,
    }),
  )
  entries.push({
    path: 'META-INF/metadata.xml',
    data: Buffer.from(
      '<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
    ),
  })
  const previewSource =
    selected[0].canvasPreview ??
    selected[0].thumbnail ??
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0cAAAAASUVORK5CYII='
  const previewMatch = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(previewSource ?? '')
  const previewComponents: Agc[] = []
  if (previewMatch) {
    const data = Buffer.from(previewMatch[2], 'base64'),
      size = imageSize(data)
    const path = previewMatch[1] === 'image/png' ? 'preview.png' : 'preview.jpg'
    entries.push({ path, data })
    const thumbPath = previewMatch[1] === 'image/png' ? 'thumbnail.png' : 'thumbnail.jpg'
    entries.push({ path: thumbPath, data })
    previewComponents.push({
      ...component(thumbPath, previewMatch[1]),
      rel: 'thumbnail',
      width: size.width,
      height: size.height,
    })
    previewComponents.push({
      ...component(path, previewMatch[1]),
      rel: 'preview',
      width: size.width,
      height: size.height,
    })
  }
  entries.push(jsonEntry('sharing/sharing.json', { version: '0.3', selectedLink: -1 }))
  entries.push(
    jsonEntry('manifest', {
      'manifest-format-version': 6,
      type: 'application/vnd.adobe.sparkler.project+dcx',
      id: randomUUID(),
      name: request.document.name,
      state: 'unmodified',
      'uxdesign#id': randomUUID(),
      'uxdesign#version': '2.27',
      'uxdesign#serializationId': randomUUID(),
      components: [
        {
          ...component('META-INF/metadata.xml', 'application/rdf+xml'),
          rel: 'metadata',
          name: 'xmp-metadata',
        },
        ...previewComponents,
      ],
      children: [
        folder('artwork', artwork),
        folder(
          'resources',
          [
            folder(
              'graphics',
              [],
              [component('graphicContent.agc', 'application/vnd.adobe.agc.graphicsTree+json')],
            ),
          ],
          resourceComponents,
        ),
        folder(
          'interactions',
          [],
          [component('interactions.json', 'application/vnd.adobe.uxdesign.interactions+json')],
        ),
      ],
    }),
  )
  entries.push(
    jsonEntry('frameui/design.json', {
      pages,
      components: read('components.json'),
    }),
  )
  entries.push(
    jsonEntry('frameui/compatibility.json', {
      ...report,
      prototype: request.includePrototype ? request.document.prototype : undefined,
    }),
  )
  validateXdEntries(entries)
  return { entries, report }
}

/** Checks manifest paths, native mimetype, scenegraph identity and resource references. Not an XD runtime validator. */
export function validateXdEntries(entries: StoredZipEntry[]) {
  const files = new Map(entries.map((e) => [e.path, e.data]))
  if (files.size !== entries.length) throw new Error('Duplicate XD archive entry.')
  if (entries[0]?.path !== 'mimetype' || files.get('mimetype')?.toString() !== MIME)
    throw new Error('Invalid XD mimetype.')
  const required = [
    'manifest',
    'resources/graphics/graphicContent.agc',
    'artwork/pasteboard/graphics/graphicContent.agc',
    'interactions/interactions.json',
    'META-INF/metadata.xml',
  ]
  for (const path of required)
    if (!files.has(path)) throw new Error(`XD archive is missing ${path}`)
  const manifest = JSON.parse(files.get('manifest')!.toString())
  if (manifest['manifest-format-version'] !== 6) throw new Error('Unsupported XD manifest version.')
  const walk = (value: Agc, base = '') => {
    for (const c of (value.components ?? []) as Agc[])
      if (!files.has(base + String(c.path)))
        throw new Error(`Missing XD manifest resource: ${base}${c.path}`)
    for (const child of (value.children ?? []) as Agc[]) walk(child, base + child.path + '/')
  }
  walk(manifest)
  const resources = JSON.parse(files.get('resources/graphics/graphicContent.agc')!.toString())
  const identities = new Set<string>()
  const inspect = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(inspect)
      return
    }
    if (!v || typeof v !== 'object') return
    const value = v as Agc
    if (
      value.type === 'group' &&
      Array.isArray((value.style as Agc | undefined)?.filters) &&
      ((value.style as Agc).filters as unknown[]).length
    )
      throw new Error('XD Group cannot carry GraphicNode filters.')
    if (typeof value.id === 'string' && typeof value.type === 'string') {
      if (identities.has(value.id)) throw new Error(`Duplicate XD scene identity: ${value.id}`)
      identities.add(value.id)
    }
    if (
      typeof value.href === 'string' &&
      value.href.startsWith('/resources/') &&
      !files.has(value.href.slice(1))
    )
      throw new Error(`Missing XD resource: ${value.href}`)
    if (value.type === 'pattern') {
      const pattern = value.pattern as Agc | undefined,
        ux = (pattern?.meta as Agc | undefined)?.ux as Agc | undefined
      if (ux?.uid && !files.has('resources/' + ux.uid))
        throw new Error(`Missing XD image resource: ${ux.uid}`)
    }
    if (value.clipPath && typeof value.clipPath === 'object') {
      const ref = (value.clipPath as Agc).ref
      if (ref && !resources.resources.clipPaths[String(ref)])
        throw new Error(`Missing XD clipping resource: ${ref}`)
    }
    if (value.type === 'gradient') {
      const ref = (value.gradient as Agc | undefined)?.ref
      if (ref && !resources.resources.gradients[String(ref)])
        throw new Error(`Missing XD gradient: ${ref}`)
    }
    Object.values(value).forEach(inspect)
  }
  for (const [path, data] of files)
    if (path.endsWith('graphicContent.agc')) inspect(JSON.parse(data.toString()))
  const symbolIds = new Set(
    (resources.resources.meta.ux.symbols as Agc[]).map(
      (symbol) => ((symbol.meta as Agc).ux as Agc).symbolId,
    ),
  )
  const validateLinks = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) {
      v.forEach(validateLinks)
      return
    }
    const value = v as Agc
    if (value.type === 'syncRef' && !identities.has(String(value.syncSourceGuid)))
      throw new Error(`Missing XD component source: ${value.syncSourceGuid}`)
    const ux = (value.meta as Agc | undefined)?.ux as Agc | undefined
    if (ux?.symbolId && !symbolIds.has(ux.symbolId))
      throw new Error(`Missing XD component definition: ${ux.symbolId}`)
    Object.values(value).forEach(validateLinks)
  }
  for (const [path, data] of files)
    if (path.endsWith('graphicContent.agc')) validateLinks(JSON.parse(data.toString()))
  const interactions = JSON.parse(
    files.get('interactions/interactions.json')!.toString(),
  ).interactions
  for (const [source, actions] of Object.entries(interactions)) {
    if (!identities.has(source)) throw new Error(`Missing XD interaction source: ${source}`)
    for (const action of actions as Agc[]) {
      const destination = (action.properties as Agc | undefined)?.destination
      if (destination && !resources.artboards[String(destination)])
        throw new Error(`Missing XD interaction destination: ${destination}`)
    }
  }

  for (const [id, bounds] of Object.entries(resources.artboards)) {
    const scene = files.get(`artwork/artboard-${id}/graphics/graphicContent.agc`)
    if (!scene) throw new Error(`Missing XD artboard ${id}`)
    const data = JSON.parse(scene.toString())
    if (data.children[0]?.id !== id || data.children[0]?.artboard?.ref !== id)
      throw new Error('Invalid XD artboard reference.')
    if (!bounds || typeof bounds !== 'object') throw new Error('Invalid XD artboard bounds.')
  }
}

/** Re-read exactly what will be saved, including CRCs and central directory bounds. */
export function validateXdArchive(archive: Buffer): void {
  const entries: StoredZipEntry[] = []
  let offset = 0
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8),
      size = archive.readUInt32LE(offset + 18)
    const nameLength = archive.readUInt16LE(offset + 26),
      extraLength = archive.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLength + extraLength,
      end = start + size
    if (method !== 0 || end > archive.length) throw new Error('Invalid stored XD archive entry.')
    const path = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const data = archive.subarray(start, end)
    if (crc32(data) !== archive.readUInt32LE(offset + 14))
      throw new Error(`XD archive checksum failed: ${path}`)
    entries.push({ path, data })
    offset = end
  }
  const end = archive.length - 22
  if (
    end < 0 ||
    archive.readUInt32LE(end) !== 0x06054b50 ||
    archive.readUInt32LE(end + 16) !== offset ||
    archive.readUInt16LE(end + 10) !== entries.length
  )
    throw new Error('Invalid XD central directory.')
  const centralSize = archive.readUInt32LE(end + 12)
  if (offset + centralSize !== end) throw new Error('Invalid XD archive bounds.')
  validateXdEntries(entries)
}
