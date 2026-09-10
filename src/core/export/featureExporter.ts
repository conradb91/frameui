import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import type { Annotation, ConceptComponent, DesignState, Feature, FeaturePage, Journey, PageRef, Version } from '@shared/types/model/featureModel'
import type { Page, ProjectModel } from '@shared/types/model/projectModel'
import type { PageStructureItem } from '@shared/types/pageStructure'
import type { ExportFile, ExportScene, ExportWarning, FeatureExportSettings } from '@shared/types/handoff'
import { SvgExporter } from './svgSerializer'

export const DEFAULT_VIEWPORT_WIDTH: Record<Breakpoint, number> = { desktop: 1440, tablet: 768, mobile: 390 }

export function sanitizeFilename(value: string): string {
  return value.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'untitled'
}
export function pageRefKey(ref: PageRef): string { return `${ref.kind}:${ref.pageId}` }
export function validateSvg(svg: string): ExportWarning[] {
  const warnings: ExportWarning[] = []
  if (!/^<svg\b/.test(svg.trim()) || !/<\/svg>\s*$/.test(svg)) warnings.push({ code: 'invalid-svg', message: 'The generated document is not a complete SVG.' })
  if (!/viewBox="0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?"/.test(svg)) warnings.push({ code: 'missing-dimensions', message: 'The SVG has no valid canvas viewBox.' })
  if (/href="(?:file:|\/(?!\/)|[A-Za-z]:\\)/.test(svg)) warnings.push({ code: 'local-reference', message: 'The SVG contains a local filesystem reference.' })
  if (/<image\b/.test(svg) && !/href="data:image\//.test(svg)) warnings.push({ code: 'broken-image', message: 'An image is not embedded.' })
  return warnings
}

export interface FeatureExportInput {
  feature: Feature
  projectModel: ProjectModel
  featurePages: FeaturePage[]
  states: DesignState[]
  conceptComponents: ConceptComponent[]
  journeys: Journey[]
  annotations: Annotation[]
  approvedVersion: Version | null
  /** Resolved, operation-applied trees by state id. */
  trees: Record<string, DesignNode>
  settings: FeatureExportSettings
}
export interface FeatureExportResult { files: ExportFile[]; warnings: ExportWarning[]; scenes: ExportScene[] }

function displayPage(ref: PageRef, input: FeatureExportInput): Page | FeaturePage | undefined {
  return ref.kind === 'existing' ? input.projectModel.pages.find((page) => page.id === ref.pageId) : input.featurePages.find((page) => page.id === ref.pageId)
}
function pageName(ref: PageRef, input: FeatureExportInput): string { return displayPage(ref, input)?.name ?? ref.pageId }

export function buildExportScenes(input: FeatureExportInput): ExportScene[] {
  const selectedRefs = new Set(input.settings.pageRefs.map(pageRefKey))
  const selectedStates = new Set(input.settings.stateIds)
  const selectedViewports = input.settings.viewports.length ? input.settings.viewports : ['desktop' as const]
  const scenes: ExportScene[] = []
  for (const state of input.states) {
    if (!selectedRefs.has(pageRefKey(state.pageRef)) || (selectedStates.size && !selectedStates.has(state.id))) continue
    const tree = input.trees[state.id]
    if (!tree) continue
    for (const viewport of selectedViewports) scenes.push({
      id: `${state.id}:${viewport}`, name: `${pageName(state.pageRef, input)} — ${state.name} — ${viewport}`,
      kind: 'page', pageRef: state.pageRef, stateId: state.id, viewport,
      width: DEFAULT_VIEWPORT_WIDTH[viewport], tree, provenance: state.provenance,
      annotations: input.settings.includeAnnotations ? input.annotations.filter((note) => pageRefKey(note.pageRef) === pageRefKey(state.pageRef) && (note.designStateId === null || note.designStateId === state.id) && note.status !== 'resolved') : [],
    })
  }
  // Reference-only real pages deliberately have no editable state. Their
  // source-derived Project Model structure is still exportable without
  // parsing the visible editor DOM or inventing a proposal.
  for (const ref of input.settings.pageRefs) {
    if (scenes.some((scene) => scene.pageRef && pageRefKey(scene.pageRef) === pageRefKey(ref)) || ref.kind !== 'existing') continue
    const page = input.projectModel.pages.find((item) => item.id === ref.pageId)
    if (!page || page.analysisStatus !== 'ready' || page.structure.length === 0) continue
    const tree = referenceTree(page)
    for (const viewport of selectedViewports) scenes.push({ id: `${page.id}:reference:${viewport}`, name: `${page.name} — ${viewport}`, kind: 'page', pageRef: ref, stateId: null, viewport, width: DEFAULT_VIEWPORT_WIDTH[viewport], tree, provenance: 'reference-only', annotations: [] })
  }
  return scenes
}

function referenceTree(page: Page): DesignNode {
  const convert = (item: PageStructureItem, indices: number[]): DesignNode => ({
    id: `${page.id}.source.${indices.join('.')}`, kind: 'placeholder', label: item.tagName,
    editability: item.isKnownComponent ? 'limited' : 'locked', provenance: 'existing',
    sourceReference: { filePath: item.sourceFilePath ?? page.source.filePath, line: item.sourceLine },
    textPreview: item.textPreview, attributes: item.attributes,
    children: item.children.map((child, index) => convert(child, [...indices, index])),
  })
  return { id: `${page.id}.source`, kind: 'stack', editability: 'locked', provenance: 'reference-only', direction: 'column', gap: 12, align: 'stretch', children: page.structure.map((item, index) => convert(item, [index])) }
}

function annotationLayer(scene: ExportScene): string {
  if (!scene.annotations.length) return ''
  const rows = scene.annotations.map((note, index) => `<g id="annotation-${index + 1}"><circle cx="${scene.width - 28}" cy="${28 + index * 28}" r="10" fill="#f5b84b"/><text x="${scene.width - 28}" y="${32 + index * 28}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" font-weight="700" fill="#111114">${index + 1}</text><title>${escapeXml(note.comment)}</title></g>`).join('')
  return `<g id="Annotations" aria-label="Annotations">${rows}</g>`
}
function injectBeforeClose(svg: string, content: string): string { return content ? svg.replace(/<\/svg>\s*$/, `${content}</svg>`) : svg }

export function exportFeaturePackage(input: FeatureExportInput): FeatureExportResult {
  const exporter = new SvgExporter()
  const scenes = buildExportScenes(input)
  const files: ExportFile[] = []
  const warnings: ExportWarning[] = []
  for (const ref of input.settings.pageRefs) if (!scenes.some((scene) => scene.pageRef && pageRefKey(scene.pageRef) === pageRefKey(ref))) warnings.push({ code: 'empty-page', message: `${pageName(ref, input)} has no structured design or source structure to export.` })
  const multipleStatesForPage = new Map<string, number>()
  for (const scene of scenes) multipleStatesForPage.set(pageRefKey(scene.pageRef!), (multipleStatesForPage.get(pageRefKey(scene.pageRef!)) ?? 0) + 1)
  for (const scene of scenes) {
    const state = input.states.find((item) => item.id === scene.stateId)
    const base = sanitizeFilename(pageName(scene.pageRef!, input))
    const includeState = !!state && (state.name.toLowerCase() !== 'default' || (multipleStatesForPage.get(pageRefKey(scene.pageRef!)) ?? 0) > input.settings.viewports.length)
    const filename = `${base}${includeState ? `-${sanitizeFilename(state!.name)}` : ''}-${scene.viewport}.svg`
    const result = exporter.exportScene(scene, input.settings)
    const svg = injectBeforeClose(result.svg, annotationLayer(scene))
    files.push({ path: `pages/${filename}`, content: svg, mimeType: 'image/svg+xml' })
    warnings.push(...result.warnings, ...validateSvg(svg))
  }
  for (const component of input.conceptComponents.filter((item) => input.settings.componentIds.includes(item.id))) {
    const tree = findConceptNode(component.id, input.trees)
    if (!tree) { warnings.push({ code: 'missing-component-design', message: `${component.name} has no design instance to export.` }); continue }
    const scene: ExportScene = { id: component.id, name: component.name, kind: 'component', pageRef: null, stateId: null, viewport: 'desktop', width: 640, tree, provenance: 'new', annotations: [] }
    const result = exporter.exportScene(scene, input.settings)
    files.push({ path: `components/${sanitizeFilename(component.name)}.svg`, content: result.svg, mimeType: 'image/svg+xml' })
    warnings.push(...result.warnings, ...validateSvg(result.svg))
  }
  for (const journey of input.journeys.filter((item) => input.settings.journeyIds.includes(item.id))) {
    const result = serializeJourneyBoard(journey, input)
    files.push({ path: `journeys/${sanitizeFilename(journey.name)}.svg`, content: result.svg, mimeType: 'image/svg+xml' })
    warnings.push(...result.warnings, ...validateSvg(result.svg))
  }
  if (input.settings.includeMetadata) files.push({
    path: 'manifest/frameui-export.json', mimeType: 'application/json',
    content: JSON.stringify({ schemaVersion: 1, exporter: 'FrameUI SVG V1', feature: { id: input.feature.id, name: input.feature.name, status: input.feature.status }, version: input.approvedVersion ? { id: input.approvedVersion.id, name: input.approvedVersion.name } : null, settings: input.settings, files: files.map((file) => file.path), exportedAt: new Date().toISOString() }, null, 2),
  })
  return { files, warnings: dedupeWarnings(warnings), scenes }
}

function findConceptNode(componentId: string, trees: Record<string, DesignNode>): DesignNode | null {
  let found: DesignNode | null = null
  const visit = (node: DesignNode) => { if (node.kind === 'concept' && node.conceptComponentId === componentId) found = node; if (!found) node.children.forEach(visit) }
  Object.values(trees).some((tree) => { visit(tree); return found !== null })
  return found
}
function escapeXml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function dedupeWarnings(items: ExportWarning[]): ExportWarning[] { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.code}:${item.nodeId ?? ''}:${item.message}`; if (seen.has(key)) return false; seen.add(key); return true }) }

export function serializeJourneyBoard(journey: Journey, input: FeatureExportInput): { svg: string; warnings: ExportWarning[] } {
  const horizontal = input.settings.journeyLayout === 'horizontal'
  const cardWidth = 360, cardHeight = 300, gap = 120, padding = 72, titleHeight = 72
  const width = horizontal ? padding * 2 + journey.steps.length * cardWidth + Math.max(0, journey.steps.length - 1) * gap : padding * 2 + cardWidth
  const height = horizontal ? titleHeight + padding + cardHeight + padding : titleHeight + padding + journey.steps.length * cardHeight + Math.max(0, journey.steps.length - 1) * gap + padding
  const warnings: ExportWarning[] = []
  const positions = new Map<string, { x: number; y: number }>()
  const cards: string[] = []
  journey.steps.forEach((step, index) => {
    const x = padding + (horizontal ? index * (cardWidth + gap) : 0)
    const y = titleHeight + padding + (horizontal ? 0 : index * (cardHeight + gap))
    positions.set(step.id, { x, y })
    const state = step.designStateId ? input.states.find((item) => item.id === step.designStateId) : null
    const tree = step.designStateId ? input.trees[step.designStateId] : null
    let preview = `<rect x="${x + 12}" y="${y + 46}" width="${cardWidth - 24}" height="${cardHeight - 62}" rx="8" fill="#202027"/><text x="${x + cardWidth / 2}" y="${y + 168}" text-anchor="middle" font-family="Inter, sans-serif" font-size="12" fill="#85858e">Reference page</text>`
    if (tree) {
      const result = new SvgExporter().exportScene({ id: step.id, name: pageName(step.pageRef, input), kind: 'page', pageRef: step.pageRef, stateId: state?.id ?? null, viewport: 'desktop', width: 900, tree, provenance: step.provenance, annotations: [] }, input.settings)
      warnings.push(...result.warnings)
      const inner = result.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
      const previewWidth = cardWidth - 24, previewHeight = cardHeight - 62
      const scale = Math.min(previewWidth / result.width, previewHeight / result.height)
      const clipId = `journey-clip-${index}`
      preview = `<defs><clipPath id="${clipId}"><rect x="${x + 12}" y="${y + 46}" width="${previewWidth}" height="${previewHeight}" rx="8"/></clipPath></defs><rect x="${x + 12}" y="${y + 46}" width="${previewWidth}" height="${previewHeight}" rx="8" fill="#111114"/><g clip-path="url(#${clipId})" transform="translate(${x + 12} ${y + 46}) scale(${scale})">${inner}</g>`
    }
    const indicator = step.provenance === 'new' ? '#55c98b' : step.provenance === 'existing-modified' ? '#f5b84b' : '#7c6af2'
    const stepNotes = input.settings.includeAnnotations ? input.annotations.filter((note) => pageRefKey(note.pageRef) === pageRefKey(step.pageRef) && (note.designStateId === null || note.designStateId === step.designStateId) && note.status !== 'resolved') : []
    const noteBadge = stepNotes.length ? `<g aria-label="${stepNotes.length} annotations"><circle cx="${x + cardWidth - 18}" cy="${y + cardHeight - 18}" r="11" fill="#f5b84b"/><text x="${x + cardWidth - 18}" y="${y + cardHeight - 14}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" font-weight="700" fill="#111114">${stepNotes.length}</text><title>${escapeXml(stepNotes.map((note) => note.comment).join(' · '))}</title></g>` : ''
    cards.push(`<g id="${sanitizeFilename(pageName(step.pageRef, input))}" aria-label="${escapeXml(pageName(step.pageRef, input))}"><rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="14" fill="#17171b" stroke="#37373d"/><circle cx="${x + 16}" cy="${y + 21}" r="5" fill="${indicator}"/><text x="${x + 29}" y="${y + 25}" font-family="Inter, sans-serif" font-size="14" font-weight="700" fill="#fff">${escapeXml(pageName(step.pageRef, input))}</text>${state ? `<text x="${x + cardWidth - 14}" y="${y + 25}" text-anchor="end" font-family="Inter, sans-serif" font-size="10" fill="#aaaab2">${escapeXml(state.name)}</text>` : ''}${preview}${noteBadge}</g>`)
  })
  const connections = journey.connections.flatMap((connection) => {
    const from = positions.get(connection.fromStepId), to = positions.get(connection.toStepId)
    if (!from || !to) return []
    const x1 = horizontal ? from.x + cardWidth : from.x + cardWidth / 2, y1 = horizontal ? from.y + cardHeight / 2 : from.y + cardHeight
    const x2 = horizontal ? to.x : to.x + cardWidth / 2, y2 = horizontal ? to.y + cardHeight / 2 : to.y
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    return [`<g aria-label="${escapeXml(connection.trigger)} ${escapeXml(connection.label)}"><path d="M${x1} ${y1} L${x2} ${y2}" stroke="#7c6af2" stroke-width="2" fill="none" marker-end="url(#arrow)"/><rect x="${mx - 52}" y="${my - 14}" width="104" height="24" rx="12" fill="#202027"/><text x="${mx}" y="${my + 3}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" font-weight="600" fill="#c8c1ff">${escapeXml(connection.label || connection.elementLabel || connection.trigger)}</text></g>`]
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(journey.name)}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#7c6af2"/></marker></defs><rect width="${width}" height="${height}" fill="#0f0f12"/><text x="${padding}" y="46" font-family="Inter, sans-serif" font-size="24" font-weight="700" fill="#fff">${escapeXml(journey.name)}</text>${connections.join('')}${cards.join('')}</svg>`
  return { svg, warnings }
}
