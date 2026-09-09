import type { ConceptComponent } from '@shared/types/model/featureModel'
import { getConceptComponentsFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

function readAll(userDataPath: string, projectId: string): ConceptComponent[] {
  return readJsonFile<ConceptComponent[]>(getConceptComponentsFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, components: ConceptComponent[]): void {
  writeJsonFileAtomic(getConceptComponentsFile(userDataPath, projectId), components)
}

export function listConceptComponents(userDataPath: string, projectId: string, featureId: string): ConceptComponent[] {
  return readAll(userDataPath, projectId)
    .filter((c) => c.featureId === featureId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/** Create-or-update by id — the renderer always assigns a fresh
 * `crypto.randomUUID()` id for a brand-new concept component before the
 * first save, same convention as design-tree nodes. */
export function saveConceptComponent(userDataPath: string, projectId: string, component: ConceptComponent): ConceptComponent {
  const components = readAll(userDataPath, projectId)
  const saved: ConceptComponent = { ...component, updatedAt: new Date().toISOString() }
  const index = components.findIndex((c) => c.id === component.id)
  if (index === -1) components.push(saved)
  else components[index] = saved
  writeAll(userDataPath, projectId, components)
  return saved
}

export function deleteConceptComponent(userDataPath: string, projectId: string, componentId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((c) => c.id !== componentId))
}

export function deleteAllForFeature(userDataPath: string, projectId: string, featureId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((c) => c.featureId !== featureId))
}
