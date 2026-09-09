import crypto from 'node:crypto'
import type { Feature, FeatureStatus } from '@shared/types/model/featureModel'
import { getFeaturesFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'
import * as flowStore from './flowStore'
import * as screenDraftStore from './screenDraftStore'
import * as conceptComponentStore from './conceptComponentStore'
import * as featurePageStore from './featurePageStore'
import * as designStateStore from './designStateStore'
import * as journeyStore from './journeyStore'
import * as sharePreviewStore from './sharePreviewStore'
import * as featureWorkPackageStore from './featureWorkPackageStore'

function readAll(userDataPath: string, projectId: string): Feature[] {
  return readJsonFile<Feature[]>(getFeaturesFile(userDataPath, projectId), []).map((feature) => ({
    ...feature,
    status: feature.status ?? 'concept',
    owner: feature.owner ?? null,
    reviewers: feature.reviewers ?? [],
    dueDate: feature.dueDate ?? null,
    externalTicketRef: feature.externalTicketRef ?? null,
    pageIds: feature.pageIds ?? [],
    referenceOnlyPageIds: feature.referenceOnlyPageIds ?? [],
    newPageIds: feature.newPageIds ?? [],
    componentIds: feature.componentIds ?? [],
  }))
}

function writeAll(userDataPath: string, projectId: string, features: Feature[]): void {
  writeJsonFileAtomic(getFeaturesFile(userDataPath, projectId), features)
}

export function listFeatures(userDataPath: string, projectId: string): Feature[] {
  return readAll(userDataPath, projectId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function getFeature(userDataPath: string, projectId: string, featureId: string): Feature | null {
  return readAll(userDataPath, projectId).find((f) => f.id === featureId) ?? null
}

export function createFeature(userDataPath: string, projectId: string, name: string, description: string): Feature {
  const now = new Date().toISOString()
  const feature: Feature = {
    id: crypto.randomUUID(),
    projectId,
    name,
    description,
    status: 'concept',
    owner: null,
    reviewers: [],
    dueDate: null,
    externalTicketRef: null,
    pageIds: [],
    referenceOnlyPageIds: [],
    newPageIds: [],
    componentIds: [],
    createdAt: now,
    updatedAt: now,
  }
  const features = readAll(userDataPath, projectId)
  features.push(feature)
  writeAll(userDataPath, projectId, features)
  return feature
}

/** Replaces the stored feature with `updated` (matched by id), stamping a
 * fresh updatedAt. Throws if the feature doesn't exist — callers always
 * save a feature they first loaded via getFeature/createFeature/listFeatures. */
export function saveFeature(userDataPath: string, updated: Feature): Feature {
  const features = readAll(userDataPath, updated.projectId)
  const index = features.findIndex((f) => f.id === updated.id)
  if (index === -1) {
    throw new Error(`Feature ${updated.id} not found in project ${updated.projectId}`)
  }
  const saved: Feature = { ...updated, updatedAt: new Date().toISOString() }
  features[index] = saved
  writeAll(userDataPath, updated.projectId, features)
  return saved
}

export function setFeatureStatus(userDataPath: string, projectId: string, featureId: string, status: FeatureStatus): Feature {
  const feature = getFeature(userDataPath, projectId, featureId)
  if (!feature) throw new Error(`Feature ${featureId} not found in project ${projectId}`)
  return saveFeature(userDataPath, { ...feature, status })
}

/** Deletes a Feature and cascades to everything scoped under it — its
 * Flows (Journeys), their Screen Drafts, and its Concept Components —
 * so "Feature deletion with confirmation" never leaves orphaned data behind
 * in the other per-project stores. */
export function deleteFeature(userDataPath: string, projectId: string, featureId: string): void {
  const features = readAll(userDataPath, projectId).filter((f) => f.id !== featureId)
  writeAll(userDataPath, projectId, features)

  const flows = flowStore.listFlowsFull(userDataPath, projectId).filter((flow) => flow.featureId === featureId)
  for (const flow of flows) {
    for (const node of flow.nodes) {
      screenDraftStore.deleteScreenDraft(userDataPath, projectId, node.id)
    }
    flowStore.deleteFlow(userDataPath, projectId, flow.id)
  }
  conceptComponentStore.deleteAllForFeature(userDataPath, projectId, featureId)
  // designStateStore's cascade already handles each state's own tree plus
  // any Alternatives built on top of it.
  designStateStore.deleteAllForFeature(userDataPath, projectId, featureId)
  featurePageStore.deleteAllForFeature(userDataPath, projectId, featureId)
  journeyStore.deleteAllForFeature(userDataPath, projectId, featureId)
  sharePreviewStore.deleteAllForFeature(userDataPath, projectId, featureId)
  featureWorkPackageStore.deleteAllForFeature(userDataPath, projectId, featureId)
}
