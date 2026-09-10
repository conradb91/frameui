import { parentPort, workerData } from 'node:worker_threads'
import { ProjectIndexService } from '@core/indexer/projectIndexService'
import type { FileChange, IndexProgressStep } from '@shared/types/projectIndex'

const service = new ProjectIndexService(workerData.userDataPath, workerData.projectId, workerData.rootPath)
parentPort!.postMessage({ ready: true })
parentPort!.on('message', ({ id, method, argument }: { id: number; method: 'load' | 'rebuild' | 'update' | 'selectApplication'; argument?: FileChange[] | string }) => {
  const progress = (step: IndexProgressStep) => parentPort!.postMessage({ id, step })
  try {
    const index = method === 'update' ? service.update(argument as FileChange[], progress)
      : method === 'selectApplication' ? service.selectApplication(argument as string)
        : service[method](progress)
    parentPort!.postMessage({ id, index })
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
