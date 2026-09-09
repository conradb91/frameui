import type { Annotation, DesignOperation, Feature, FeatureVersionManifest, FeatureWorkPackage, Version, VersionDifference } from '@shared/types/model/featureModel'
import { compareOperationSets } from '@core/design-model/operations'
import { makeStableId } from '@core/design-model/id'
import { getFeatureWorkPackagesFile, getFeaturesFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'
import * as designStateStore from './designStateStore'
import * as alternativeStore from './alternativeStore'
import * as conceptComponentStore from './conceptComponentStore'
import * as journeyStore from './journeyStore'

function readAll(userDataPath: string, projectId: string): FeatureWorkPackage[] {
  return readJsonFile<FeatureWorkPackage[]>(getFeatureWorkPackagesFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, packages: FeatureWorkPackage[]): void {
  writeJsonFileAtomic(getFeatureWorkPackagesFile(userDataPath, projectId), packages)
}

function empty(projectId: string, featureId: string): FeatureWorkPackage {
  return { schemaVersion: 1, projectId, featureId, annotations: [], versions: [], operationPool: {}, workingOperationRevisionIds: {}, baselineOwnerIds: [], updatedAt: new Date().toISOString() }
}

/** Reading old Phase 0-25 projects is a safe lazy migration: absence of a
 * package means all existing DesignTree records are preserved as baselines. */
export function getPackage(userDataPath: string, projectId: string, featureId: string): FeatureWorkPackage {
  return readAll(userDataPath, projectId).find((item) => item.featureId === featureId) ?? empty(projectId, featureId)
}

function savePackage(userDataPath: string, value: FeatureWorkPackage): FeatureWorkPackage {
  const packages = readAll(userDataPath, value.projectId)
  const saved = { ...value, schemaVersion: 1 as const, updatedAt: new Date().toISOString() }
  const index = packages.findIndex((item) => item.featureId === value.featureId)
  if (index < 0) packages.push(saved)
  else packages[index] = saved
  writeAll(userDataPath, value.projectId, packages)
  return saved
}

export function markBaseline(userDataPath: string, projectId: string, featureId: string, ownerId: string): FeatureWorkPackage {
  const value = getPackage(userDataPath, projectId, featureId)
  if (value.baselineOwnerIds.includes(ownerId)) return value
  return savePackage(userDataPath, { ...value, baselineOwnerIds: [...value.baselineOwnerIds, ownerId] })
}

export function getOperations(userDataPath: string, projectId: string, featureId: string, ownerId: string): DesignOperation[] {
  const value = getPackage(userDataPath, projectId, featureId)
  return (value.workingOperationRevisionIds[ownerId] ?? []).flatMap((id) => value.operationPool[id] ? [value.operationPool[id]] : [])
}

export function saveOperations(userDataPath: string, projectId: string, featureId: string, ownerId: string, operations: DesignOperation[]): DesignOperation[] {
  const value = getPackage(userDataPath, projectId, featureId)
  const pool = { ...value.operationPool }
  for (const operation of operations) pool[operation.revisionId] = operation
  const workingOperationRevisionIds = { ...value.workingOperationRevisionIds, [ownerId]: operations.map((operation) => operation.revisionId) }
  // Drop obsolete composed revisions unless a named version still points
  // at them. This is structural sharing without an ever-growing edit log.
  const referenced = new Set([
    ...Object.values(workingOperationRevisionIds).flat(),
    ...value.versions.flatMap((version) => Object.values(version.operationRevisionIds).flat()),
  ])
  const compactPool = Object.fromEntries(Object.entries(pool).filter(([revisionId]) => referenced.has(revisionId)))
  savePackage(userDataPath, {
    ...value,
    operationPool: compactPool,
    workingOperationRevisionIds,
    baselineOwnerIds: value.baselineOwnerIds.includes(ownerId) ? value.baselineOwnerIds : [...value.baselineOwnerIds, ownerId],
  })
  return operations
}

export function deleteOwner(userDataPath: string, projectId: string, featureId: string, ownerId: string): void {
  const value = getPackage(userDataPath, projectId, featureId)
  const working = { ...value.workingOperationRevisionIds }
  delete working[ownerId]
  // Keep pooled revisions referenced by versions; only detach live work.
  savePackage(userDataPath, { ...value, workingOperationRevisionIds: working, baselineOwnerIds: value.baselineOwnerIds.filter((id) => id !== ownerId) })
}

export function listAnnotations(userDataPath: string, projectId: string, featureId: string): Annotation[] {
  return getPackage(userDataPath, projectId, featureId).annotations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function saveAnnotation(userDataPath: string, projectId: string, annotation: Annotation): Annotation {
  const value = getPackage(userDataPath, projectId, annotation.featureId)
  const index = value.annotations.findIndex((item) => item.id === annotation.id)
  const now = new Date().toISOString()
  const saved = { ...annotation, updatedAt: now }
  const annotations = [...value.annotations]
  if (index < 0) annotations.push(saved)
  else annotations[index] = saved
  savePackage(userDataPath, { ...value, annotations })
  return saved
}

export function deleteAnnotation(userDataPath: string, projectId: string, featureId: string, annotationId: string): void {
  const value = getPackage(userDataPath, projectId, featureId)
  savePackage(userDataPath, { ...value, annotations: value.annotations.filter((item) => item.id !== annotationId) })
}

function revisionMap(value: FeatureWorkPackage): Record<string, string[]> {
  return Object.fromEntries(Object.entries(value.workingOperationRevisionIds).map(([owner, ids]) => [owner, [...ids]]))
}

function buildManifest(userDataPath: string, projectId: string, featureId: string, value: FeatureWorkPackage): FeatureVersionManifest {
  const feature = readJsonFile<Feature[]>(getFeaturesFile(userDataPath, projectId), []).find((item) => item.id === featureId)
  if (!feature) throw new Error(`Feature ${featureId} not found`)
  const designStates = designStateStore.listDesignStatesForFeature(userDataPath, projectId, featureId)
  return {
    feature: { name: feature.name, description: feature.description, status: feature.status, owner: feature.owner, reviewers: feature.reviewers, dueDate: feature.dueDate, externalTicketRef: feature.externalTicketRef, pageIds: feature.pageIds, referenceOnlyPageIds: feature.referenceOnlyPageIds, newPageIds: feature.newPageIds, componentIds: feature.componentIds },
    designStates,
    alternatives: designStates.flatMap((state) => alternativeStore.listAlternativesForState(userDataPath, projectId, state.id)),
    conceptComponents: conceptComponentStore.listConceptComponents(userDataPath, projectId, featureId),
    journeys: journeyStore.listJourneys(userDataPath, projectId, featureId),
    reviewItemIds: value.annotations.map((item) => item.id),
    baselineOwnerIds: [...value.baselineOwnerIds],
  }
}

export function createVersion(userDataPath: string, projectId: string, featureId: string, name: string, createdBy: string, sourceBaselineRef: string | null = null, restoredFromVersionId: string | null = null): Version {
  const value = getPackage(userDataPath, projectId, featureId)
  const version: Version = {
    id: makeStableId('version', [name], value.versions.map((item) => item.id)),
    featureId,
    name,
    createdAt: new Date().toISOString(),
    createdBy,
    sourceBaselineRef,
    operationRevisionIds: revisionMap(value),
    restoredFromVersionId,
    manifest: buildManifest(userDataPath, projectId, featureId, value),
  }
  savePackage(userDataPath, { ...value, versions: [...value.versions, version] })
  return version
}

export function listVersions(userDataPath: string, projectId: string, featureId: string): Version[] {
  return [...getPackage(userDataPath, projectId, featureId).versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function renameVersion(userDataPath: string, projectId: string, featureId: string, versionId: string, name: string): Version {
  const value = getPackage(userDataPath, projectId, featureId)
  const current = value.versions.find((item) => item.id === versionId)
  if (!current) throw new Error(`Version ${versionId} not found`)
  const saved = { ...current, name }
  savePackage(userDataPath, { ...value, versions: value.versions.map((item) => item.id === versionId ? saved : item) })
  return saved
}

export function restoreVersion(userDataPath: string, projectId: string, featureId: string, versionId: string, createdBy: string): Version {
  const value = getPackage(userDataPath, projectId, featureId)
  const source = value.versions.find((item) => item.id === versionId)
  if (!source) throw new Error(`Version ${versionId} not found`)
  const restoredValue = savePackage(userDataPath, { ...value, workingOperationRevisionIds: Object.fromEntries(Object.entries(source.operationRevisionIds).map(([owner, ids]) => [owner, [...ids]])) })
  const restored: Version = {
    id: makeStableId('version', [`Restored from ${source.name}`], restoredValue.versions.map((item) => item.id)),
    featureId,
    name: `Restored from ${source.name}`,
    createdAt: new Date().toISOString(),
    createdBy,
    sourceBaselineRef: source.sourceBaselineRef,
    operationRevisionIds: revisionMap(restoredValue),
    restoredFromVersionId: source.id,
    manifest: source.manifest,
  }
  savePackage(userDataPath, { ...restoredValue, versions: [...restoredValue.versions, restored] })
  return restored
}

export function duplicateVersion(userDataPath: string, projectId: string, featureId: string, versionId: string, createdBy: string): Version {
  const value = getPackage(userDataPath, projectId, featureId)
  const source = value.versions.find((item) => item.id === versionId)
  if (!source) throw new Error(`Version ${versionId} not found`)
  const copiedValue = savePackage(userDataPath, { ...value, workingOperationRevisionIds: Object.fromEntries(Object.entries(source.operationRevisionIds).map(([owner, ids]) => [owner, [...ids]])) })
  const duplicate: Version = { ...source, id: makeStableId('version', [`Copy of ${source.name}`], copiedValue.versions.map((item) => item.id)), name: `Copy of ${source.name}`, createdAt: new Date().toISOString(), createdBy, restoredFromVersionId: source.id, operationRevisionIds: revisionMap(copiedValue), manifest: source.manifest }
  savePackage(userDataPath, { ...copiedValue, versions: [...copiedValue.versions, duplicate] })
  return duplicate
}

function operationsForVersion(value: FeatureWorkPackage, version: Version | null): DesignOperation[] {
  const references = version ? Object.values(version.operationRevisionIds).flat() : Object.values(value.workingOperationRevisionIds).flat()
  return references.flatMap((id) => value.operationPool[id] ? [value.operationPool[id]] : [])
}

export function compareVersions(userDataPath: string, projectId: string, featureId: string, leftVersionId: string | null, rightVersionId: string | null): VersionDifference[] {
  const value = getPackage(userDataPath, projectId, featureId)
  const find = (id: string | null) => id ? value.versions.find((item) => item.id === id) ?? null : null
  const left = find(leftVersionId)
  const right = find(rightVersionId)
  const differences = compareOperationSets(operationsForVersion(value, left), operationsForVersion(value, right))
  const currentManifest = () => buildManifest(userDataPath, projectId, featureId, value)
  const before = left?.manifest ?? currentManifest()
  const after = right?.manifest ?? currentManifest()
  const compareIds = (label: string, a: string[], b: string[]) => {
    for (const id of b.filter((item) => !a.includes(item))) differences.push({ operationId: `manifest:${label}:${id}`, kind: 'added', summary: `${label} added: ${id}`, operationType: label === 'State' ? 'change-state' : 'create', ownerId: featureId })
    for (const id of a.filter((item) => !b.includes(item))) differences.push({ operationId: `manifest:${label}:${id}`, kind: 'removed', summary: `${label} removed: ${id}`, operationType: label === 'State' ? 'change-state' : 'delete', ownerId: featureId })
  }
  compareIds('Page', [...before.feature.pageIds, ...before.feature.newPageIds], [...after.feature.pageIds, ...after.feature.newPageIds])
  compareIds('State', before.designStates.map((item) => item.id), after.designStates.map((item) => item.id))
  compareIds('Component', before.conceptComponents.map((item) => item.id), after.conceptComponents.map((item) => item.id))
  return differences
}

export function deleteAllForFeature(userDataPath: string, projectId: string, featureId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((item) => item.featureId !== featureId))
}
