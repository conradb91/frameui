import { afterEach, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'

class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = []
  messages: { id: number; method: string }[] = []
  constructor() { super(); FakeWorker.instances.push(this) }
  postMessage(message: { id: number; method: string }) { this.messages.push(message) }
  terminate() { this.emit('exit', 1); return Promise.resolve(1) }
}
mock.module('node:worker_threads', () => ({ Worker: FakeWorker }))
const { BackgroundIndexService } = await import('../../main/indexer/backgroundIndexService')
afterEach(() => { FakeWorker.instances = [] })

test('a worker that never becomes ready fails instead of spinning indefinitely', async () => {
  const service = new BackgroundIndexService('/tmp', 'test', '/tmp')
  try {
    await expect(service.load()).rejects.toThrow('did not start within 15 seconds')
  } finally { service.dispose() }
}, 20_000)

test('a UI joining an existing load receives past and future progress', async () => {
  const service = new BackgroundIndexService('/tmp', 'test', '/tmp')
  try {
    const first = service.load()
    const worker = FakeWorker.instances[0]
    worker.emit('message', { id: 1, step: 'validating-cache' })
    const steps: string[] = []
    const second = service.load((step) => steps.push(step))
    worker.emit('message', { id: 1, step: 'detecting' })
    worker.emit('message', { id: 1, step: 'done' })
    worker.emit('message', { id: 1, index: { projectId: 'test' } })
    expect(await first).toEqual(await second)
    expect(worker.messages).toHaveLength(1)
    expect(steps).toEqual(['validating-cache', 'detecting', 'done'])
  } finally { service.dispose() }
})

test('retry replaces a failed worker and ignores late events from it', async () => {
  const service = new BackgroundIndexService('/tmp', 'test', '/tmp')
  try {
    const first = service.load()
    const old = FakeWorker.instances[0]
    old.emit('error', new Error('Startup failed'))
    await expect(first).rejects.toThrow('Startup failed')
    const retry = service.load()
    const replacement = FakeWorker.instances[1]
    old.emit('exit', 1)
    replacement.emit('message', { ready: true })
    replacement.emit('message', { id: 2, index: { projectId: 'test' } })
    expect(await retry).toEqual({ projectId: 'test' })
  } finally { service.dispose() }
})
