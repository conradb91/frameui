import type { FeaturePage, NewPageLayoutSource } from '@shared/types/model/featureModel'
import { makeStableId } from '@core/design-model/id'
import { getFeaturePagesFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

function readAll(userDataPath: string, projectId: string): FeaturePage[] {
  return readJsonFile<FeaturePage[]>(getFeaturePagesFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, pages: FeaturePage[]): void {
  writeJsonFileAtomic(getFeaturePagesFile(userDataPath, projectId), pages)
}

export function listFeaturePages(userDataPath: string, projectId: string, featureId: string): FeaturePage[] {
  return readAll(userDataPath, projectId)
    .filter((p) => p.featureId === featureId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function getFeaturePage(userDataPath: string, projectId: string, pageId: string): FeaturePage | null {
  return readAll(userDataPath, projectId).find((p) => p.id === pageId) ?? null
}

export function createFeaturePage(
  userDataPath: string,
  projectId: string,
  input: {
    featureId: string
    name: string
    description: string
    suggestedRoute: string | null
    initialViewport: FeaturePage['initialViewport']
    layoutSource: NewPageLayoutSource
    basedOnPageId: string | null
    basedOnPatternName: string | null
  },
): FeaturePage {
  const pages = readAll(userDataPath, projectId)
  const now = new Date().toISOString()
  const page: FeaturePage = {
    id: makeStableId(
      'page',
      [input.name],
      pages.map((p) => p.id),
    ),
    featureId: input.featureId,
    name: input.name,
    description: input.description,
    suggestedRoute: input.suggestedRoute,
    initialViewport: input.initialViewport,
    layoutSource: input.layoutSource,
    basedOnPageId: input.basedOnPageId,
    basedOnPatternName: input.basedOnPatternName,
    status: 'concept',
    createdAt: now,
    updatedAt: now,
  }
  pages.push(page)
  writeAll(userDataPath, projectId, pages)
  return page
}

export function saveFeaturePage(userDataPath: string, projectId: string, updated: FeaturePage): FeaturePage {
  const pages = readAll(userDataPath, projectId)
  const index = pages.findIndex((p) => p.id === updated.id)
  if (index === -1) throw new Error(`FeaturePage ${updated.id} not found in project ${projectId}`)
  const saved: FeaturePage = { ...updated, updatedAt: new Date().toISOString() }
  pages[index] = saved
  writeAll(userDataPath, projectId, pages)
  return saved
}

export function deleteFeaturePage(userDataPath: string, projectId: string, pageId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((p) => p.id !== pageId))
}

export function deleteAllForFeature(userDataPath: string, projectId: string, featureId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((p) => p.featureId !== featureId))
}
