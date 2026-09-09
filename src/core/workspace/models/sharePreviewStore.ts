import type { SharePreview } from '@shared/types/model/featureModel'
import { makeStableId } from '@core/design-model/id'
import { getSharePreviewsFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

/** Phase 25 — Share Preview *configuration* CRUD only. The actual
 * packaging step (resolving a Feature/Journey/DesignState/Alternative into
 * a review-safe bundle on disk) is deliberately a separate concern — see
 * `src/core/design-model/sharePackage.ts` — so this store stays a plain
 * "one JSON file per project" table like every other one here. */
function readAll(userDataPath: string, projectId: string): SharePreview[] {
  return readJsonFile<SharePreview[]>(getSharePreviewsFile(userDataPath, projectId), [])
}

function writeAll(userDataPath: string, projectId: string, previews: SharePreview[]): void {
  writeJsonFileAtomic(getSharePreviewsFile(userDataPath, projectId), previews)
}

export function listSharePreviews(userDataPath: string, projectId: string, featureId: string): SharePreview[] {
  return readAll(userDataPath, projectId)
    .filter((p) => p.featureId === featureId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function getSharePreview(userDataPath: string, projectId: string, sharePreviewId: string): SharePreview | null {
  return readAll(userDataPath, projectId).find((p) => p.id === sharePreviewId) ?? null
}

export function createSharePreview(
  userDataPath: string,
  projectId: string,
  input: Omit<SharePreview, 'id' | 'createdAt' | 'updatedAt' | 'packagePath'>,
): SharePreview {
  const previews = readAll(userDataPath, projectId)
  const now = new Date().toISOString()
  const preview: SharePreview = {
    ...input,
    id: makeStableId(
      'sharepreview',
      [input.name],
      previews.map((p) => p.id),
    ),
    createdAt: now,
    updatedAt: now,
    packagePath: null,
  }
  previews.push(preview)
  writeAll(userDataPath, projectId, previews)
  return preview
}

export function saveSharePreview(userDataPath: string, projectId: string, updated: SharePreview): SharePreview {
  const previews = readAll(userDataPath, projectId)
  const index = previews.findIndex((p) => p.id === updated.id)
  if (index === -1) throw new Error(`SharePreview ${updated.id} not found in project ${projectId}`)
  const saved: SharePreview = { ...updated, updatedAt: new Date().toISOString() }
  previews[index] = saved
  writeAll(userDataPath, projectId, previews)
  return saved
}

export function deleteSharePreview(userDataPath: string, projectId: string, sharePreviewId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((p) => p.id !== sharePreviewId))
}

export function deleteAllForFeature(userDataPath: string, projectId: string, featureId: string): void {
  writeAll(userDataPath, projectId, readAll(userDataPath, projectId).filter((p) => p.featureId !== featureId))
}
