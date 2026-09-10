import fs from 'node:fs'
import { adapterNeedsReimport } from '@core/adapters/registry'
import path from 'node:path'
import type { FileChange, IndexedFile, IndexProgressStep, IndexUpdateSummary, ProjectIndex } from '@shared/types/projectIndex'
import { readJsonFile, writeJsonFileAtomic } from '@core/workspace/atomicJson'
import { getProjectIndexFile } from '@core/workspace/paths'
import { listFeatures } from '@core/workspace/models/featureStore'
import { indexApplicationModel, indexProject, sourceExtensions } from './indexProject'
import { createIgnoreRules } from './ignore'
import { walkFileMetadata } from './walkFiles'
import { affectedFiles, buildDependencyGraph, updateDependencyGraph } from './dependencyGraph'
import { isBuildOrRouteConfiguration, isStyleFile, applicationMetadata } from './projectCapabilities'
import { refreshProjectPage, styleTokensToModel } from '@core/design-model/buildProjectModel'
import { resolveStyleTokens } from '@core/adapters/tailwind/resolveStyleTokens'
import { readPackageJson } from '@core/adapters/shared/packageJson'
import { IdRegistry, makeStableId } from '@core/design-model/id'
import type { Page } from '@shared/types/model/projectModel'
import * as featureWorkPackages from '@core/workspace/models/featureWorkPackageStore'
import crypto from 'node:crypto'
import * as designStateStore from '@core/workspace/models/designStateStore'
import * as designTreeStore from '@core/workspace/models/designTreeStore'
import * as alternativeStore from '@core/workspace/models/alternativeStore'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'
import { rebaseFeatureOperations, sourceValueKey } from '@core/source-conflicts/rebaseFeatureOperations'
import type { DesignNode } from '@shared/types/designNode'
import type { DesignOperation, SourceConflict } from '@shared/types/model/featureModel'

export const PROJECT_INDEX_CACHE_SCHEMA = 2
const PARSER_VERSION = 'frameui-indexer-v5'
const normalize = (value: string) => value.split(path.sep).join('/')

function metadata(rootPath: string, absolutePath: string): IndexedFile | null {
  try {
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile()) return null
    const relative = normalize(path.relative(rootPath, absolutePath))
    return { path: relative, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch { return null }
}

function changesSince(cached: ProjectIndex, current: IndexedFile[]): FileChange[] {
  const previous = cached.files ?? {}
  const next = new Map(current.map((file) => [file.path, file]))
  const changes: FileChange[] = []
  for (const file of current) {
    const before = previous[file.path]
    if (!before) changes.push({ path: file.path, kind: 'created' })
    else if (before.mtimeMs !== file.mtimeMs || before.size !== file.size) changes.push({ path: file.path, kind: 'modified' })
  }
  for (const oldPath of Object.keys(previous)) if (!next.has(oldPath)) changes.push({ path: oldPath, kind: 'deleted' })
  return changes
}

function looksLikePage(filePath: string): boolean {
  return /(?:^|\/)(?:pages?|routes?|views?|app)(?:\/|$)/i.test(filePath) && /\.(?:tsx?|jsx?|vue|svelte|astro|php|html?)$/i.test(filePath)
}
function looksLikeComponent(filePath: string): boolean {
  return /(?:^|\/)(?:components?|ui)(?:\/|$)/i.test(filePath) && /\.(?:tsx?|jsx?|vue|svelte|astro|php)$/i.test(filePath)
}
function objectName(filePath: string): string {
  return path.basename(filePath).replace(/\.(?:blade\.)?[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
function routeFor(filePath: string): string | null {
  const match = filePath.match(/(?:^|\/)(?:pages?|routes?|app)\/(.+)\.(?:tsx?|jsx?|vue|svelte|astro|php|html?)$/i)
  if (!match) return null
  const route = match[1].replace(/\/(?:page|index)$/i, '').replace(/\[(?:\.\.\.)?([^\]]+)\]/g, ':$1').replace(/\/index$/i, '')
  return `/${route}`.replace(/\/+$/, '') || '/'
}

function findDesignNode(node: DesignNode, id: string): DesignNode | null {
  if (node.id === id) return node
  for (const child of node.children) { const found = findDesignNode(child, id); if (found) return found }
  return null
}

function propertyValue(node: DesignNode, property: string | null): unknown {
  if (!property) return node
  let value: unknown = node
  for (const segment of property.split('.')) {
    if (!value || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

function sourcePaths(node: DesignNode, result = new Map<string, string>()): Map<string, string> {
  if ('sourceReference' in node && node.sourceReference?.filePath) result.set(node.id, node.sourceReference.filePath)
  for (const child of node.children) sourcePaths(child, result)
  return result
}

interface PendingSourceRebase { ownerId: string; tree: DesignNode; operations: DesignOperation[]; conflicts: SourceConflict[] }

function rebaseAffectedFeature(userDataPath: string, projectId: string, featureId: string, affectedPageIds: string[], pages: Page[], sourceBaselineRef: string): void {
  const pending: PendingSourceRebase[] = []
  const states = designStateStore.listDesignStatesForFeature(userDataPath, projectId, featureId).filter((state) => state.pageRef.kind === 'existing' && affectedPageIds.includes(state.pageRef.pageId))
  for (const state of states) {
    const page = pages.find((item) => item.id === state.pageRef.pageId)
    if (!page) continue
    const owners = [state.id, ...alternativeStore.listAlternativesForState(userDataPath, projectId, state.id).map((item) => item.id)]
    for (const ownerId of owners) {
      const baseline = designTreeStore.getDesignTree(userDataPath, projectId, ownerId)
      if (!baseline) continue
      const currentTree = buildExistingPageDraftTree(baseline.tree.id, page.structure, page.source.filePath)
      const operations = featureWorkPackages.getOperations(userDataPath, projectId, featureId, ownerId)
      const values = new Map<string, unknown>()
      for (const operation of operations) {
        const node = findDesignNode(currentTree, operation.targetNodeId)
        if (node) values.set(sourceValueKey(operation), propertyValue(node, operation.property))
      }
      const result = rebaseFeatureOperations(featureId, operations, values, sourcePaths(currentTree))
      pending.push({ ownerId, tree: currentTree, operations: result.operations, conflicts: result.conflicts })
    }
  }
  const conflicts = pending.flatMap((item) => item.conflicts)
  if (conflicts.length) featureWorkPackages.createVersion(userDataPath, projectId, featureId, `Before source rebase ${new Date().toLocaleString()}`, 'FrameUI', sourceBaselineRef)
  for (const item of pending) {
    designTreeStore.saveDesignTree(userDataPath, { ownerId: item.ownerId, projectId, tree: item.tree, updatedAt: new Date().toISOString() })
    featureWorkPackages.saveOperations(userDataPath, projectId, featureId, item.ownerId, item.operations)
  }
  if (conflicts.length) {
    const existing = featureWorkPackages.listSourceConflicts(userDataPath, projectId, featureId)
    featureWorkPackages.saveSourceConflicts(userDataPath, projectId, featureId, [...existing.filter((item) => !conflicts.some((conflict) => conflict.operationId && conflict.operationId === item.operationId && item.resolution === 'unresolved')), ...conflicts], sourceBaselineRef)
  }
}

export class ProjectIndexService {
  private index: ProjectIndex | null = null
  constructor(private userDataPath: string, private projectId: string, private rootPath: string) {}

  get cached(): ProjectIndex | null { return this.index }

  selectApplication(applicationId: string): ProjectIndex {
    if (!this.index) this.load()
    if (!this.index?.applications?.some((item) => item.id === applicationId)) throw new Error(`Application ${applicationId} not found`)
    const application = this.index.applications!.find((item) => item.id === applicationId)!
    const projectModel = this.index.indexedApplicationId === applicationId ? this.index.projectModel : indexApplicationModel(this.projectId, this.rootPath, application)
    const dependencyGraph = buildDependencyGraph(this.rootPath, Object.keys(this.index.files ?? {}), { projectModel })
    this.index = { ...this.index, activeApplicationId: applicationId, indexedApplicationId: applicationId, ...applicationMetadata(application), projectModel, dependencyGraph }
    writeJsonFileAtomic(getProjectIndexFile(this.userDataPath, this.projectId), this.index, PROJECT_INDEX_CACHE_SCHEMA)
    return this.index
  }

  load(onProgress?: (step: IndexProgressStep) => void): ProjectIndex {
    onProgress?.('validating-cache')
    const persisted = readJsonFile<ProjectIndex | null>(getProjectIndexFile(this.userDataPath, this.projectId), null, PROJECT_INDEX_CACHE_SCHEMA)
    if (!persisted || persisted.parserVersion !== PARSER_VERSION || persisted.rootPath !== this.rootPath) return this.rebuild(onProgress, 'initial')
    const walked = walkFileMetadata(this.rootPath, sourceExtensions(), createIgnoreRules())
    const current = walked.files.map((file) => ({ path: file.relativePath, mtimeMs: file.mtimeMs, size: file.size }))
    const changes = changesSince(persisted, current)
    this.index = persisted
    if (changes.length === 0) {
      const lastUpdate: IndexUpdateSummary = { mode: 'cache-hit', changedFiles: 0, updatedComponents: 0, affectedPages: 0, affectedFeatureIds: [], invalidatedObjectIds: [], durationMs: 0 }
      this.index = { ...persisted, scannedFileCount: walked.scannedFileCount, lastUpdate }
      onProgress?.('done')
      return this.index
    }
    return changes.some((change) => isBuildOrRouteConfiguration(change.path)) ? this.rebuild(onProgress, 'rebuild') : this.update(changes, onProgress)
  }

  rebuild(onProgress?: (step: IndexProgressStep) => void, mode: 'initial' | 'rebuild' = 'rebuild'): ProjectIndex {
    const started = Date.now()
    const selectedId = this.index?.activeApplicationId
    const next = indexProject(this.projectId, this.rootPath, (step) => { if (step !== 'done') onProgress?.(step) })
    const selected = next.applications?.find((application) => application.id === selectedId)
    if (selected && next.indexedApplicationId !== selected.id) {
      next.projectModel = indexApplicationModel(this.projectId, this.rootPath, selected)
      Object.assign(next, applicationMetadata(selected), { activeApplicationId: selected.id, indexedApplicationId: selected.id })
      next.dependencyGraph = buildDependencyGraph(this.rootPath, Object.keys(next.files ?? {}), next)
    }
    next.lastUpdate = { mode, changedFiles: 0, updatedComponents: next.projectModel.components.length, affectedPages: next.projectModel.pages.length, affectedFeatureIds: [], invalidatedObjectIds: [], durationMs: Date.now() - started }
    this.index = next
    onProgress?.('persisting')
    writeJsonFileAtomic(getProjectIndexFile(this.userDataPath, this.projectId), next, PROJECT_INDEX_CACHE_SCHEMA)
    onProgress?.('done')
    return next
  }

  update(rawChanges: FileChange[], onProgress?: (step: IndexProgressStep) => void): ProjectIndex {
    if (!this.index) return this.load(onProgress)
    if (rawChanges.some((change) => isBuildOrRouteConfiguration(change.path) || adapterNeedsReimport(this.index?.adapterIds ?? [], change.path))) return this.rebuild(onProgress)
    const started = Date.now()
    const changes = rawChanges.map((change) => ({ ...change, path: normalize(path.isAbsolute(change.path) ? path.relative(this.rootPath, change.path) : change.path), previousPath: change.previousPath ? normalize(path.isAbsolute(change.previousPath) ? path.relative(this.rootPath, change.previousPath) : change.previousPath) : undefined }))
    const changedPaths = changes.flatMap((change) => [change.path, ...(change.previousPath ? [change.previousPath] : [])])
    const old = this.index
    const removedObjects = changes.filter((change) => change.kind === 'deleted').flatMap((change) => [
      ...old.projectModel.pages.filter((page) => page.source.filePath === change.path).map((page) => ({ id: page.id, path: change.path })),
      ...old.projectModel.components.filter((component) => component.source.filePath === change.path).map((component) => ({ id: component.id, path: change.path })),
    ])
    const impactFiles = affectedFiles(old.dependencyGraph ?? { fileObjects: {}, dependencies: {}, dependents: {}, objectConsumers: {} }, changedPaths)
    const impactedObjectIds = new Set(impactFiles.flatMap((file) => old.dependencyGraph?.fileObjects[file] ?? []))
    let pages = old.projectModel.pages.filter((page) => !changes.some((change) => change.kind === 'deleted' && page.source.filePath === change.path))
    let components = old.projectModel.components.filter((component) => !changes.some((change) => change.kind === 'deleted' && component.source.filePath === change.path))
    const activeApplication = old.applications?.find((item) => item.id === old.indexedApplicationId)
    const insideActiveApplication = (filePath: string) => !activeApplication || activeApplication.rootPath === '.' || filePath === activeApplication.rootPath || filePath.startsWith(`${activeApplication.rootPath}/`)

    for (const change of changes) {
      const previousPath = change.previousPath
      if (change.kind === 'renamed' && previousPath) {
        pages = pages.map((page) => page.source.filePath === previousPath ? { ...page, source: { ...page.source, filePath: change.path } } : page)
        components = components.map((component) => component.source.filePath === previousPath ? { ...component, source: { ...component.source, filePath: change.path } } : component)
      }
      if (change.kind === 'created' && insideActiveApplication(change.path) && looksLikeComponent(change.path) && !components.some((item) => item.source.filePath === change.path)) {
        const name = objectName(change.path)
        const localId = makeStableId('component', [name], components.map((item) => item.id.split('/').at(-1)!))
        components.push({ id: activeApplication ? `${activeApplication.id}/${localId}` : localId, applicationId: activeApplication?.id, name, exportKind: 'default', source: { filePath: change.path } })
      }
      if (change.kind === 'created' && insideActiveApplication(change.path) && looksLikePage(change.path) && !pages.some((item) => item.source.filePath === change.path)) {
        const name = objectName(change.path)
        const localId = makeStableId('page', [name], pages.map((item) => item.id.split('/').at(-1)!))
        const id = activeApplication ? `${activeApplication.id}/${localId}` : localId
        const route = routeFor(change.path)
        const page: Page = { id, applicationId: activeApplication?.id, name, route, routeId: null, area: 'Application', source: route ? { filePath: change.path, route } : { filePath: change.path }, structure: [], elementCount: 0, componentNames: [], textContent: [], supportedViewports: ['desktop', 'tablet', 'mobile'], states: [], analysisStatus: 'empty' }
        pages.push(refreshProjectPage(this.rootPath, page, components))
      }
    }
    const reparsedPagePaths = new Set(impactFiles.filter((file) => pages.some((page) => page.source.filePath === file)))
    pages = pages.map((page) => reparsedPagePaths.has(page.source.filePath) ? refreshProjectPage(this.rootPath, page, components) : page)

    const files = { ...(old.files ?? {}) }
    for (const change of changes) {
      if (change.previousPath) delete files[change.previousPath]
      const value = metadata(this.rootPath, path.join(this.rootPath, change.path))
      if (value) files[change.path] = value
      else delete files[change.path]
    }
    const styleChanged = changes.some((change) => isStyleFile(change.path))
    const styleRoot = activeApplication ? path.resolve(this.rootPath, activeApplication.rootPath) : this.rootPath
    const refreshedTokens = styleChanged ? styleTokensToModel(resolveStyleTokens(styleRoot, readPackageJson(styleRoot)), new IdRegistry()) : []
    const tokens = styleChanged ? refreshedTokens.map((token) => activeApplication ? { ...token, id: `${activeApplication.id}/${token.id}` } : token) : old.projectModel.tokens
    const projectModel = { ...old.projectModel, generatedAt: new Date().toISOString(), pages, components, tokens, statistics: { ...old.projectModel.statistics, pages: pages.length, components: components.length, tokens: tokens.length } }
    const graph = updateDependencyGraph(this.rootPath, old.dependencyGraph ?? { fileObjects: {}, dependencies: {}, dependents: {}, objectConsumers: {} }, Object.keys(files), changedPaths, { projectModel })
    for (const file of impactFiles) for (const objectId of graph.fileObjects[file] ?? []) impactedObjectIds.add(objectId)
    const affectedPageIds = [...pages.filter((page) => impactedObjectIds.has(page.id) || reparsedPagePaths.has(page.source.filePath)).map((page) => page.id), ...removedObjects.filter((item) => old.projectModel.pages.some((page) => page.id === item.id)).map((item) => item.id)]
    const updatedComponentIds = [...components.filter((component) => changedPaths.includes(component.source.filePath) || impactedObjectIds.has(component.id)).map((component) => component.id), ...removedObjects.map((item) => item.id)]
    const features = listFeatures(this.userDataPath, this.projectId)
    const affectedFeatureIds = features.filter((feature) => feature.pageIds.some((id) => affectedPageIds.includes(id)) || feature.referenceOnlyPageIds.some((id) => affectedPageIds.includes(id)) || feature.componentIds.some((id) => updatedComponentIds.includes(id))).map((feature) => feature.id)
    for (const featureId of affectedFeatureIds) rebaseAffectedFeature(this.userDataPath, this.projectId, featureId, affectedPageIds, pages, old.scannedAt)
    for (const feature of features.filter((item) => affectedFeatureIds.includes(item.id))) {
      const relevantRemoved = removedObjects.filter((object) => feature.pageIds.includes(object.id) || feature.referenceOnlyPageIds.includes(object.id) || feature.componentIds.includes(object.id))
      if (!relevantRemoved.length) continue
      const existing = featureWorkPackages.listSourceConflicts(this.userDataPath, this.projectId, feature.id)
      const additions = relevantRemoved.filter((object) => !existing.some((conflict) => conflict.resolution === 'unresolved' && conflict.targetNodeId === object.id && conflict.kind === 'source-deleted')).map((object) => ({ id: crypto.randomUUID(), featureId: feature.id, operationId: null, ownerId: feature.id, targetNodeId: object.id, property: null, kind: 'source-deleted' as const, baseValue: object.id, currentValue: null, proposedValue: object.id, sourcePath: object.path, resolution: 'unresolved' as const, createdAt: new Date().toISOString(), resolvedAt: null }))
      if (additions.length) {
        featureWorkPackages.createVersion(this.userDataPath, this.projectId, feature.id, `Before source update ${new Date().toLocaleString()}`, 'FrameUI', old.scannedAt)
        featureWorkPackages.saveSourceConflicts(this.userDataPath, this.projectId, feature.id, [...existing, ...additions], old.scannedAt)
      }
    }
    const lastUpdate: IndexUpdateSummary = { mode: 'incremental', changedFiles: changes.length, updatedComponents: updatedComponentIds.length, affectedPages: affectedPageIds.length, affectedFeatureIds, invalidatedObjectIds: [...impactedObjectIds], durationMs: Date.now() - started }
    this.index = { ...old, projectModel, files, dependencyGraph: graph, scannedAt: new Date().toISOString(), scanDurationMs: lastUpdate.durationMs, lastUpdate }
    onProgress?.('persisting')
    writeJsonFileAtomic(getProjectIndexFile(this.userDataPath, this.projectId), this.index, PROJECT_INDEX_CACHE_SCHEMA)
    onProgress?.('done')
    return this.index
  }
}
