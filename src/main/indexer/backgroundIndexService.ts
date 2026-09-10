import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type { FileChange, IndexProgressStep, ProjectIndex } from '@shared/types/projectIndex'

/** One worker per active project; its message queue serializes cache mutations. */
export class BackgroundIndexService {
  private worker: Worker
  private nextId = 0
  private failure: Error | null = null
  private loading: Promise<ProjectIndex> | null = null
  private loadListeners = new Set<(step: IndexProgressStep) => void>()
  private loadSteps: IndexProgressStep[] = []
  private startupTimer: ReturnType<typeof setTimeout> | undefined
  private pending = new Map<number, { resolve: (index: ProjectIndex) => void; reject: (error: Error) => void; progress?: (step: IndexProgressStep) => void }>()

  constructor(private userDataPath: string, private projectId: string, private rootPath: string) {
    this.worker = this.startWorker()
  }

  private startWorker() {
    const worker = new Worker(path.join(__dirname, 'indexWorker.cjs'), { workerData: { userDataPath: this.userDataPath, projectId: this.projectId, rootPath: this.rootPath } })
    this.startupTimer = setTimeout(() => {
      this.fail(new Error('Project preparation did not start within 15 seconds. Retry to restart it, or return to your projects.'))
      void worker.terminate()
    }, 15_000)
    worker.on('message', ({ id, step, index, error, ready }) => {
      if (worker !== this.worker) return
      clearTimeout(this.startupTimer)
      if (ready) return
      const request = this.pending.get(id)
      if (!request) return
      if (step) { request.progress?.(step); return }
      this.pending.delete(id)
      if (error) request.reject(new Error(error))
      else request.resolve(index)
    })
    worker.on('error', (error) => { if (worker === this.worker) this.fail(error) })
    worker.on('exit', (code) => { if (worker === this.worker && !this.failure) this.fail(new Error(`Project preparation stopped (${code}). Please retry.`)) })
    return worker
  }

  private fail(error: Error) {
    clearTimeout(this.startupTimer)
    this.failure = error
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }

  private request(method: string, argument?: FileChange[] | string, progress?: (step: IndexProgressStep) => void): Promise<ProjectIndex> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject, progress })
      this.worker.postMessage({ id, method, argument })
    })
  }

  load(progress?: (step: IndexProgressStep) => void): Promise<ProjectIndex> {
    if (this.failure) {
      this.failure = null
      this.worker = this.startWorker()
    }
    if (!this.loading) {
      this.loadSteps = []
      this.loading = this.request('load', undefined, (step) => {
        this.loadSteps.push(step)
        for (const listener of this.loadListeners) listener(step)
      }).finally(() => { this.loading = null; this.loadListeners.clear() })
    }
    if (progress) {
      this.loadListeners.add(progress)
      for (const step of this.loadSteps) progress(step)
    }
    return this.loading
  }
  rebuild(progress?: (step: IndexProgressStep) => void) { return this.request('rebuild', undefined, progress) }
  update(changes: FileChange[], progress?: (step: IndexProgressStep) => void) { return this.request('update', changes, progress) }
  selectApplication(id: string) { return this.request('selectApplication', id) }
  dispose() {
    this.fail(new Error('Project closed'))
    void this.worker.terminate()
  }
}
