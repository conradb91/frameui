import type { ProjectIndex, FileChangeNotice, DevCommand } from '@shared/types/projectIndex'
import { ProjectWatcher } from '../watcher/projectWatcher'
import { broadcast } from '../ipc/rendererEvents'

interface ActiveProject {
  projectId: string
  rootPath: string
  watcher: ProjectWatcher
  cachedIndex: ProjectIndex | null
  /** PRJ-03: "The user can change it." Survives reindex (unlike
   * cachedIndex) since it's an explicit user choice, not detected state;
   * cleared only when the project itself changes. */
  devCommandOverride: DevCommand | null
}

let active: ActiveProject | null = null

export function getActiveProject(): { projectId: string; rootPath: string } | null {
  return active ? { projectId: active.projectId, rootPath: active.rootPath } : null
}

export function getCachedIndex(): ProjectIndex | null {
  return active?.cachedIndex ?? null
}

/** The detected command, unless the user has explicitly overridden it. */
export function getDevCommand(): DevCommand | null {
  return active?.devCommandOverride ?? active?.cachedIndex?.devCommand ?? null
}

export function setDevCommandOverride(command: DevCommand): void {
  if (active) active.devCommandOverride = command
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
  active = { projectId, rootPath, watcher, cachedIndex: null, devCommandOverride: null }
  watcher.start()
}
