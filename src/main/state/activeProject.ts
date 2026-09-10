import type { ProjectIndex, FileChangeNotice, DevCommand } from '@shared/types/projectIndex'
import { ProjectWatcher } from '../watcher/projectWatcher'
import { broadcast } from '../ipc/rendererEvents'
import { ProjectIndexService } from '@core/indexer/projectIndexService'

interface ActiveProject {
  projectId: string
  rootPath: string
  watcher: ProjectWatcher
  cachedIndex: ProjectIndex | null
  indexService: ProjectIndexService
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
  if (!active) return null
  const selected = active.cachedIndex?.applications?.find((item) => item.id === active?.cachedIndex?.activeApplicationId)
  return active.devCommandOverride ?? selected?.devCommand ?? active.cachedIndex?.devCommand ?? null
}

export function setDevCommandOverride(command: DevCommand): void {
  if (active) active.devCommandOverride = command
}

export function setCachedIndex(index: ProjectIndex): void {
  if (active) active.cachedIndex = index
}

export function getIndexService(): ProjectIndexService | null { return active?.indexService ?? null }

export function invalidateCachedIndex(): void {
  if (active) active.cachedIndex = null
}

export function closeActiveProject(): void {
  active?.watcher.stop()
  active = null
}

export function activateProject(projectId: string, rootPath: string, userDataPath: string): void {
  closeActiveProject()
  const indexService = new ProjectIndexService(userDataPath, projectId, rootPath)
  const watcher = new ProjectWatcher(rootPath, (changes) => {
    if (!active) return
    const current = active
    broadcast('project:onFileChanged', { projectId: current.projectId, changedPaths: changes.map((item) => item.path), changes, status: 'updating' } satisfies FileChangeNotice)
    setImmediate(() => {
      if (active !== current) return
      try {
        const index = current.indexService.update(changes, (step) => broadcast('project:onIndexProgress', { step }))
        current.cachedIndex = index
        broadcast('project:onFileChanged', { projectId: current.projectId, changedPaths: changes.map((item) => item.path), changes, status: 'up-to-date', summary: index.lastUpdate } satisfies FileChangeNotice)
      } catch {
        broadcast('project:onFileChanged', { projectId: current.projectId, changedPaths: changes.map((item) => item.path), changes, status: 'warning' } satisfies FileChangeNotice)
      }
    })
  })
  active = { projectId, rootPath, watcher, cachedIndex: null, indexService, devCommandOverride: null }
  watcher.start()
}
