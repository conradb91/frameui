import fs from 'node:fs'
import path from 'node:path'
import type { ProjectIndex, Language, IndexProgressStep, ProjectApplication } from '@shared/types/projectIndex'
import type { ProjectModel } from '@shared/types/model/projectModel'
import { readPackageJson } from '@core/adapters/shared/packageJson'
import { readComposerJson } from '@core/adapters/shared/composerJson'
import { detectProject } from '@core/adapters/registry'
import { MARKUP_EXTENSIONS } from '@core/adapters/markup/findMarkupPages'
import { resolveStyleTokens } from '@core/adapters/tailwind/resolveStyleTokens'
import { buildProjectModel } from '@core/design-model/buildProjectModel'
import type { AdapterContext } from '@core/adapters/types'
import { createIgnoreRules } from './ignore'
import { walkFiles } from './walkFiles'
import { walkFileMetadata } from './walkFiles'
import { buildDependencyGraph } from './dependencyGraph'
import { capabilitiesFor, discoverApplications } from './projectCapabilities'
import crypto from 'node:crypto'

const normalize = (value: string) => value.split(path.sep).join('/')
const prefixId = (applicationId: string, id: string) => `${applicationId}/${id}`
const prefixFile = (root: string, file: string) => root === '.' ? normalize(file) : normalize(path.posix.join(root, file))

/** Builds the framework-neutral model for one target without allowing a
 * sibling application to leak into its adapter context. */
export function indexApplicationModel(projectId: string, repositoryRoot: string, application: ProjectApplication): ProjectModel {
  const appRoot = path.resolve(repositoryRoot, application.rootPath)
  const ignoreRules = createIgnoreRules()
  const pkg = readPackageJson(appRoot)
  const composer = readComposerJson(appRoot)
  const { files } = walkFiles(appRoot, SOURCE_EXTENSIONS, ignoreRules)
  const ctx: AdapterContext = { rootPath: appRoot, pkg, composer, candidateFiles: files, ignoreRules }
  const { adapter, match } = detectProject(ctx)
  const pages = adapter.findPages(ctx, match)
  const components = adapter.findComponents(ctx, match, pages)
  const local = buildProjectModel(projectId, appRoot, pages, components, resolveStyleTokens(appRoot, pkg), match.phpFramework ?? match.framework)
  const designSystem = local.designSystem!
  const pageIds = new Map(local.pages.map((item) => [item.id, prefixId(application.id, item.id)]))
  const componentIds = new Map(local.components.map((item) => [item.id, prefixId(application.id, item.id)]))
  const tokenIds = new Map(local.tokens.map((item) => [item.id, prefixId(application.id, item.id)]))
  const routeIds = new Map(local.routes.map((item) => [item.id, prefixId(application.id, item.id)]))
  const mapSource = <T extends { filePath: string }>(source: T): T => ({ ...source, filePath: prefixFile(application.rootPath, source.filePath) })
  const mapStructure = (items: typeof local.pages[number]['structure']): typeof items => items.map((item) => ({ ...item, sourceFilePath: item.sourceFilePath ? prefixFile(application.rootPath, item.sourceFilePath) : undefined, children: mapStructure(item.children) }))
  const pagesOut = local.pages.map((item) => ({ ...item, id: pageIds.get(item.id)!, applicationId: application.id, routeId: item.routeId ? routeIds.get(item.routeId) ?? null : null, source: mapSource(item.source), structure: mapStructure(item.structure), states: item.states.map((state) => ({ ...state, id: prefixId(application.id, state.id), pageId: pageIds.get(state.pageId)! })) }))
  const componentsOut = local.components.map((item) => ({ ...item, id: componentIds.get(item.id)!, applicationId: application.id, source: mapSource(item.source) }))
  return {
    ...local,
    projectId,
    pages: pagesOut,
    components: componentsOut,
    tokens: local.tokens.map((item) => ({ ...item, id: tokenIds.get(item.id)! })),
    routes: local.routes.map((item) => ({ ...item, id: routeIds.get(item.id)!, pageId: pageIds.get(item.pageId)!, source: mapSource(item.source) })),
    areas: local.areas.map((item) => ({ ...item, id: prefixId(application.id, item.id), pageIds: item.pageIds.map((id) => pageIds.get(id)!) })),
    interactions: local.interactions.map((item) => ({ ...item, sourcePageId: pageIds.get(item.sourcePageId)!, destinationPageId: item.destinationPageId ? pageIds.get(item.destinationPageId) ?? null : null, source: mapSource(item.source) })),
    diagnostics: local.diagnostics.map((item) => ({ ...item, pageId: pageIds.get(item.pageId) ?? prefixId(application.id, item.pageId), source: mapSource(item.source) })),
    designSystem: {
      ...designSystem,
      components: designSystem.components.map((item) => ({ ...item, componentId: componentIds.get(item.componentId)!, tokenIds: item.tokenIds.map((id) => tokenIds.get(id) ?? id), relatedComponentIds: item.relatedComponentIds.map((id) => componentIds.get(id) ?? id), usages: item.usages.map((usage) => ({ ...usage, pageId: pageIds.get(usage.pageId)!, source: mapSource(usage.source) })) })),
      observations: designSystem.observations.map((item) => ({ ...item, pageIds: item.pageIds.map((id) => pageIds.get(id) ?? id), sources: item.sources.map(mapSource) })),
      patterns: designSystem.patterns.map((item) => ({ ...item, pageIds: item.pageIds.map((id) => pageIds.get(id) ?? id), componentIds: item.componentIds.map((id) => componentIds.get(id) ?? id) })),
      findings: designSystem.findings.map((item) => ({ ...item, pageIds: item.pageIds.map((id) => pageIds.get(id) ?? id), componentIds: item.componentIds.map((id) => componentIds.get(id) ?? id), sources: item.sources.map(mapSource) })),
    },
  }
}

export const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.astro', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.otf', ...MARKUP_EXTENSIONS]

/** The one piece of framework-agnostic derived state that doesn't vary per
 * adapter today — kept as a shared function rather than duplicated across
 * seven adapters. */
function deriveLanguage(framework: ProjectIndex['framework'], hasTsconfig: boolean, candidateFiles: string[]): Language {
  if (framework === 'php') return hasTsconfig || candidateFiles.some((file) => /\.[jt]sx?$/.test(file)) ? 'mixed' : 'php'
  if (framework === 'static') return 'html'
  if (framework === 'react' || framework === 'vue' || framework === 'svelte') return hasTsconfig ? 'typescript' : 'javascript'
  if (framework === 'astro') return 'mixed'
  if (framework === 'node') return hasTsconfig ? 'typescript' : 'javascript'
  return 'unknown'
}

export function indexProject(projectId: string, rootPath: string, onProgress?: (step: IndexProgressStep) => void): ProjectIndex {
  const startedAt = Date.now()
  const ignoreRules = createIgnoreRules()
  const pkg = readPackageJson(rootPath)
  const composer = readComposerJson(rootPath)

  // Walk once and use the same bounded, ignored source set for detection,
  // page discovery and component discovery. Server templates commonly live
  // outside `src` (resources/views, app/Views, views), so scanning only the
  // React source root made them impossible to index.
  const { files: candidateFiles, scannedFileCount } = walkFiles(rootPath, SOURCE_EXTENSIONS, ignoreRules)

  const ctx: AdapterContext = { rootPath, pkg, composer, candidateFiles, ignoreRules }
  const { adapter, match } = detectProject(ctx)
  onProgress?.('detecting')

  const pages = adapter.findPages(ctx, match)
  onProgress?.('pages')
  const components = adapter.findComponents(ctx, match, pages)
  onProgress?.('components')

  const hasTsconfig = fs.existsSync(path.join(rootPath, 'tsconfig.json'))
  const language = deriveLanguage(match.framework, hasTsconfig, candidateFiles)

  const styleTokens = resolveStyleTokens(rootPath, pkg)
  onProgress?.('tokens')
  let projectModel = buildProjectModel(projectId, rootPath, pages, components, styleTokens, match.phpFramework ?? match.framework)
  onProgress?.('model')

  const supportLevel =
    match.framework !== 'unknown' && pages.length > 0
      ? 'supported'
      : match.framework !== 'unknown'
        ? 'partial'
        : 'inspect-only'

  const { files: metadata } = walkFileMetadata(rootPath, SOURCE_EXTENSIONS, ignoreRules)
  const indexedFiles = Object.fromEntries(metadata.map((file) => [file.relativePath, { path: file.relativePath, mtimeMs: file.mtimeMs, size: file.size }]))
  const configurationFingerprint = crypto.createHash('sha1').update([
    pkg ? JSON.stringify(pkg.raw) : '', composer ? JSON.stringify(composer.raw) : '', match.framework, match.bundler,
  ].join('\u0000')).digest('hex')
  const capability = capabilitiesFor(match)
  const applications = discoverApplications(rootPath, candidateFiles)
  const activeApplication = applications.find((item) => item.kind === 'application') ?? applications[0]
  if (activeApplication && (applications.filter((item) => item.kind === 'application').length > 1 || projectModel.pages.length === 0)) {
    projectModel = indexApplicationModel(projectId, rootPath, activeApplication)
  }
  const index: ProjectIndex = {
    projectId,
    rootPath,
    supportLevel,
    capabilityLevel: capability.level,
    capabilities: capability.capabilities,
    framework: match.framework,
    phpFramework: match.phpFramework,
    language,
    bundler: match.bundler,
    routerStyle: match.routerStyle,
    devCommand: match.devCommand,
    projectModel,
    applications,
    activeApplicationId: activeApplication?.id ?? null,
    indexedApplicationId: activeApplication?.id ?? null,
    files: indexedFiles,
    cacheVersion: 2,
    parserVersion: 'frameui-indexer-v4',
    configurationFingerprint,
    scannedFileCount,
    scanDurationMs: Date.now() - startedAt,
    scannedAt: new Date().toISOString(),
  }
  onProgress?.('dependencies')
  index.dependencyGraph = buildDependencyGraph(rootPath, metadata.map((file) => file.relativePath), index)
  onProgress?.('done')
  return index
}
