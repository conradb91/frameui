import type { Journey } from '@shared/types/model/featureModel'
import { makeStableId } from '@core/design-model/id'
import { getJourneysFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

/** Phase 21 — Journeys, the Feature-scoped replacement for the old
 * project-level Flow as the user-facing "sequence of screens" concept.
 * Follows the exact `flowStore.ts` persistence pattern; the underlying
 * `@xyflow/react` canvas mechanics are reused by the renderer's Journey
 * canvas, not duplicated here (this store only ever deals in plain data). */
function readAll(userDataPath: string, projectId: string): Journey[] {
  return readJsonFile<Journey[]>(getJourneysFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, journeys: Journey[]): void {
  writeJsonFileAtomic(getJourneysFile(userDataPath, projectId), journeys)
}

export function listJourneys(userDataPath: string, projectId: string, featureId: string): Journey[] {
  return readAll(userDataPath, projectId)
    .filter((j) => j.featureId === featureId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function getJourney(userDataPath: string, projectId: string, journeyId: string): Journey | null {
  return readAll(userDataPath, projectId).find((j) => j.id === journeyId) ?? null
}

export function createJourney(userDataPath: string, projectId: string, featureId: string, name: string, description: string): Journey {
  const journeys = readAll(userDataPath, projectId)
  const now = new Date().toISOString()
  const journey: Journey = {
    id: makeStableId(
      'journey',
      [name],
      journeys.map((j) => j.id),
    ),
    featureId,
    name,
    description,
    steps: [],
    connections: [],
    createdAt: now,
    updatedAt: now,
  }
  journeys.push(journey)
  writeAll(userDataPath, projectId, journeys)
  return journey
}

export function saveJourney(userDataPath: string, projectId: string, updated: Journey): Journey {
  const journeys = readAll(userDataPath, projectId)
  const index = journeys.findIndex((j) => j.id === updated.id)
  if (index === -1) throw new Error(`Journey ${updated.id} not found in project ${projectId}`)
  const saved: Journey = { ...updated, updatedAt: new Date().toISOString() }
  journeys[index] = saved
  writeAll(userDataPath, projectId, journeys)
  return saved
}

export function deleteJourney(userDataPath: string, projectId: string, journeyId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((j) => j.id !== journeyId))
}

export function deleteAllForFeature(userDataPath: string, projectId: string, featureId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((j) => j.featureId !== featureId))
}
