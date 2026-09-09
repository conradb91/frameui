import type { Alternative } from '@shared/types/model/featureModel'
import { makeStableId } from '@core/design-model/id'
import { getAlternativesFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'
import * as designTreeStore from './designTreeStore'

function readAll(userDataPath: string, projectId: string): Alternative[] {
  return readJsonFile<Alternative[]>(getAlternativesFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, alternatives: Alternative[]): void {
  writeJsonFileAtomic(getAlternativesFile(userDataPath, projectId), alternatives)
}

export function listAlternativesForState(userDataPath: string, projectId: string, designStateId: string): Alternative[] {
  return readAll(userDataPath, projectId).filter((a) => a.designStateId === designStateId)
}

export function getAlternative(userDataPath: string, projectId: string, alternativeId: string): Alternative | null {
  return readAll(userDataPath, projectId).find((a) => a.id === alternativeId) ?? null
}

/** Duplicates the design state's *current working tree* (or another
 * alternative's tree, when `sourceAlternativeId` is given) as a brand-new,
 * fully independent Alternative — spec Phase 19: "Do not require the
 * designer to duplicate an entire Feature just to test another design." */
export function createAlternative(
  userDataPath: string,
  projectId: string,
  input: { featureId: string; designStateId: string; designStateSlugHint: string; name: string; sourceOwnerId: string },
): Alternative {
  const alternatives = readAll(userDataPath, projectId)
  const now = new Date().toISOString()
  const alternative: Alternative = {
    id: makeStableId(
      'alternative',
      [input.designStateSlugHint, input.name],
      alternatives.map((a) => a.id),
    ),
    featureId: input.featureId,
    designStateId: input.designStateId,
    name: input.name,
    isPreferred: false,
    isApproved: false,
    createdAt: now,
    updatedAt: now,
  }
  alternatives.push(alternative)
  writeAll(userDataPath, projectId, alternatives)

  const sourceTree = designTreeStore.getDesignTree(userDataPath, projectId, input.sourceOwnerId)
  if (sourceTree) {
    designTreeStore.saveDesignTree(userDataPath, { ownerId: alternative.id, projectId, tree: sourceTree.tree, updatedAt: now })
  }
  return alternative
}

export function saveAlternative(userDataPath: string, projectId: string, updated: Alternative): Alternative {
  const alternatives = readAll(userDataPath, projectId)
  const index = alternatives.findIndex((a) => a.id === updated.id)
  if (index === -1) throw new Error(`Alternative ${updated.id} not found in project ${projectId}`)
  const saved: Alternative = { ...updated, updatedAt: new Date().toISOString() }
  alternatives[index] = saved
  writeAll(userDataPath, projectId, alternatives)
  return saved
}

/** Setting one Alternative preferred/approved clears the flag on its
 * siblings (same `designStateId`) — "preferred"/"approved" are meant to be
 * singular choices per state, not independent checkboxes that could all end
 * up true at once. */
export function setPreferred(userDataPath: string, projectId: string, alternativeId: string): Alternative {
  const alternatives = readAll(userDataPath, projectId)
  const target = alternatives.find((a) => a.id === alternativeId)
  if (!target) throw new Error(`Alternative ${alternativeId} not found in project ${projectId}`)
  const now = new Date().toISOString()
  for (const a of alternatives) {
    if (a.designStateId === target.designStateId) {
      a.isPreferred = a.id === alternativeId
      a.updatedAt = now
    }
  }
  writeAll(userDataPath, projectId, alternatives)
  return alternatives.find((a) => a.id === alternativeId)!
}

export function setApproved(userDataPath: string, projectId: string, alternativeId: string): Alternative {
  const alternatives = readAll(userDataPath, projectId)
  const target = alternatives.find((a) => a.id === alternativeId)
  if (!target) throw new Error(`Alternative ${alternativeId} not found in project ${projectId}`)
  const now = new Date().toISOString()
  for (const a of alternatives) {
    if (a.designStateId === target.designStateId) {
      a.isApproved = a.id === alternativeId
      a.updatedAt = now
    }
  }
  writeAll(userDataPath, projectId, alternatives)
  return alternatives.find((a) => a.id === alternativeId)!
}

export function deleteAlternative(userDataPath: string, projectId: string, alternativeId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((a) => a.id !== alternativeId))
  designTreeStore.deleteDesignTree(userDataPath, projectId, alternativeId)
}
