import { expect, test } from 'bun:test'
import { PendingSaves } from '../../renderer/state/pendingSaves'

test('flush waits for an in-flight revision and saves newer edits afterwards', async () => {
  const queue = new PendingSaves()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const writes: string[] = []
  queue.schedule('a', async () => { await gate; writes.push('old') }, 60_000)
  const flushing = queue.flush()
  queue.schedule('a', async () => { writes.push('new') }, 60_000)
  release()
  await flushing
  expect(writes).toEqual(['old', 'new'])
})

test('failed older writes cannot replace a newer pending revision', async () => {
  const queue = new PendingSaves()
  let reject!: (error: Error) => void
  const gate = new Promise<void>((_resolve, fail) => { reject = fail })
  queue.schedule('a', () => gate, 60_000)
  const flushing = queue.flush()
  let saved = false
  queue.schedule('a', async () => { saved = true }, 60_000)
  reject(new Error('disk full'))
  await expect(flushing).rejects.toThrow('disk full')
  await queue.flush()
  expect(saved).toBe(true)
})

test('failed edits remain available for retry', async () => {
  const queue = new PendingSaves()
  let attempts = 0
  queue.schedule('a', async () => { if (++attempts === 1) throw new Error('disk full') }, 60_000)
  await expect(queue.flush()).rejects.toThrow('disk full')
  await queue.flush()
  expect(attempts).toBe(2)
})
