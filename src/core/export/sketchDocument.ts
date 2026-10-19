import { createHash } from 'node:crypto'
import type Sketch from '@sketch-hq/sketch-file-format-ts'
import schemas from '@sketch-hq/sketch-file-format'
import Ajv from 'ajv'
import { imageSize } from 'image-size'
import { resolveExportFont, type ExportFontFace } from './sketchFonts'
import { buildFrameUiPackage } from './frameuiPackage'
import { svgDefinitionMap, expandSvgResource } from './sketchSvgResources'
import type { SvgDefinition } from '../capture-compiler/svgDefinitions'
import { geometryPath, pathContours } from './sketchGeometry'
import { color, context, style } from './sketchStyles'
import type { FrameUiExportNode, FrameUiExportPage } from '@shared/types/frameuiExport'
import type { SketchExportRequest, SketchExportReport } from '@shared/types/sketchExport'
import type { StoredZipEntry } from '../../main/export/storedZip'

type Layer = Sketch.Artboard['layers'][number]
export const exportId = (value: string) => {
  const h = createHash('sha256').update(value).digest('hex').slice(0, 32).toUpperCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const rect = (x: number, y: number, width: number, height: number): Sketch.Rect => ({
  _class: 'rect',
  x,
  y,
  width,
  height,
  constrainProportions: false,
})
const ruler = (): Sketch.RulerData => ({ _class: 'rulerData', base: 0, guides: [] })
const validators = (() => {
  const ajv = new Ajv({ strict: false, allErrors: false, unicodeRegExp: false })
  return {
    page: ajv.compile(schemas.page),
    document: ajv.compile(schemas.document),
    meta: ajv.compile(schemas.meta),
    user: ajv.compile(schemas.user),
  }
})()
export function validateSketchDocuments(documents: {
  page: Sketch.Page
  document: Sketch.Document
  meta: Sketch.Meta
  user: Sketch.User
}): void {
  for (const key of ['page', 'document', 'meta', 'user'] as const)
    if (!validators[key](documents[key]))
      throw new Error(`Sketch ${key} validation failed: ${JSON.stringify(validators[key].errors)}`)
}
export function buildSketchDocument(
  request: SketchExportRequest,
  progress: (stage: string) => void = () => {},
  fonts: ExportFontFace[] = [],
): { entries: StoredZipEntry[]; report: SketchExportReport } {
  progress('Reading saved design')
  const source = request.document
  const flow =
    request.scope === 'flow'
      ? source.prototype?.flows.find((f) => f.id === request.flowId)
      : undefined
  if (request.scope === 'flow' && !flow) throw new Error('Choose an existing prototype flow.')
  const selected =
    request.scope === 'artboard'
      ? source.pages.filter((p) => p.id === request.pageId)
      : flow
        ? source.pages.filter((p) => flow.artboardIds.includes(p.id))
        : source.pages
  if (!selected.length) throw new Error('There are no artboards in this export.')
  const doc = { ...source, pages: selected }
  const built = buildFrameUiPackage({
    documents: [doc],
    activeDocumentId: doc.id,
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
  if (built.warnings.some((w) => w.severity === 'error'))
    throw new Error(
      built.warnings
        .filter((w) => w.severity === 'error')
        .map((w) => w.message)
        .join('\n'),
    )
  const masters = (
    JSON.parse(built.files.find((f) => f.path === 'components.json')!.content) as {
      components: FrameUiExportNode[]
    }
  ).components
  const pages = (
    JSON.parse(built.files.find((f) => f.path === 'document.json')!.content) as {
      pages: FrameUiExportPage[]
    }
  ).pages
  const report: SketchExportReport = {
    format: 'sketch',
    schemaVersion: 121,
    structuralValidation: 'passed',
    xdValidation: 'unverified',
    artboards: pages.length,
    layers: 0,
    editableText: 0,
    editableVectors: 0,
    images: 0,
    groups: 0,
    components: 0,
    fallbackEffects: 0,
    unconvertedInteractions: 0,
    unsupportedFeatures: 0,
    missingAssets: 0,
    failedElements: 0,
    fontCheck: fonts.length ? 'local' : 'unverified',
    missingFonts: [],
    fontsToCheck: [],
    warnings: [],
    idMap: {},
  }
  report.warnings.push(
    ...built.warnings.map((w) => ({ code: w.code, message: w.message, layerId: w.nodeId })),
  )
  const entries: StoredZipEntry[] = []
  const imageRefs = new Map<string, Sketch.FileRef>()
  const assetFiles = new Map(built.files.map((f) => [f.path, f]))
  const assets = (
    JSON.parse(built.files.find((f) => f.path === 'assets.json')!.content) as {
      assets: { id: string; path: string; mimeType: string }[]
    }
  ).assets
  for (const asset of assets) {
    const file = assetFiles.get(asset.path)
    if (!file) continue
    const data = Buffer.from(file.content, 'base64')
    const name = 'images/' + createHash('sha256').update(data).digest('hex')
    if (!entries.some((e) => e.path === name)) entries.push({ path: name, data })
    imageRefs.set(asset.id, {
      _class: 'MSJSONFileReference',
      _ref_class: 'MSImageData',
      _ref: name,
    })
  }
  const pageId = exportId(doc.id + ':page')
  const artboardIds = new Map(pages.map((p) => [p.id, exportId(p.root.id)]))
  let currentArtboard = ''
  const warning = (n: FrameUiExportNode, code: string, message: string) =>
    report.warnings.push({
      code,
      message,
      artboard: currentArtboard,
      layerId: n.id,
      layerName: n.name,
    })
  const base = (n: FrameUiExportNode, suffix = '') => {
    const id = exportId(doc.id + ':' + n.id + suffix)
    if (!suffix) report.idMap[n.id] = id
    return {
      do_objectID: id,
      booleanOperation: -1 as const,
      exportOptions: {
        _class: 'exportOptions' as const,
        exportFormats: [],
        includedLayerIds: [],
        layerOptions: 0,
        shouldTrim: false,
      },
      frame: rect(n.x, n.y, n.width, n.height),
      isFixedToViewport: false,
      isFlippedHorizontal: false,
      isFlippedVertical: false,
      isLocked: n.locked,
      isTemplate: false,
      isVisible: n.visible,
      layerListExpandedType: 0 as const,
      name: n.name,
      nameIsFixed: false,
      resizingConstraint: 63,
      resizingType: 0 as const,
      rotation: -n.rotation,
      shouldBreakMaskChain: false,
      userInfo: {
        'com.frameui.export': {
          sourceId: n.id,
          component: n.component,
          source: n.source,
          text: n.text,
          appearance: n.captureAppearance,
        },
      },
    }
  }
  const rectangle = (n: FrameUiExportNode, suffix = '', paint = true): Sketch.Rectangle => ({
    ...base(n, suffix),
    _class: 'rectangle',
    edited: false,
    isClosed: true,
    pointRadiusBehaviour: 1,
    fixedRadius: 0,
    hasConvertedToNewRoundCorners: true,
    needsConvertionToNewRoundCorners: false,
    points: pathContours(`M0 0H${n.width}V${n.height}H0Z`, n.width, n.height)[0].points.map(
      (p, i) => ({ ...p, cornerRadius: n.radius[i] }),
    ),
    style: paint
      ? style(n, exportId(doc.id + n.id + suffix + ':style'), (c, m) => warning(n, c, m))
      : undefined,
  })
  const convert = (
    n: FrameUiExportNode,
    svg?: { w: number; h: number; transform: string; definitions?: Map<string, SvgDefinition> },
    ancestors = new Set<string>(),
  ): Layer => {
    if (n.component && !n.children.length) {
      const master = masters.find((m) => m.id === n.component!.componentId)
      if (master) {
        if (ancestors.has(master.id))
          warning(n, 'component-cycle', 'Circular component reference was not expanded.')
        else {
          ancestors = new Set([...ancestors, master.id])
          const sx = master.width ? n.width / master.width : 1,
            sy = master.height ? n.height / master.height : 1
          const copy = (child: FrameUiExportNode): FrameUiExportNode => ({
            ...child,
            id: n.id + ':' + child.id,
            x: child.x * sx,
            y: child.y * sy,
            width: child.width * sx,
            height: child.height * sy,
            children: child.children.map(copy),
          })
          n = { ...n, children: master.children.map(copy) }
          if (sx !== 1 || sy !== 1)
            warning(
              n,
              'component-resize',
              'Component expanded at instance dimensions; verify its constraints.',
            )
        }
      } else
        warning(
          n,
          'missing-component',
          'Component master is unavailable; only saved instance layers can be exported.',
        )
    }

    report.layers++
    const b = base(n)
    if (svg) b.frame = rect(0, 0, svg.w, svg.h)
    const warn = (c: string, m: string) => warning(n, c, m)
    const s = style(n, exportId(doc.id + n.id + ':style'), warn)
    if (n.captureAppearance) {
      const a = n.captureAppearance
      for (const k of [
        'transform',
        'clipPath',
        'maskImage',
        'backdropFilter',
        'mixBlendMode',
        'backgroundBlendMode',
      ] as const)
        if (a[k] && a[k] !== 'none' && a[k] !== 'normal')
          warn(
            'unsupported-' + k,
            `${k} requires review; its source value is retained in the companion manifest.`,
          )
      if (a.filter && a.filter !== 'none' && !/^blur\(/.test(a.filter))
        warn('css-filter', 'CSS filter requires review.')
      if (a.clipX !== a.clipY && (a.clipX || a.clipY))
        warn('axis-clipping', 'One-axis clipping uses rectangular clipping in the export.')
    }
    if (n.component) {
      report.components++
      warn(
        'component-expanded',
        'Component exported as editable layers; reusable master/instance relationship is retained as metadata.',
      )
    }
    if (n.text && !n.control) {
      const t = n.text
      if (t.captureLines?.length) {
        report.groups++
        warning(
          n,
          'captured-text-lines',
          'Measured browser line fragments are separate editable text layers to preserve their positions.',
        )
        return {
          ...b,
          _class: 'group',
          hasClickThrough: false,
          layers: t.captureLines.map((line, i) =>
            convert(
              {
                ...n,
                id: n.id + ':line:' + i,
                name: n.name + ' · line ' + (i + 1),
                x: line.x,
                y: line.y,
                width: line.width,
                height: line.height,
                rotation: 0,
                opacity: 1,
                text: { ...t, captureLines: undefined, characters: line.text },
                effects: [],
              },
              undefined,
              ancestors,
            ),
          ),
          style: { ...s, fills: [], borders: [] },
        }
      }
      report.editableText++
      const family = t.fontFamily.split(',')[0].replace(/["']/g, '').trim()
      if (!report.fontsToCheck.includes(family)) report.fontsToCheck.push(family)
      const missing = family + ' ' + t.fontWeight + ' ' + t.fontStyle
      if (
        fonts.length &&
        !resolveExportFont(fonts, family, t.fontWeight, t.fontStyle) &&
        !report.missingFonts.includes(missing)
      )
        report.missingFonts.push(missing)
      warn(
        'font-check',
        `Check ${family} ${t.fontWeight} ${t.fontStyle} in Adobe XD. Fonts are referenced, never embedded.`,
      )
      if (t.decoration && t.decoration !== 'none')
        warn(
          'text-decoration',
          'Text decoration needs target review; its source definition is retained.',
        )
      if (t.lineHeight || t.letterSpacing)
        warn(
          'xd-text-metrics',
          'Sketch preserves text metrics; Adobe XD may ignore custom line height or character spacing.',
        )
      const attr = (
        weight = t.fontWeight,
        overrideColor?: string,
      ): Sketch.StringAttribute['attributes'] => ({
        MSAttributedStringFontAttribute: {
          _class: 'fontDescriptor',
          attributes: {
            name: resolveExportFont(fonts, family, weight, t.fontStyle) ?? family,
            size: t.fontSize,
          },
        },
        MSAttributedStringColorAttribute: color(
          overrideColor ??
            t.color ??
            (n.fills.find((p) => p.type === 'SOLID') as { color?: string } | undefined)?.color ??
            '#111111',
        ),
        kerning: t.letterSpacing,
        paragraphStyle: {
          _class: 'paragraphStyle',
          alignment:
            ({ left: 0, right: 1, center: 2, justify: 3 } as const)[t.alignment as 'left'] ?? 0,
          minimumLineHeight: t.lineHeight,
          maximumLineHeight: t.lineHeight,
        },
      })
      // Preserve range boundaries as non-overlapping UTF-16 attribute spans.
      const breaks = [
        ...new Set([
          0,
          t.characters.length,
          ...(t.runs ?? []).flatMap((r) => [
            Math.max(0, r.start),
            Math.min(t.characters.length, r.end),
          ]),
        ]),
      ]
        .filter((x) => x >= 0 && x <= t.characters.length)
        .sort((a, b) => a - b)
      const attributes = breaks.slice(0, -1).map((start, i) => {
        const run = t.runs?.find((r) => r.start <= start && r.end >= breaks[i + 1])
        return {
          _class: 'stringAttribute' as const,
          location: start,
          length: breaks[i + 1] - start,
          attributes: attr(run?.fontWeight, run?.color),
        }
      })
      s.textStyle = { _class: 'textStyle', verticalAlignment: 0, encodedAttributes: attr() }
      if (!resolveExportFont(fonts, family, t.fontWeight, t.fontStyle))
        warn(
          'font-weight',
          `Verify the ${t.fontWeight} font face; the document retains the requested weight in metadata.`,
        )
      return {
        ...b,
        _class: 'text',
        style: s,
        attributedString: { _class: 'attributedString', string: t.characters, attributes },
        automaticallyDrawOnUnderlyingPath: false,
        dontSynchroniseWithSymbol: false,
        lineSpacingBehaviour: 2,
        textBehaviour: 1,
        glyphBounds: `{{0, 0}, {${n.width}, ${n.height}}}`,
      }
    }
    if (n.image) {
      const ref = imageRefs.get(n.image.assetId)
      if (!ref) {
        warn('missing-image', 'Original image is unavailable.')
        return rectangle(n)
      }
      report.images++
      const asset = assets.find((a) => a.id === n.image!.assetId)
      if (asset && !['image/png', 'image/jpeg'].includes(asset.mimeType))
        warn(
          'image-format',
          `${asset.mimeType} is embedded unchanged; target decoding must be checked.`,
        )
      const bitmap: Sketch.Bitmap = {
        ...b,
        _class: 'bitmap',
        style: s,
        fillReplacesImage: false,
        image: ref,
        intendedDPI: 72,
        clippingMask: '{{0, 0}, {1, 0}, {1, 1}, {0, 1}}',
      }
      if (n.image.fit !== 'FILL')
        try {
          const data = entries.find((e) => e.path === ref._ref)!.data
          const size = imageSize(data)
          const ratio =
            n.image.fit === 'COVER'
              ? Math.max(n.width / size.width, n.height / size.height)
              : Math.min(n.width / size.width, n.height / size.height)
          const w = size.width * ratio,
            h = size.height * ratio
          const pos = (n.captureAppearance?.objectPosition ?? '50% 50%').split(/\s+/)
          const offset = (v: string | undefined, space: number) =>
            v?.endsWith('%')
              ? (space * parseFloat(v)) / 100
              : v?.endsWith('px')
                ? parseFloat(v)
                : space / 2
          bitmap.do_objectID = exportId(doc.id + n.id + ':bitmap')
          bitmap.frame = rect(offset(pos[0], n.width - w), offset(pos[1], n.height - h), w, h)
          bitmap.rotation = 0
          bitmap.style = { ...s, contextSettings: context() }
          const mask = rectangle({ ...n, x: 0, y: 0 }, ':image-clip', false)
          mask.hasClippingMask = true
          mask.clippingMaskMode = 0
          report.groups++
          return {
            ...b,
            _class: 'group',
            hasClickThrough: false,
            layers: [mask, bitmap],
            style: { ...s, fills: [], borders: [] },
          }
        } catch {
          warn('image-fit', 'Image dimensions could not be read; verify its crop in Adobe XD.')
        }
      return bitmap
    }
    const geo = n.vector?.geometry ?? {}
    let localSvg = svg
    if (n.vector?.tag === 'svg') {
      const vb = (n.vector.viewBox ?? `0 0 ${n.width} ${n.height}`).split(/[ ,]+/).map(Number)
      const scale = Math.min(n.width / (vb[2] || n.width || 1), n.height / (vb[3] || n.height || 1))
      localSvg = {
        w: n.width,
        h: n.height,
        definitions: svgDefinitionMap(geo.definitions),
        transform: `translate(${(n.width - vb[2] * scale) / 2} ${(n.height - vb[3] * scale) / 2}) scale(${scale}) translate(${-vb[0]} ${-vb[1]})`,
      }
    }
    if (n.vector?.tag === 'use') {
      const href = geo.href ?? geo['xlink:href']
      const ref = href?.startsWith('#') ? href.slice(1) : undefined
      const resource = ref ? svg?.definitions?.get(ref) : undefined
      if (resource && ref && !ancestors.has('svg:' + ref)) {
        const vb = (resource.attributes.viewBox ?? '').split(/[ ,]+/).map(Number),
          w = Number(geo.width) || n.width,
          h = Number(geo.height) || n.height
        let placement = 'translate(' + (Number(geo.x) || 0) + ' ' + (Number(geo.y) || 0) + ')'
        if (vb.length === 4 && vb.every(Number.isFinite)) {
          const scale = Math.min(w / (vb[2] || 1), h / (vb[3] || 1))
          placement +=
            ' translate(' +
            (w - vb[2] * scale) / 2 +
            ' ' +
            (h - vb[3] * scale) / 2 +
            ') scale(' +
            scale +
            ') translate(' +
            -vb[0] +
            ' ' +
            -vb[1] +
            ')'
        }
        const ctx = svg ? { ...svg, transform: svg.transform + ' ' + placement } : undefined
        report.groups++
        return {
          ...b,
          _class: 'group',
          hasClickThrough: false,
          frame: svg ? rect(0, 0, svg.w, svg.h) : b.frame,
          layers: expandSvgResource(n, resource).map((child) =>
            convert(child, ctx, new Set([...ancestors, 'svg:' + ref])),
          ),
          style: { ...s, fills: [], borders: [] },
        }
      }
      warn(
        'svg-reference',
        'Referenced SVG symbol is unavailable or circular; reconnect its source geometry.',
      )
    }
    const path =
      n.vector?.path ??
      geometryPath(n.vector?.tag ?? '', geo, n.width, n.height) ??
      (n.type === 'LINE'
        ? `M0 0L${n.width} ${n.height}`
        : n.type === 'ELLIPSE'
          ? geometryPath(
              'ellipse',
              {
                cx: String(n.width / 2),
                cy: String(n.height / 2),
                rx: String(n.width / 2),
                ry: String(n.height / 2),
              },
              n.width,
              n.height,
            )
          : undefined)
    if (path) {
      try {
        const w = svg?.w ?? n.width,
          h = svg?.h ?? n.height
        const contours = pathContours(path, w, h, `${svg?.transform ?? ''} ${geo.transform ?? ''}`)
        report.editableVectors += contours.length
        s.windingRule = geo['fill-rule'] === 'evenodd' ? 0 : 1
        const layers = contours.map((c, i): Sketch.ShapePath => ({
          ...b,
          do_objectID: i ? exportId(doc.id + n.id + ':contour:' + i) : b.do_objectID,
          _class: 'shapePath',
          frame: svg ? rect(0, 0, w, h) : b.frame,
          style: s,
          edited: true,
          isClosed: c.closed,
          pointRadiusBehaviour: 1,
          points: c.points,
        }))
        if (layers.length === 1) return layers[0]
        // Compound subpaths share one style to preserve fill holes.
        return {
          ...b,
          _class: 'shapeGroup',
          windingRule: s.windingRule,
          style: s,
          frame: svg ? rect(0, 0, w, h) : b.frame,
          layers: layers.map((l, i) => ({
            ...l,
            do_objectID: exportId(doc.id + n.id + ':compound:' + i),
            frame: rect(0, 0, w, h),
            rotation: 0,
            style: undefined,
          })),
          hasClippingMask: false,
          clippingMaskMode: 0,
          hasClickThrough: false,
        }
      } catch (e) {
        warn('invalid-vector', `Vector conversion failed: ${String(e)}`)
      }
    }
    const childSvg = localSvg
      ? { ...localSvg, transform: `${localSvg.transform} ${geo.transform ?? ''}` }
      : undefined
    const children = n.children.map((child) => convert(child, childSvg, ancestors))
    if (n.control) {
      const control = n.control
      if (['checkbox', 'radio', 'range'].includes(control.type))
        warn('native-control', 'Control appearance requires target review.')
      else {
        const text =
          control.type === 'password'
            ? control.value
              ? '••••••••'
              : (control.placeholder ?? '')
            : control.value || control.placeholder || ''
        if (text) {
          const p = n.layout.padding
          const textNode: FrameUiExportNode = {
            ...n,
            id: n.id + ':control-text',
            name: n.name + ' text',
            type: 'TEXT',
            x: p.left,
            y: p.top,
            width: Math.max(0, n.width - p.left - p.right),
            height: Math.max(0, n.height - p.top - p.bottom),
            children: [],
            childIds: [],
            control: undefined,
            captureAppearance: undefined,
            fills: [{ type: 'SOLID', color: n.text?.color ?? '#64748b', opacity: 1 }],
            strokes: [],
            effects: [],
            text: {
              characters: text,
              fontFamily: n.text?.fontFamily ?? 'Arial',
              fontStyle: n.text?.fontStyle ?? 'Regular',
              fontWeight: n.text?.fontWeight ?? '400',
              fontSize: n.text?.fontSize ?? 16,
              lineHeight: n.text?.lineHeight ?? 24,
              letterSpacing: n.text?.letterSpacing ?? 0,
              alignment: n.text?.alignment ?? 'left',
            },
          }
          children.push(convert(textNode))
          warn('control-text', 'Control text remains editable; verify native control typography.')
        }
      }
    }
    if (children.length || n.type === 'GROUP' || n.component) {
      report.groups++
      const layers: Layer[] = []
      if (!n.vector && (n.fills.length || n.strokes.length))
        layers.push({
          ...rectangle({ ...n, x: 0, y: 0, opacity: 1 }, ':background'),
          name: n.name + ' background',
        })
      if (n.clipContent) {
        const mask = rectangle({ ...n, x: 0, y: 0, opacity: 1 }, ':clip', false)
        mask.hasClippingMask = true
        mask.clippingMaskMode = 0
        layers.push(mask)
      }
      layers.push(...children)
      const groupStyle = { ...s, fills: [], borders: [] }
      if (s.shadows?.length) warn('xd-group-shadow', 'Adobe XD may omit group shadows.')
      return {
        ...b,
        _class: 'group',
        style: groupStyle,
        layers,
        hasClickThrough: false,
        groupLayout: { _class: 'MSImmutableFreeformGroupLayout' },
      }
    }
    if (n.vector && !path)
      warn(
        'unsupported-vector',
        'Vector has no supported path geometry; retained as an editable shape with source metadata.',
      )
    report.editableVectors++
    return rectangle(n)
  }
  progress('Converting editable artboards, text and vectors')
  let offset = 0
  const artboards: Sketch.Artboard[] = pages.map((p) => {
    currentArtboard = p.name
    const original = selected.find((s) => s.id === p.id)!
    const root = p.root
    const b = base(root)
    const start = (doc.prototype?.flows ?? []).some((f) => f.startArtboardId === p.id)
    const art: Sketch.Artboard = {
      ...b,
      do_objectID: artboardIds.get(p.id)!,
      _class: 'artboard',
      frame: rect(original.canvasX ?? offset, original.canvasY ?? 0, p.width, p.height),
      backgroundColor: color('white'),
      hasBackgroundColor: true,
      includeBackgroundColorInExport: true,
      isFlowHome: start,
      hasClickThrough: false,
      resizesContent: false,
      horizontalRulerData: ruler(),
      verticalRulerData: ruler(),
      layers: root.children.map((n) => convert(n)),
    }
    report.idMap[p.id] = art.do_objectID
    report.idMap[root.id] = art.do_objectID
    offset += p.width + 120
    return art
  })
  progress('Preparing prototype metadata')
  const legacy: NonNullable<typeof doc.prototype>['interactions'] = []
  const scanLegacy = (nodes: (typeof doc.pages)[number]['objects'], pageId: string) => {
    for (const node of nodes) {
      if (node.interaction)
        legacy.push({
          id: 'legacy-' + node.id,
          sourceArtboardId: pageId,
          sourceElementId: node.id,
          trigger: node.interaction.trigger === 'Click' ? 'click' : 'hover',
          action: 'navigate',
          destinationId: node.interaction.targetPageId,
          transition:
            node.interaction.transition === 'Instant'
              ? 'instant'
              : node.interaction.transition === 'Dissolve'
                ? 'fade'
                : 'slide',
        })
      scanLegacy(node.children, pageId)
    }
  }
  doc.pages.forEach((p) => scanLegacy(p.objects, p.id))
  const interactions = request.includePrototype
    ? [...(doc.prototype?.interactions ?? []), ...legacy].filter((i) =>
        selected.some((p) => p.id === i.sourceArtboardId),
      )
    : []
  for (const i of interactions) {
    const art = artboards[pages.findIndex((p) => p.id === i.sourceArtboardId)]
    const find = (layers: Layer[]): Layer | undefined => {
      for (const l of layers) {
        if (l.do_objectID === report.idMap[i.sourceElementId ?? '']) return l
        if ('layers' in l) {
          const nested = find(l.layers)
          if (nested) return nested
        }
      }
    }
    const layer = i.sourceElementId ? find(art.layers) : undefined
    const dest = i.destinationId ? artboardIds.get(i.destinationId) : undefined
    if (i.trigger === 'click' && i.action === 'navigate' && dest && layer && !layer.flow) {
      layer.flow = {
        _class: 'MSImmutableFlowConnection',
        destinationArtboardID: dest,
        animationType: 0,
      }
      if (i.transition !== 'instant')
        report.warnings.push({
          code: 'prototype-transition',
          artboard: art.name,
          layerId: i.sourceElementId,
          message: `Reconnect the ${i.transition} transition in Adobe XD; the navigation wire uses an instant transition.`,
        })
      report.warnings.push({
        code: 'prototype-unverified',
        artboard: art.name,
        layerId: i.sourceElementId,
        message: 'Navigation wire written to Sketch; verify it in Adobe XD.',
      })
    } else {
      report.unconvertedInteractions++
      report.warnings.push({
        code: 'prototype-manual',
        artboard: art.name,
        layerId: i.sourceElementId,
        message: `Reconnect ${i.trigger} → ${i.action} in Adobe XD. Definition is included in the companion manifest.`,
      })
    }
  }
  const page: Sketch.Page = {
    ...base({ ...pages[0].root, id: doc.id + ':page', name: doc.name, x: 0, y: 0 }),
    _class: 'page',
    do_objectID: pageId,
    layers: artboards,
    hasClickThrough: false,
    horizontalRulerData: ruler(),
    verticalRulerData: ruler(),
  }
  const document: Sketch.Document = {
    _class: 'document',
    do_objectID: exportId(doc.id),
    assets: {
      _class: 'assetCollection',
      do_objectID: exportId(doc.id + ':assets'),
      colorAssets: [],
      gradientAssets: [],
      images: [],
      colors: [],
      gradients: [],
      exportPresets: [],
    },
    colorSpace: 1,
    currentPageIndex: 0,
    foreignLayerStyles: [],
    foreignSymbols: [],
    foreignTextStyles: [],
    layerStyles: { _class: 'sharedStyleContainer', objects: [] },
    layerTextStyles: { _class: 'sharedTextStyleContainer', objects: [] },
    pages: [
      { _class: 'MSJSONFileReference', _ref_class: 'MSImmutablePage', _ref: 'pages/' + pageId },
    ],
    perDocumentLibraries: [],
  }
  const created: Sketch.Meta['created'] = {
    commit: '',
    appVersion: '80',
    build: 1,
    app: 'com.bohemiancoding.sketch3' as Sketch.BundleId,
    compatibilityVersion: 99,
    version: 121,
    variant: 'NONAPPSTORE',
  }
  const meta: Sketch.Meta = {
    ...created,
    version: 121,
    compatibilityVersion: 99,
    created,
    autosaved: 0,
    saveHistory: [],
    pagesAndArtboards: {
      [pageId]: {
        name: doc.name,
        artboards: Object.fromEntries(artboards.map((a) => [a.do_objectID, { name: a.name }])),
      },
    },
  }
  const user: Sketch.User = { document: { pageListHeight: 0, pageListCollapsed: 0 } }
  progress('Validating against official Sketch schemas')
  validateSketchDocuments({ page, document, meta, user })
  const ids = new Set<string>()
  const check = (layers: Sketch.Page['layers']) => {
    for (const layer of layers) {
      if (ids.has(layer.do_objectID)) throw new Error('Duplicate exported layer ID: ' + layer.name)
      ids.add(layer.do_objectID)
      if (
        ![layer.frame.x, layer.frame.y, layer.frame.width, layer.frame.height].every(
          Number.isFinite,
        )
      )
        throw new Error('Invalid geometry: ' + layer.name)
      if ('layers' in layer) check(layer.layers)
    }
  }
  check(page.layers)
  for (const ref of imageRefs.values())
    if (!entries.some((e) => e.path === ref._ref)) throw new Error('Missing embedded image')
  report.unsupportedFeatures = report.warnings.filter((w) =>
    /unsupported|effect|filter|fill|border|shadow|decoration/.test(w.code),
  ).length
  report.missingAssets = report.warnings.filter((w) => w.code === 'missing-image').length
  report.failedElements = report.warnings.filter((w) => w.code === 'invalid-vector').length
  for (const [name, value] of Object.entries({
    'document.json': document,
    'meta.json': meta,
    'user.json': user,
    ['pages/' + pageId + '.json']: page,
    'frameui/compatibility.json': report,
    'frameui/prototype.json': request.includePrototype ? { ...doc.prototype, interactions } : {},
    'frameui/source-design.json': {
      pages,
      components: JSON.parse(built.files.find((f) => f.path === 'components.json')!.content),
      tokens: JSON.parse(built.files.find((f) => f.path === 'tokens.json')!.content),
    },
  }))
    entries.push({ path: name, data: Buffer.from(JSON.stringify(value)) })
  entries.push({
    path: 'frameui/README.txt',
    data: Buffer.from(
      'Open this .sketch document in Adobe XD, inspect the compatibility report, then Save As .xd. Native XD compatibility has not been verified. Fonts are not embedded. Prototype definitions and original unsupported properties are retained in frameui/.',
    ),
  })
  return { entries, report }
}
