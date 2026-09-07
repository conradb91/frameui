import chokidar, { type FSWatcher } from 'chokidar'
import { pathContainsIgnoredSegment } from '@core/indexer/ignore'

const DEBOUNCE_MS = 400

/**
 * Watches one opened project's root for external changes (PRJ file-changed
 * detection / incremental re-index). Debounced and coalesced so a git
 * checkout or a save-storm triggers one notification, not hundreds.
 */
export class ProjectWatcher {
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly rootPath: string,
    private readonly onChange: (changedPaths: string[]) => void,
  ) {}

  start(): void {
    this.stop()
    this.watcher = chokidar.watch(this.rootPath, {
      ignored: (filePath: string) => pathContainsIgnoredSegment(this.rootPath, filePath),
      ignoreInitial: true,
      persistent: true,
    })

    const schedule = (changedPath: string) => {
      this.pending.add(changedPath)
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        const paths = [...this.pending]
        this.pending.clear()
        this.timer = null
        this.onChange(paths)
      }, DEBOUNCE_MS)
    }

    this.watcher.on('add', schedule).on('change', schedule).on('unlink', schedule).on('addDir', schedule).on('unlinkDir', schedule)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending.clear()
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
  }
}
