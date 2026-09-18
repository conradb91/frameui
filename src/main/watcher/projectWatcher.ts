import chokidar, { type FSWatcher } from 'chokidar'
import { isRelevantProjectPath, pathContainsIgnoredSegment } from '@core/indexer/ignore'
import path from 'node:path'
import fs from 'node:fs'
import type { FileChange, FileChangeKind } from '@shared/types/projectIndex'

const DEBOUNCE_MS = 400

/**
 * Watches one opened project's root for external changes (PRJ file-changed
 * detection / incremental re-index). Debounced and coalesced so a git
 * checkout or a save-storm triggers one notification, not hundreds.
 */
export class ProjectWatcher {
  private watcher: FSWatcher | null = null
  private pending = new Map<string, FileChangeKind>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly rootPath: string,
    private readonly onChange: (changes: FileChange[]) => void,
    private readonly onError: (error: Error) => void = () => {},
  ) {}

  start(): void {
    this.stop()
    this.watcher = chokidar.watch(this.rootPath, {
      ignored: (filePath: string) => {
        if (pathContainsIgnoredSegment(this.rootPath, filePath)) return true
        try { if (fs.statSync(filePath).isDirectory()) return false } catch { /* transient path */ }
        return !isRelevantProjectPath(this.rootPath, filePath)
      },
      ignoreInitial: true,
      followSymlinks: false,
      persistent: true,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 25 },
    })

    const schedule = (kind: FileChangeKind) => (changedPath: string) => {
      const previous = this.pending.get(changedPath)
      // Atomic save often appears as unlink + add; semantically it is one
      // modification and should cause one incremental parse.
      this.pending.set(changedPath, previous === 'deleted' && kind === 'created' ? 'modified' : kind)
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        const entries = [...this.pending.entries()]
        this.pending.clear()
        this.timer = null
        const deleted = entries.filter(([, event]) => event === 'deleted')
        const created = entries.filter(([, event]) => event === 'created')
        const changes: FileChange[] = []
        const usedCreated = new Set<string>()
        for (const [oldPath] of deleted) {
          const candidate = created.find(([newPath]) => !usedCreated.has(newPath) && path.dirname(newPath) === path.dirname(oldPath) && path.extname(newPath) === path.extname(oldPath))
          if (candidate) { usedCreated.add(candidate[0]); changes.push({ path: candidate[0], previousPath: oldPath, kind: 'renamed' }) }
          else changes.push({ path: oldPath, kind: 'deleted' })
        }
        for (const [filePath, event] of entries) {
          if (event === 'deleted' || usedCreated.has(filePath)) continue
          changes.push({ path: filePath, kind: event })
        }
        this.onChange(changes)
      }, DEBOUNCE_MS)
    }

    this.watcher.on('error', this.onError)
    this.watcher.on('add', schedule('created')).on('change', schedule('modified')).on('unlink', schedule('deleted'))
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending.clear()
    if (this.watcher) {
      void this.watcher.close().catch(this.onError)
      this.watcher = null
    }
  }
}
