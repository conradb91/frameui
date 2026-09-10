import type { ProjectIndex, FileChangeNotice, DevCommand } from '@shared/types/projectIndex'
import { ProjectWatcher } from '../watcher/projectWatcher'
import { broadcast } from '../ipc/rendererEvents'
import { BackgroundIndexService } from '../indexer/backgroundIndexService'
import { stopHostingProject } from '../hosting/service'

interface ActiveProject {
  projectId: string
  rootPath: string
  watcher: ProjectWatcher
  cachedIndex: ProjectIndex | null
  indexService: BackgroundIndexService
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

export function getIndexService(): BackgroundIndexService | null { return active?.indexService ?? null }

export function invalidateCachedIndex(): void {
  if (active) active.cachedIndex = null
}

export function closeActiveProject(): void {
  if (active) void stopHostingProject(active.projectId).catch(() => {})
  active?.watcher.stop()
  active?.indexService.dispose()
  active = null
}

export function activateProject(projectId: string, rootPath: string, userDataPath: string): void {
  closeActiveProject()
  const indexService = new BackgroundIndexService(userDataPath, projectId, rootPath)
  const watcher = new ProjectWatcher(rootPath, (changes) => {
    if (!active) return
    const current = active
    broadcast('project:onFileChanged', { projectId: current.projectId, changedPaths: changes.map((item) => item.path), changes, status: 'updating' } satisfies FileChangeNotice)
    setImmediate(async () => {
      if (active !== current) return
      try {
        const index = await current.indexService.update(changes, (step) => broadcast('project:onIndexProgress', { step }))
        if (active !== current) return
        current.cachedIndex = index
        broadcast('project:onFileChanged', { projectId: current.projectId, changedPaths: changes.map((item) => item.path), changes, status: 'up-to-date', summary: index.lastUpdate } satisfies FileChangeNotice)
      } catch {
        broadcast('project:onFileChanged', { projectId: current.projectId, changedPaths: changes.map((item) => item.path), changes, status: 'warning' } satisfies FileChangeNotice)
      }
    })
  }, () => {
    if (active?.watcher !== watcher) return
    broadcast('project:onFileChanged', { projectId, changedPaths: [], status: 'warning' } satisfies FileChangeNotice)
  })
  active = { projectId, rootPath, watcher, cachedIndex: null, indexService, devCommandOverride: null }
  watcher.start()
}
