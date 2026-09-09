import type { ScreenDraft } from '@shared/types/screenDraft'
import { getScreenDraftsFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

function readAll(userDataPath: string, projectId: string): ScreenDraft[] {
  return readJsonFile<ScreenDraft[]>(getScreenDraftsFile(userDataPath, projectId), [])
}

export function getScreenDraft(userDataPath: string, projectId: string, screenId: string): ScreenDraft | null {
  return readAll(userDataPath, projectId).find((d) => d.id === screenId) ?? null
}

export function saveScreenDraft(userDataPath: string, draft: ScreenDraft): ScreenDraft {
  const drafts = readAll(userDataPath, draft.projectId)
  const saved: ScreenDraft = { ...draft, updatedAt: new Date().toISOString() }
  const index = drafts.findIndex((d) => d.id === draft.id)
  if (index === -1) drafts.push(saved)
  else drafts[index] = saved
  writeJsonFileAtomic(getScreenDraftsFile(userDataPath, draft.projectId), drafts)
  return saved
}

export function deleteScreenDraft(userDataPath: string, projectId: string, screenId: string): void {
  const drafts = readAll(userDataPath, projectId).filter((d) => d.id !== screenId)
  writeJsonFileAtomic(getScreenDraftsFile(userDataPath, projectId), drafts)
}
