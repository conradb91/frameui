/** Captures the owner and revision at edit time; serializes writes per owner. */
export class PendingSaves {
  private pending = new Map<string, { save: () => Promise<void>; timer: ReturnType<typeof setTimeout> }>()
  private running = new Map<string, Promise<void>>()

  get hasPending() { return this.pending.size > 0 || this.running.size > 0 }

  schedule(key: string, save: () => Promise<void>, delay = 500) {
    const previous = this.pending.get(key)
    if (previous) clearTimeout(previous.timer)
    const timer = setTimeout(() => { void this.flushKey(key).catch(reportSaveError) }, delay)
    this.pending.set(key, { save, timer })
  }

  private async flushKey(key: string): Promise<void> {
    const running = this.running.get(key)
    if (running) { await running; return this.flushKey(key) }
    const item = this.pending.get(key)
    if (!item) return
    clearTimeout(item.timer)
    this.pending.delete(key)
    const promise = item.save().catch((error: unknown) => {
      // A failed older revision must never replace a newer edit.
      if (!this.pending.has(key)) this.pending.set(key, item)
      throw error
    }).finally(() => { this.running.delete(key) })
    this.running.set(key, promise)
    await promise
  }

  async flush(): Promise<void> {
    await Promise.all([...new Set([...this.pending.keys(), ...this.running.keys()])].map((key) => this.flushKey(key)))
    if (this.pending.size) await this.flush()
  }
}

export function reportSaveError(error: unknown) {
  window.dispatchEvent(new CustomEvent('frameui:save-error', { detail: error instanceof Error ? error.message : 'Your changes could not be saved. Check available disk space and try again.' }))
}

export const pendingWorkspaceSaves = new PendingSaves()
