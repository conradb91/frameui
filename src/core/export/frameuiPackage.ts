import type { StructuredNode } from '@shared/types/structuredDesign'
import type { DesignVariable, VisualDocument, VisualObject, VisualPage } from '@shared/types/visualDesign'
import type {
  FrameUiExportAsset,
  FrameUiExportFont,
  FrameUiExportManifest,
  FrameUiExportNode,
  FrameUiExportOptions,
  FrameUiExportPage,
  FrameUiExportTarget,
  FrameUiExportToken,
  FrameUiExportWarning,
  FrameUiNodeType,
  FrameUiPackageBuild,
  FrameUiPackageFile,
} from '@shared/types/frameuiExport'

export interface BuildFrameUiPackageInput {
  documents: VisualDocument[]
  activeDocumentId: string
  activePageId: string
  selectionIds: string[]
  structuredSelectionIds: string[]
  target: FrameUiExportTarget
  options: FrameUiExportOptions
  frameuiVersion: string
  exportedAt?: string
}

interface BuildContext {
  assets: FrameUiExportAsset[]
  assetFiles: FrameUiPackageFile[]
  warnings: FrameUiExportWarning[]
  assetByData: Map<string, string>
  options: FrameUiExportOptions
}

const visualType: Record<VisualObject['kind'], FrameUiNodeType> = {
  Frame: 'FRAME', Group: 'GROUP', Section: 'SECTION', Text: 'TEXT', Rectangle: 'RECTANGLE', Ellipse: 'ELLIPSE', Line: 'LINE', Polygon: 'VECTOR', Vector: 'VECTOR', Image: 'IMAGE', Icon: 'ICON', Component: 'COMPONENT', Instance: 'COMPONENT_INSTANCE', Button: 'FRAME', Input: 'FRAME', Select: 'FRAME', Checkbox: 'FRAME', Radio: 'ELLIPSE', Toggle: 'FRAME', Card: 'FRAME', Table: 'FRAME', Navigation: 'FRAME', Modal: 'FRAME', Badge: 'FRAME', Avatar: 'IMAGE',
}

function cleanName(value: string, fallback: string): string {
  return [...value.trim()].filter((character) => character.charCodeAt(0) >= 32).join('') || fallback
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function parseDataUri(value?: string): { mimeType: string; base64: string } | null {
  if (!value) return null
  const match = value.match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/)
  return match ? { mimeType: match[1].toLowerCase(), base64: match[2].replace(/\s/g, '') } : null
}

function imageExtension(mimeType: string): string {
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' } as Record<string, string>)[mimeType] ?? 'bin'
}

function registerImage(ctx: BuildContext, src: string | undefined, node: { id: string; name: string; width: number; height: number }): string | null {
  const parsed = parseDataUri(src)
  if (!parsed) {
    ctx.warnings.push({ code: 'missing-image', message: `${node.name} has no packaged source image.`, nodeId: node.id, severity: 'warning' })
    return null
  }
  const known = ctx.assetByData.get(src!)
  if (known) return known
  const id = `asset-${node.id}`
  const path = `assets/images/${id}.${imageExtension(parsed.mimeType)}`
  ctx.assets.push({ id, name: cleanName(node.name, 'Image'), kind: parsed.mimeType === 'image/svg+xml' ? 'VECTOR' : 'IMAGE', mimeType: parsed.mimeType, path, width: finite(node.width), height: finite(node.height) })
  ctx.assetFiles.push({ path, content: parsed.base64, encoding: 'base64' })
  ctx.assetByData.set(src!, id)
  return id
}

function paint(value: string | undefined, opacity = 1): FrameUiExportNode['fills'] {
  if (!value || value === 'none' || value === 'transparent') return []
  if (/gradient\(/i.test(value)) return [{ type: 'GRADIENT', value, opacity: finite(opacity, 1) }]
  return [{ type: 'SOLID', color: value, opacity: finite(opacity, 1) }]
}

function visualEffects(node: VisualObject, ctx: BuildContext): FrameUiExportNode['effects'] {
  const effects: FrameUiExportNode['effects'] = []
  if (node.shadow) effects.push({ type: /\binset\b/i.test(node.shadow) ? 'INNER_SHADOW' : 'DROP_SHADOW', value: node.shadow })
  if (node.blur) effects.push({ type: 'LAYER_BLUR', value: `${node.blur}px`, radius: node.blur })
  if (node.shadow && /filter\(|var\(/i.test(node.shadow)) {
    effects.push({ type: 'UNSUPPORTED', value: node.shadow })
    ctx.warnings.push({ code: 'unsupported-effect', message: `${node.name} uses an effect that the importer may need to approximate.`, nodeId: node.id, severity: 'warning' })
  }
  return effects
}

function baseNode(node: { id: string; name: string }, type: FrameUiNodeType, parentId: string | null, index: number): Pick<FrameUiExportNode, 'id' | 'name' | 'type' | 'parentId' | 'zIndex'> {
  return { id: node.id, name: cleanName(node.name, type.toLowerCase()), type, parentId, zIndex: index }
}

function convertVisual(node: VisualObject, parentId: string | null, index: number, ctx: BuildContext): FrameUiExportNode {
  const children = node.children
    .filter((child) => ctx.options.includeHiddenLayers || !child.hidden)
    .map((child, childIndex) => convertVisual(child, node.id, childIndex, ctx))
  const direction = node.layout.direction
  const mode = direction === 'row' ? 'HORIZONTAL' : direction === 'column' ? 'VERTICAL' : direction === 'grid' ? 'GRID' : 'FREE'
  const assetId = (node.kind === 'Image' || node.kind === 'Avatar') ? registerImage(ctx, node.src, node) : null
  if ((node.kind === 'Vector' || node.kind === 'Polygon') && !node.path) ctx.warnings.push({ code: 'unsupported-vector', message: `${node.name} has no editable vector path.`, nodeId: node.id, severity: 'warning' })
  return {
    ...baseNode(node, visualType[node.kind], parentId, index),
    childIds: children.map((child) => child.id), children,
    x: finite(node.x), y: finite(node.y), width: finite(node.width), height: finite(node.height), rotation: finite(node.rotation), opacity: finite(node.opacity, 1),
    visible: !node.hidden, locked: node.locked, clipContent: node.clip,
    layout: { mode, wrap: node.layout.wrap, gap: finite(node.layout.gap), padding: { top: finite(node.layout.padding), right: finite(node.layout.padding), bottom: finite(node.layout.padding), left: finite(node.layout.padding) }, align: node.layout.alignment, justify: node.layout.distribution, constraints: node.layout.constraints, minWidth: node.layout.minWidth, maxWidth: node.layout.maxWidth },
    fills: paint(node.gradient ?? node.fill, node.fillOpacity), strokes: paint(node.stroke, node.strokeOpacity), strokeWidth: finite(node.strokeWidth), radius: node.radius.map((value) => finite(value)) as [number, number, number, number], effects: visualEffects(node, ctx),
    text: node.kind === 'Text' ? { color: node.fill, characters: node.text ?? '', fontFamily: node.fontFamily, fontStyle: 'Regular', fontWeight: node.fontWeight, fontSize: finite(node.fontSize, 16), lineHeight: finite(node.lineHeight, 24), letterSpacing: finite(node.letterSpacing), alignment: node.textAlign, decoration: node.textDecoration, runs: node.textRuns } : undefined,
    vector: (node.kind === 'Vector' || node.kind === 'Polygon' || node.kind === 'Icon') ? { path: node.path, viewBox: node.viewBox } : undefined,
    image: assetId ? { assetId, fit: node.imageFit === 'contain' ? 'CONTAIN' : node.imageFit === 'fill' ? 'FILL' : 'COVER' } : undefined,
    component: node.kind === 'Component' ? {
      componentId: node.id,
      variants: node.variants?.map((variant) => ({ id: variant.id, name: variant.name, properties: variant.properties, children: variant.objects.map((child, childIndex) => convertVisual(child, variant.id, childIndex, ctx)) })),
    } : node.componentId ? { componentId: node.componentId, variant: node.variant, overrides: node.overrides } : undefined,
    tokenBindings: node.bindings,
    source: node.source ? { component: node.source.component, selector: node.source.selector } : undefined,
  }
}

function structuredType(node: StructuredNode): FrameUiNodeType {
  if (node.type === 'Text') return 'TEXT'
  if (node.type === 'Image' || node.type === 'RasterFallback') return 'IMAGE'
  if (node.type === 'SVG' || node.type === 'Shape') return 'VECTOR'
  if (node.type === 'Icon') return 'ICON'
  if (node.type === 'Section') return 'SECTION'
  if (node.type === 'Group') return 'GROUP'
  if (node.type === 'Divider') return 'LINE'
  if (node.type === 'ComponentInstance') return 'COMPONENT_INSTANCE'
  return 'FRAME'
}

function svgMarkup(node: StructuredNode): string | undefined {
  const geometry = node.source.svgGeometry
  if (!geometry) return undefined
  const attributes = Object.entries(geometry).map(([key, value]) => `${key}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join(' ')
  const tag = geometry.d ? 'path' : geometry.points ? 'polygon' : geometry.cx ? (geometry.rx || geometry.ry ? 'ellipse' : 'circle') : geometry.x1 ? 'line' : 'path'
  return `<svg xmlns="http://www.w3.org/2000/svg"${geometry.viewBox ? ` viewBox="${geometry.viewBox}"` : ''}><${tag} ${attributes}/></svg>`
}

/** Computed SVG fill/stroke also exist on HTML elements but do not paint their CSS backgrounds. */
function structuredFills(node: StructuredNode): FrameUiExportNode['fills'] {
  if(node.type==='Text')return paint(node.typography?.gradient?.image??node.typography?.color)
  const tag=node.source.tag.toLowerCase()
  const svgLeaf=['path','rect','circle','ellipse','line','polygon','polyline','text','tspan'].includes(tag)
  if(svgLeaf)return paint(node.appearance.fill)
  const image=node.appearance.backgroundImage
  return paint(image&&image!=='none'?image:node.appearance.backgroundColor)
}

function structuredStroke(node: StructuredNode): { strokes: FrameUiExportNode['strokes']; strokeWidth: number } {
  // SVG paint is inherited by geometry, not painted around <svg>/<g> viewport boxes.
  const tag = node.source.tag.toLowerCase()
  const svgLeaf = ['path','rect','circle','ellipse','line','polygon','polyline','text','tspan'].includes(tag)
  if (svgLeaf) return { strokes: paint(node.appearance.stroke), strokeWidth: finite(node.appearance.strokeWidth ?? 1, 1) }
  const border = node.appearance.border
  return { strokes: border && border.width > 0 ? paint(border.color) : [], strokeWidth: finite(border?.width ?? 0, 0) }
}

function convertStructured(node: StructuredNode, parentId: string | null, index: number, ctx: BuildContext): FrameUiExportNode {
  if(node.type==='RasterFallback')ctx.warnings.push({code:'existing-raster-fallback',message:`${node.name} was already stored as an image; recapture its source to recover supported editable layers.`,nodeId:node.id,severity:'warning'})
  const children = node.children
    .filter((child) => ctx.options.includeHiddenLayers || child.visibility)
    .map((child, childIndex) => convertStructured(child, node.id, childIndex, ctx))
  // HTML absolute children use the padding-edge containing block. Native groups
  // have no CSS border box, so preserve the renderer's border inset explicitly.
  const borderInset = node.type !== 'SVG' && node.type !== 'Shape' && node.appearance.border?.style !== 'none' && node.appearance.border?.style !== 'hidden' ? finite(node.appearance.border?.width ?? 0) : 0
  if (borderInset > 0) for (const child of children) { child.x += borderInset; child.y += borderInset }
  const assetId = (node.type === 'Image' || node.type === 'RasterFallback') ? registerImage(ctx, node.source.imageSrc, { ...node, width: node.bounds.width, height: node.bounds.height }) : null
  const tokenBindings = node.tokenBindings ? Object.fromEntries(Object.entries(node.tokenBindings).flatMap(([key, binding]) => binding?.token ? [[key, binding.token]] : [])) : undefined
  const effects: FrameUiExportNode['effects'] = []
  if (node.appearance.boxShadow) effects.push({ type: /\binset\b/i.test(node.appearance.boxShadow) ? 'INNER_SHADOW' : 'DROP_SHADOW', value: node.appearance.boxShadow })
  if (node.appearance.blur) effects.push({ type: 'LAYER_BLUR', value: `${node.appearance.blur}px`, radius: node.appearance.blur })
  if (node.appearance.backgroundImage && !/gradient\(/i.test(node.appearance.backgroundImage)) {
    effects.push({ type: 'UNSUPPORTED', value: node.appearance.backgroundImage })
    ctx.warnings.push({ code: 'unsupported-effect', message: `${node.name} has a background effect that requires attention.`, nodeId: node.id, severity: 'warning' })
  }
  return {
    ...baseNode(node, structuredType(node), parentId, index),
    childIds: children.map((child) => child.id), children,
    x: finite(node.bounds.x), y: finite(node.bounds.y), width: finite(node.bounds.width), height: finite(node.bounds.height), rotation: finite(node.appearance.rotation), opacity: finite(node.appearance.opacity, 1), visible: node.visibility, locked: node.locked, clipContent: node.appearance.clip,
    layout: { mode: node.layout.mode === 'stack' ? (node.layout.direction === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL') : node.layout.mode === 'grid' ? 'GRID' : 'FREE', wrap: !!node.layout.wrap, gap: finite(node.layout.gap ?? 0), padding: node.layout.padding ?? { top: 0, right: 0, bottom: 0, left: 0 }, align: node.layout.align ?? 'start', justify: node.layout.justify ?? 'start', constraints: node.constraints.position, minWidth: node.layout.minWidth, maxWidth: node.layout.maxWidth },
    fills: structuredFills(node), ...structuredStroke(node), radius: node.appearance.radius, effects,
    text: node.typography ? { gradient: node.typography.gradient, color: node.typography.color, captureLines: node.typography.captureLines, textOverflow: node.typography.textOverflow, characters: node.typography.text, fontFamily: node.typography.fontFamily, fontStyle: node.typography.fontStyle ?? 'Regular', fontWeight: node.typography.fontWeight, fontSize: finite(node.typography.fontSize, 16), lineHeight: finite(node.typography.lineHeight, 24), letterSpacing: finite(node.typography.letterSpacing), alignment: node.typography.textAlign, decoration: node.typography.textDecoration, runs: node.typography.textRuns } : undefined,
    vector: ['SVG', 'Shape', 'Icon'].includes(node.type) ? { path: node.source.svgGeometry?.d, viewBox: node.source.svgGeometry?.viewBox, svg: svgMarkup(node), tag: node.source.tag, geometry: node.source.svgGeometry } : undefined,
    image: assetId ? { assetId, fit: node.appearance.objectFit === 'contain' ? 'CONTAIN' : node.appearance.objectFit === 'fill' ? 'FILL' : 'COVER' } : undefined,
    component: node.componentBinding ? { componentId: node.componentBinding.componentId, variant: node.componentBinding.variant } : undefined,
    captureAppearance: node.appearance.clip && node.bounds.width <= 1 && node.bounds.height <= 1 && /(?:^|\s)(?:sr-only|visually-hidden)(?:\s|$)/.test(node.source.classes ?? '') ? {...node.appearance, clipPath: 'inset(50%)'} : node.appearance, control: node.source.control,
    tokenBindings, source: { component: node.source.component, selector: node.source.selector },
  }
}

function selectedVisualObjects(objects: VisualObject[], ids: Set<string>): VisualObject[] {
  const result: VisualObject[] = []
  const walk = (node: VisualObject): boolean => {
    if (ids.has(node.id)) { result.push(node); return true }
    let found = false; for (const child of node.children) found = walk(child) || found; return found
  }
  objects.forEach(walk)
  return result
}

function selectedStructuredNodes(nodes: StructuredNode[], ids: Set<string>): StructuredNode[] {
  const result: StructuredNode[] = []
  const walk = (node: StructuredNode): boolean => {
    if (ids.has(node.id)) { result.push(node); return true }
    let found = false; for (const child of node.children) found = walk(child) || found; return found
  }
  nodes.forEach(walk)
  return result
}

function shouldUseStructured(page: VisualPage): boolean {
  return !!page.structured
}

function pageRoot(documentId: string, page: VisualPage, ctx: BuildContext, selection: Set<string>, structuredSelection: Set<string>, selectionOnly: boolean): FrameUiExportNode {
  const rootId = `${documentId}:${page.id}:artboard`
  const structured = shouldUseStructured(page)
  const sourceStructured = structured ? (selectionOnly ? selectedStructuredNodes(page.structured!.children, structuredSelection) : page.structured!.children) : []
  const visualObjects = structured ? page.objects.filter(node => node.designOnly) : page.objects
  const sourceVisual = selectionOnly ? selectedVisualObjects(visualObjects, selection) : visualObjects
  const children = [
    ...sourceStructured.filter((node) => ctx.options.includeHiddenLayers || node.visibility).map((node, index) => convertStructured(node, rootId, index, ctx)),
    ...sourceVisual.filter((node) => ctx.options.includeHiddenLayers || !node.hidden).map((node, index) => convertVisual(node, rootId, sourceStructured.length + index, ctx)),
  ]
  return {
    id: rootId, type: 'FRAME', name: cleanName(page.name, 'Artboard'), parentId: null, childIds: children.map((child) => child.id), children,
    x: 0, y: 0, width: finite(page.width), height: finite(page.height), rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, clipContent: true,
    layout: { mode: 'FREE', wrap: false, gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, align: 'start', justify: 'start', constraints: 'left-top' },
    fills: [], strokes: [], strokeWidth: 0, radius: [0, 0, 0, 0], effects: [],
  }
}

function variables(items: DesignVariable[]): FrameUiExportToken[] {
  return items.map((item) => ({ id: item.id, collection: cleanName(item.collection, 'FrameUI'), name: cleanName(item.name, item.id), type: item.type === 'Colour' ? 'COLOR' : item.type.toUpperCase() as FrameUiExportToken['type'], value: item.type === 'Number' ? Number.parseFloat(item.value) : item.type === 'Boolean' ? item.value === 'true' : item.value }))
}

function collectFonts(pages: VisualPage[]): FrameUiExportFont[] {
  const all = new Map<string, FrameUiExportFont>()
  for (const page of pages) {
    const add = (family: string, weight: string, style = 'Regular') => {
      const clean = family.split(',')[0].replace(/["']/g, '').trim()
      if (!clean) return
      all.set(`${clean}:${weight}:${style}`, { family: clean, weight, style, status: 'CHECK_ON_IMPORT' })
    }
    for (const font of page.fonts ?? []) add(font.family, font.weight, font.style)
    const walkVisual = (node: VisualObject) => { if (node.kind === 'Text') add(node.fontFamily, node.fontWeight); node.children.forEach(walkVisual) }
    page.objects.forEach(walkVisual)
    const walkStructured = (node: StructuredNode) => { if (node.typography) add(node.typography.fontFamily, node.typography.fontWeight); node.children.forEach(walkStructured) }
    page.structured?.children.forEach(walkStructured)
  }
  return [...all.values()]
}

function validateNode(node: FrameUiExportNode, ids: Set<string>, componentIds: Set<string>, tokenIds: Set<string>, warnings: FrameUiExportWarning[]): void {
  if (ids.has(node.id)) warnings.push({ code: 'duplicate-id', message: `Duplicate FrameUI ID: ${node.id}`, nodeId: node.id, severity: 'error' })
  ids.add(node.id)
  if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width < 0 || node.height < 0) warnings.push({ code: 'invalid-dimensions', message: `${node.name} has invalid dimensions.`, nodeId: node.id, severity: 'error' })
  if (node.component && node.type === 'COMPONENT_INSTANCE' && !componentIds.has(node.component.componentId)) warnings.push({ code: 'broken-component-reference', message: `${node.name} refers to a component that is not in this export.`, nodeId: node.id, severity: 'warning' })
  for (const tokenId of Object.values(node.tokenBindings ?? {})) if (!tokenIds.has(tokenId)) warnings.push({ code: 'missing-token', message: `${node.name} refers to a token that is not in this export.`, nodeId: node.id, severity: 'warning' })
  node.children.forEach((child) => validateNode(child, ids, componentIds, tokenIds, warnings))
}

function jsonFile(path: string, value: unknown): FrameUiPackageFile {
  return { path, content: JSON.stringify(value, null, 2), encoding: 'utf8' }
}

export function buildFrameUiModel(input: BuildFrameUiPackageInput) {
  const active = input.documents.find((document) => document.id === input.activeDocumentId) ?? input.documents[0]
  if (!active) throw new Error('There is no design to export.')
  const documents = input.options.scope === 'all-designs' ? input.documents : [active]
  const ctx: BuildContext = { assets: [], assetFiles: [], warnings: [], assetByData: new Map(), options: input.options }
  const selection = new Set(input.selectionIds)
  const structuredSelection = new Set(input.structuredSelectionIds)
  const pages: FrameUiExportPage[] = []
  for (const document of documents) {
    const candidates = input.options.scope === 'artboard' || input.options.scope === 'selection' ? document.pages.filter((page) => document.id === active.id && page.id === input.activePageId) : document.pages
    for (const page of candidates) {
      const selectionOnly = input.options.scope === 'selection'
      const root = pageRoot(document.id, page, ctx, selection, structuredSelection, selectionOnly)
      if (!root.children.length) ctx.warnings.push({ code: 'empty-frame', message: `${page.name} contains no layers in the selected export scope.`, nodeId: root.id, severity: selectionOnly ? 'error' : 'warning' })
      pages.push({ id: page.id, name: page.name, folder: page.folder, width: page.width, height: page.height, state: page.state, route: page.route, root })
    }
  }
  const components = input.options.includeComponents ? documents.flatMap((document) => document.components.map((component, index) => convertVisual(component, null, index, ctx))) : []
  const tokens = input.options.includeTokens ? variables(documents.flatMap((document) => document.variables)) : []
  const fonts = collectFonts(pages.flatMap((page) => documents.flatMap((document) => document.pages.filter((candidate) => candidate.id === page.id))))
  const interactions: { nodeId: string; targetPageId: string; trigger: string; transition: string }[] = []
  const scanInteractions = (node: VisualObject) => { if (input.options.includePrototype && node.interaction) interactions.push({ nodeId: node.id, targetPageId: node.interaction.targetPageId, trigger: node.interaction.trigger, transition: node.interaction.transition }); node.children.forEach(scanInteractions) }
  documents.forEach((document) => document.pages.forEach((page) => page.objects.forEach(scanInteractions)))
  const componentIds = new Set(components.map((component) => component.id))
  const tokenIds = new Set(tokens.map((token) => token.id))
  const ids = new Set<string>()
  pages.forEach((page) => validateNode(page.root, ids, componentIds, tokenIds, ctx.warnings))
  components.forEach((component) => validateNode(component, ids, componentIds, tokenIds, ctx.warnings))
  const warnings = [...new Map(ctx.warnings.map((warning) => [`${warning.code}:${warning.nodeId ?? ''}:${warning.message}`, warning])).values()]
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const manifest: FrameUiExportManifest = {
    formatVersion: '1.0.0', frameuiVersion: input.frameuiVersion, frameuiDocumentId: active.id, projectName: active.name, exportedAt, documentName: active.name, documentWidthUnit: 'px', colourSpace: 'sRGB', pageCount: pages.length, artboardCount: pages.length, componentCount: components.length, assetCount: ctx.assets.length, tokenCount: tokens.length, targetApplication: input.target === 'figma' ? 'Figma' : 'Adobe XD', targetVersion: 'current', scope: input.options.scope, warnings: warnings.length,
  }
  return { documentId:active.id,name:active.name,pages,components,tokens,interactions,assets:ctx.assets,fonts,assetFiles:ctx.assetFiles,manifest,warnings,stats:{designs:documents.length,artboards:pages.length,components:components.length,assets:ctx.assets.length,variables:tokens.length} }
}

/** Text-package consumers serialize here; native exporters use the model directly. */
export function buildFrameUiPackage(input:BuildFrameUiPackageInput):FrameUiPackageBuild{
 const model=buildFrameUiModel(input)
 const files:FrameUiPackageFile[]=[
  jsonFile('manifest.json',model.manifest),
  jsonFile('document.json',{version:1,documentId:model.documentId,name:model.name,pages:model.pages}),
  jsonFile('components.json',{version:1,components:model.components}),
  jsonFile('tokens.json',{version:1,tokens:model.tokens}),
  jsonFile('interactions.json',{version:1,interactions:model.interactions}),
  jsonFile('assets.json',{version:1,assets:model.assets}),
  jsonFile('fonts.json',{version:1,fonts:model.fonts}),
  jsonFile('warnings.json',{version:1,warnings:model.warnings}),
  ...model.assetFiles,
 ]
 return {files,manifest:model.manifest,warnings:model.warnings,stats:model.stats}
}
