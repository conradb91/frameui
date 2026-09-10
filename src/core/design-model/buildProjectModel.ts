import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DetectedComponent, DetectedPage } from '@shared/types/projectIndex'
import type { PageStructureItem } from '@shared/types/pageStructure'
import type { StyleTokens } from '@shared/types/styleTokens'
import type { SourceReference } from '@shared/types/model/sourceReference'
import type { Area, Component, Diagnostic, Interaction, Page, ProjectModel, RoutePattern, Token, TokenCategory } from '@shared/types/model/projectModel'
import { extractPageStructureFromSource } from '@core/adapters/markup/extractPageStructure'
import { IdRegistry } from './id'
import { analyseDesignSystem } from '@core/design-system/analyseDesignSystem'

const MAX_ANALYSED_PAGES = 500

export function componentKey(name: string): string {
  return name.replace(/^(?:x-|x:|svelte:)/i, '').replace(/[-_.:]/g, '').toLowerCase()
}

/** Walks a page's structure tree, attaching the real file path of every
 * detected project component reference — the one shared implementation
 * (previously duplicated between this builder and the getPageStructure IPC
 * handler, which now imports this too). */
export function attachComponentPaths(items: PageStructureItem[], componentPathsByName: Map<string, string | undefined>): void {
  for (const item of items) {
    if (item.isKnownComponent) item.sourceFilePath = componentPathsByName.get(componentKey(item.tagName))
    attachComponentPaths(item.children, componentPathsByName)
  }
}

function summariseStructure(items: PageStructureItem[]): Pick<Page, 'elementCount' | 'componentNames' | 'textContent'> {
  let elementCount = 0
  const componentNames = new Set<string>()
  const textContent: string[] = []
  function visit(nodes: PageStructureItem[]) {
    for (const node of nodes) {
      elementCount++
      if (node.isKnownComponent) componentNames.add(node.tagName)
      if (node.textPreview) textContent.push(node.textPreview)
      visit(node.children)
    }
  }
  visit(items)
  return { elementCount, componentNames: [...componentNames], textContent: textContent.slice(0, 30) }
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function areaFor(page: DetectedPage): string {
  const routeSegment = page.route?.split(/[/?#]/).filter(Boolean)[0]
  if (routeSegment && !routeSegment.startsWith(':')) return titleCase(routeSegment)
  const ignored = new Set(['src', 'app', 'pages', 'views', 'routes', 'resources', 'controllers'])
  const segment = page.filePath.split('/').slice(0, -1).find((part) => !ignored.has(part.toLowerCase()))
  return segment ? titleCase(segment) : 'Application'
}

function cleanRoute(value: string): string | null {
  const route = value.trim()
  if (!route || route.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:)/i.test(route)) return null
  const withoutOrigin = route.replace(/^\$\{[^}]+\}/, '').split(/[?#]/)[0]
  if (!withoutOrigin.startsWith('/')) return null
  return withoutOrigin.replace(/\/$/, '') || '/'
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

function labelNear(content: string, index: number, fallback: string): string {
  const excerpt = content.slice(index, index + 260)
  const close = excerpt.indexOf('>')
  if (close === -1) return fallback
  const text = excerpt.slice(close + 1).split('<')[0].replace(/\{[{%#]?[\s\S]*?[}%#]?\}/g, '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 80) || fallback
}

interface RawInteraction {
  sourcePageId: string
  destinationRoute: string
  label: string
  trigger: Interaction['trigger']
  filePath: string
  line: number
}

function extractInteractions(content: string, page: Page): RawInteraction[] {
  const interactions: RawInteraction[] = []
  const seen = new Set<string>()
  const attributePattern = /<(a|Link|NavLink|form)\b[^>]*\b(href|to|action)\s*=\s*(?:\{\s*)?['"]([^'"]+)['"](?:\s*\})?[^>]*>/gi
  for (const match of content.matchAll(attributePattern)) {
    const destinationRoute = cleanRoute(match[3])
    if (!destinationRoute || match.index === undefined) continue
    const key = `${destinationRoute}:${match.index}`
    if (seen.has(key)) continue
    seen.add(key)
    interactions.push({
      sourcePageId: page.id,
      destinationRoute,
      label: labelNear(content, match.index, match[1].toLowerCase() === 'form' ? 'Submit form' : `Open ${destinationRoute}`),
      trigger: match[1].toLowerCase() === 'form' ? 'form' : 'link',
      filePath: page.source.filePath,
      line: lineAt(content, match.index),
    })
  }

  const callPattern = /\b(?:navigate|redirect|router\.(?:push|replace)|location\.assign)\s*\(\s*['"]([^'"]+)['"]/gi
  for (const match of content.matchAll(callPattern)) {
    const destinationRoute = cleanRoute(match[1])
    if (!destinationRoute || match.index === undefined) continue
    const key = `${destinationRoute}:${match.index}`
    if (seen.has(key)) continue
    seen.add(key)
    interactions.push({
      sourcePageId: page.id,
      destinationRoute,
      label: `Navigate to ${destinationRoute}`,
      trigger: 'programmatic',
      filePath: page.source.filePath,
      line: lineAt(content, match.index),
    })
  }
  const serverUrlPattern = /\b(?:site_url|base_url|url)\s*\(\s*['"]([^'"]+)['"]/gi
  for (const match of content.matchAll(serverUrlPattern)) {
    if (match.index === undefined) continue
    const destinationRoute = cleanRoute(match[1].startsWith('/') ? match[1] : `/${match[1]}`)
    if (!destinationRoute) continue
    const key = `${destinationRoute}:${match.index}`
    if (seen.has(key)) continue
    seen.add(key)
    interactions.push({
      sourcePageId: page.id,
      destinationRoute,
      label: labelNear(content, Math.max(0, content.lastIndexOf('<', match.index)), `Open ${destinationRoute}`),
      trigger: 'link',
      filePath: page.source.filePath,
      line: lineAt(content, match.index),
    })
  }
  return interactions
}

function routeMatcher(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\[[^\]]+\\\]|:[^/]+|\{[^}]+\}/g, '[^/]+')
  return new RegExp(`^${escaped}/?$`)
}

/** Category buckets on `StyleTokens` map 1:1 onto `TokenCategory` except
 * for pluralization — this is the one place that difference is bridged. */
const CATEGORY_MAP: Record<keyof Omit<StyleTokens, 'source'>, TokenCategory> = {
  colors: 'color',
  spacing: 'spacing',
  radius: 'radius',
  breakpoints: 'breakpoint',
}

export function styleTokensToModel(styleTokens: StyleTokens, registry: IdRegistry): Token[] {
  const tokens: Token[] = []
  for (const [key, category] of Object.entries(CATEGORY_MAP) as [keyof Omit<StyleTokens, 'source'>, TokenCategory][]) {
    for (const token of styleTokens[key]) {
      tokens.push({ id: registry.make('token', [category, token.name]), category, name: token.name, value: token.value, confidence: token.confidence })
    }
  }
  return tokens
}

/** Reparse one already-known page without rebuilding the Project Model or
 * re-reading every component. Used by the incremental indexer. */
export function refreshProjectPage(rootPath: string, page: Page, components: Component[]): Page {
  let content = ''
  try { content = fs.readFileSync(path.join(rootPath, page.source.filePath), 'utf-8') } catch {
    return { ...page, structure: [], elementCount: 0, componentNames: [], textContent: [], analysisStatus: 'unreadable' }
  }
  const knownNames = new Set(components.map((component) => component.name))
  const componentPaths = new Map(components.map((component) => [componentKey(component.name), component.source.filePath]))
  const structure = extractPageStructureFromSource(content, page.source.filePath, knownNames)
  attachComponentPaths(structure, componentPaths)
  return { ...page, structure, ...summariseStructure(structure), analysisStatus: structure.length ? 'ready' : 'empty' }
}

/**
 * Builds the Project Model (Design Model spec §0, Layer A) — the one
 * framework-neutral artifact every workspace section, IPC handler and
 * later Feature reads from. Every `Page`/`Component`/`Token`/`Area`/
 * `RoutePattern` id is derived deterministically from its name via
 * `IdRegistry` (never `crypto.randomUUID()`), so re-scanning the same
 * project without any real change produces byte-identical ids — required
 * for Features, incremental indexing and version history to reference
 * these objects across sessions. `Interaction`/`Diagnostic` ids stay
 * ephemeral: they're findings about one scan, not addressable objects
 * anything references by id yet.
 */
export function buildProjectModel(
  projectId: string,
  rootPath: string,
  detectedPages: DetectedPage[],
  detectedComponents: DetectedComponent[],
  styleTokens: StyleTokens,
  framework = 'unknown',
  candidateFiles: string[] = [],
): ProjectModel {
  const registry = new IdRegistry()
  const knownNames = new Set(detectedComponents.map((component) => component.name))
  const componentPathsByName = new Map(detectedComponents.map((component) => [componentKey(component.name), component.filePath]))

  const components: Component[] = detectedComponents.map((component) => ({
    id: registry.make('component', [component.name]),
    name: component.name,
    exportKind: component.exportKind,
    source: { filePath: component.filePath },
  }))

  const pages: Page[] = []
  const rawInteractions: RawInteraction[] = []

  for (const detected of detectedPages.slice(0, MAX_ANALYSED_PAGES)) {
    let content = ''
    let unreadable = false
    try {
      content = fs.readFileSync(path.join(rootPath, detected.filePath), 'utf-8')
    } catch {
      unreadable = true
    }
    const structure = unreadable ? [] : extractPageStructureFromSource(content, detected.filePath, knownNames)
    attachComponentPaths(structure, componentPathsByName)
    const summary = summariseStructure(structure)
    const area = areaFor(detected)
    const id = registry.wouldCollide('page', [detected.name])
      ? registry.make('page', [area, detected.name])
      : registry.make('page', [detected.name])
    const source: SourceReference = detected.route ? { filePath: detected.filePath, route: detected.route } : { filePath: detected.filePath }
    const page: Page = {
      id,
      name: detected.name,
      route: detected.route,
      routeId: null,
      area,
      source,
      structure,
      ...summary,
      supportedViewports: ['desktop', 'tablet', 'mobile'],
      states: [{ id: registry.make('state', [detected.name, 'default']), pageId: id, name: 'Default', kind: 'default' }],
      analysisStatus: unreadable ? 'unreadable' : structure.length === 0 ? 'empty' : 'ready',
    }
    pages.push(page)
    if (!unreadable) rawInteractions.push(...extractInteractions(content, page))
  }

  const routes: RoutePattern[] = []
  for (const page of pages) {
    if (!page.route) continue
    const id = registry.make('route', [page.name])
    routes.push({ id, path: page.route, pageId: page.id, source: page.source })
    page.routeId = id
  }

  const interactions: Interaction[] = rawInteractions.map((raw) => {
    const destination = pages.find((page) => page.route && routeMatcher(page.route).test(raw.destinationRoute))
    return {
      id: crypto.randomUUID(),
      sourcePageId: raw.sourcePageId,
      destinationPageId: destination?.id ?? null,
      destinationRoute: raw.destinationRoute,
      label: raw.label,
      trigger: raw.trigger,
      source: { filePath: raw.filePath, line: raw.line },
      resolved: !!destination,
    }
  })

  const areaMap = new Map<string, string[]>()
  for (const page of pages) areaMap.set(page.area, [...(areaMap.get(page.area) ?? []), page.id])
  const areas: Area[] = [...areaMap.entries()].map(([name, pageIds]) => ({ id: registry.make('area', [name]), name, pageIds }))

  const diagnostics: Diagnostic[] = []
  for (const page of pages) {
    if (page.analysisStatus !== 'ready') diagnostics.push({
      id: crypto.randomUUID(),
      severity: page.analysisStatus === 'unreadable' ? 'error' : 'warning',
      kind: page.analysisStatus === 'unreadable' ? 'unreadable-page' : 'empty-page',
      title: page.analysisStatus === 'unreadable' ? 'Page source could not be read' : 'No visual structure found',
      detail: page.source.filePath,
      pageId: page.id,
      source: page.source,
    })
  }
  const unresolvedFindingKeys = new Set<string>()
  for (const interaction of interactions.filter((item) => !item.resolved)) {
    const key = `${interaction.sourcePageId}:${interaction.destinationRoute}`
    if (unresolvedFindingKeys.has(key)) continue
    unresolvedFindingKeys.add(key)
    diagnostics.push({
      id: crypto.randomUUID(),
      severity: 'warning',
      kind: 'unresolved-navigation',
      title: `Unresolved destination ${interaction.destinationRoute}`,
      detail: interaction.label,
      pageId: interaction.sourcePageId,
      source: interaction.source,
    })
  }

  const tokens = styleTokensToModel(styleTokens, registry)
  const tokenSource = styleTokens.source
  const designSystem = analyseDesignSystem(rootPath, pages, components, tokens, framework)
  const isLayout = (file: string) => /(?:^|\/)(?:layouts?|shells?)(?:\/|[.])|(?:^|\/)(?:_Layout|MainLayout|\+layout)\./i.test(file)
  const layouts = components.filter((component) => isLayout(component.source.filePath)).length
  const sourceRelationships: NonNullable<ProjectModel['sourceRelationships']> = []
  const relationshipKeys = new Set<string>()
  function relationships(sourceFile: string, items: PageStructureItem[]) {
    for (const item of items) {
      const targetFile = item.sourceFilePath ?? (item.isKnownComponent ? componentPathsByName.get(componentKey(item.tagName)) : undefined)
      const key = `${sourceFile}:${targetFile}`
      if (targetFile && targetFile !== sourceFile && !relationshipKeys.has(key)) {
        relationshipKeys.add(key)
        sourceRelationships.push({ sourceFile, targetFile, kind: isLayout(targetFile) ? 'layout' : 'component' })
      }
      relationships(sourceFile, item.children)
    }
  }
  for (const page of pages) relationships(page.source.filePath, page.structure)
  for (const component of designSystem.components) {
    const source = components.find((item) => item.id === component.componentId)
    if (source) relationships(source.source.filePath, component.sourceStructure)
  }
  return {
    version: 1,
    projectId,
    generatedAt: new Date().toISOString(),
    pages,
    routes,
    areas,
    components,
    tokens,
    tokenSource,
    styles: candidateFiles.filter((file) => /\.(css|scss|sass|less)$/i.test(file)).map((file) => {
      const filePath = path.relative(rootPath, file).split(path.sep).join('/')
      return { id: registry.make('style', [filePath]), name: path.basename(file), tokenIds: [], source: { filePath } }
    }),
    assets: candidateFiles.filter((file) => /\.(svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i.test(file)).map((file) => {
      const filePath = path.relative(rootPath, file).split(path.sep).join('/')
      const kind = /\.(woff2?|ttf|otf)$/i.test(file) ? 'font' as const : /\.(svg|ico)$/i.test(file) ? 'icon' as const : 'image' as const
      return { id: registry.make('asset', [filePath]), name: path.basename(file), kind, source: { filePath } }
    }),
    sourceRelationships,
    interactions,
    diagnostics,
    designSystem,
    statistics: {
      pages: pages.length,
      components: components.length,
      tokens: tokens.length,
      layouts,
      navigationGroups: areas.length,
      connections: interactions.filter((item) => item.resolved).length,
      unresolvedRoutes: interactions.filter((item) => !item.resolved).length,
      issues: diagnostics.length,
      renderIssues: pages.filter((page) => page.analysisStatus !== 'ready').length,
    },
  }
}
