import type { DesignState, DesignStateOrigin, PageRef, Provenance } from '@shared/types/model/featureModel'
import { makeStableId, slugify } from '@core/design-model/id'
import { getDesignStatesFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'
import * as designTreeStore from './designTreeStore'
import * as alternativeStore from './alternativeStore'

function readAll(userDataPath: string, projectId: string): DesignState[] {
  return readJsonFile<DesignState[]>(getDesignStatesFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, states: DesignState[]): void {
  writeJsonFileAtomic(getDesignStatesFile(userDataPath, projectId), states)
}

export function listDesignStatesForPage(userDataPath: string, projectId: string, pageRef: PageRef): DesignState[] {
  return readAll(userDataPath, projectId)
    .filter((s) => s.pageRef.kind === pageRef.kind && s.pageRef.pageId === pageRef.pageId)
    .sort((a, b) => a.order - b.order)
}

export function listDesignStatesForFeature(userDataPath: string, projectId: string, featureId: string): DesignState[] {
  return readAll(userDataPath, projectId).filter((s) => s.featureId === featureId)
}

export function getDesignState(userDataPath: string, projectId: string, stateId: string): DesignState | null {
  return readAll(userDataPath, projectId).find((s) => s.id === stateId) ?? null
}

export function createDesignState(
  userDataPath: string,
  projectId: string,
  input: {
    featureId: string
    pageRef: PageRef
    /** Human-readable id fragment for the page side of the composed id
     * (e.g. the page's own name/slug) — callers already know it, avoids
     * this store needing to cross-reference `ProjectModel`/`FeaturePage`
     * just to build an id. */
    pageSlugHint: string
    name: string
    origin: DesignStateOrigin
    capturedPageId: string | null
    provenance: Provenance
  },
): DesignState {
  const states = readAll(userDataPath, projectId)
  const now = new Date().toISOString()
  const siblingCount = states.filter((s) => s.pageRef.kind === input.pageRef.kind && s.pageRef.pageId === input.pageRef.pageId).length
  const state: DesignState = {
    id: makeStableId(
      'state',
      [input.pageSlugHint, input.name],
      states.map((s) => s.id),
    ),
    featureId: input.featureId,
    pageRef: input.pageRef,
    name: input.name,
    origin: input.origin,
    capturedPageId: input.capturedPageId,
    duplicatedFromStateId: null,
    order: siblingCount,
    provenance: input.provenance,
    createdAt: now,
    updatedAt: now,
  }
  states.push(state)
  writeAll(userDataPath, projectId, states)
  return state
}

/** Duplicates a state's metadata AND its design tree (spec Phase 17:
 * "Duplicate an existing state into a design state... must preserve source
 * relationships for existing components while allowing independent design
 * changes") — the copy is a full independent tree from this point on, same
 * as `cloneNodeWithFreshIds` already does for canvas duplicate/paste. */
export function duplicateDesignState(userDataPath: string, projectId: string, sourceStateId: string, newName: string, newOrigin: DesignStateOrigin): DesignState {
  const source = getDesignState(userDataPath, projectId, sourceStateId)
  if (!source) throw new Error(`DesignState ${sourceStateId} not found in project ${projectId}`)
  const states = readAll(userDataPath, projectId)
  const now = new Date().toISOString()
  const siblingCount = states.filter((s) => s.pageRef.kind === source.pageRef.kind && s.pageRef.pageId === source.pageRef.pageId).length
  const duplicate: DesignState = {
    id: makeStableId(
      'state',
      [slugify(source.pageRef.pageId), newName],
      states.map((s) => s.id),
    ),
    featureId: source.featureId,
    pageRef: source.pageRef,
    name: newName,
    origin: newOrigin,
    capturedPageId: newOrigin === 'captured' ? source.capturedPageId : null,
    duplicatedFromStateId: source.id,
    order: siblingCount,
    provenance: newOrigin === 'captured' ? source.provenance : 'new',
    createdAt: now,
    updatedAt: now,
  }
  states.push(duplicate)
  writeAll(userDataPath, projectId, states)

  const sourceTree = designTreeStore.getDesignTree(userDataPath, projectId, sourceStateId)
  if (sourceTree) {
    designTreeStore.saveDesignTree(userDataPath, { ownerId: duplicate.id, projectId, tree: sourceTree.tree, updatedAt: now })
  }
  return duplicate
}

export function saveDesignState(userDataPath: string, projectId: string, updated: DesignState): DesignState {
  const states = readAll(userDataPath, projectId)
  const index = states.findIndex((s) => s.id === updated.id)
  if (index === -1) throw new Error(`DesignState ${updated.id} not found in project ${projectId}`)
  const saved: DesignState = { ...updated, updatedAt: new Date().toISOString() }
  states[index] = saved
  writeAll(userDataPath, projectId, states)
  return saved
}

export function reorderDesignStates(userDataPath: string, projectId: string, orderedIds: string[]): void {
  const states = readAll(userDataPath, projectId)
  const now = new Date().toISOString()
  const byId = new Map(states.map((s) => [s.id, s]))
  orderedIds.forEach((id, index) => {
    const state = byId.get(id)
    if (state) {
      state.order = index
      state.updatedAt = now
    }
  })
  writeAll(userDataPath, projectId, states)
}

/** Cascades to the state's own tree and any Alternatives built on top of
 * it — never leaves orphaned design trees behind (spec: "Do not persist
 * unnecessary flattened copies"). */
export function deleteDesignState(userDataPath: string, projectId: string, stateId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((s) => s.id !== stateId))
  designTreeStore.deleteDesignTree(userDataPath, projectId, stateId)
  for (const alternative of alternativeStore.listAlternativesForState(userDataPath, projectId, stateId)) {
    alternativeStore.deleteAlternative(userDataPath, projectId, alternative.id)
  }
}

export function deleteAllForFeature(userDataPath: string, projectId: string, featureId: string): void {
  const states = readAll(userDataPath, projectId)
  for (const state of states) {
    if (state.featureId === featureId) {
      designTreeStore.deleteDesignTree(userDataPath, projectId, state.id)
      for (const alternative of alternativeStore.listAlternativesForState(userDataPath, projectId, state.id)) {
        alternativeStore.deleteAlternative(userDataPath, projectId, alternative.id)
      }
    }
  }
  writeAll(userDataPath, projectId, states.filter((s) => s.featureId !== featureId))
}
