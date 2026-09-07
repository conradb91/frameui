import type { ProjectIndex, FileChangeNotice } from '@shared/types/projectIndex'
import { ProjectWatcher } from '../watcher/projectWatcher'
import { broadcast } from '../ipc/rendererEvents'

interface ActiveProject {
  projectId: string
  rootPath: string
  watcher: ProjectWatcher
  cachedIndex: ProjectIndex | null
}

let active: ActiveProject | null = null

export function getActiveProject(): { projectId: string; rootPath: string } | null {
  return active ? { projectId: active.projectId, rootPath: active.rootPath } : null
}

export function getCachedIndex(): ProjectIndex | null {
  return active?.cachedIndex ?? null
}

export function setCachedIndex(index: ProjectIndex): void {
  if (active) active.cachedIndex = index
}

export function invalidateCachedIndex(): void {
  if (active) active.cachedIndex = null
}

export function closeActiveProject(): void {
  active?.watcher.stop()
  active = null
}

export function activateProject(projectId: string, rootPath: string): void {
  closeActiveProject()
  const watcher = new ProjectWatcher(rootPath, (changedPaths) => {
    if (!active) return
    active.cachedIndex = null
    const notice: FileChangeNotice = { projectId: active.projectId, changedPaths }
    broadcast('project:onFileChanged', notice)
  })
  active = { projectId, rootPath, watcher, cachedIndex: null }
  watcher.start()
}
