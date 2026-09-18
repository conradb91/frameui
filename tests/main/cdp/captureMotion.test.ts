import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { enableCaptureMotion } from '../../../src/main/ipc/handlers/cdp/captureMotion'
import { withDebugger } from '../../../src/main/ipc/handlers/cdp/withDebugger'

function target() {
  let attached = false
  const api = Object.assign(new EventEmitter(), {
    attach() { attached = true },
    detach() { attached = false; api.emit('detach') },
    isAttached() { return attached },
    async sendCommand(_method: string) { return undefined },
  })
  return { debugger: api, isDestroyed: () => false } as unknown as WebContents
}

test('capture operations keep the owned emulation session alive, including failures', async () => {
  const contents = target()
  await enableCaptureMotion(contents)
  await withDebugger(contents, '1.3', send => send('DOMSnapshot.captureSnapshot'))
  expect(contents.debugger.isAttached()).toBe(true)
  await expect(withDebugger(contents, '1.3', async () => { throw new Error('capture failed') })).rejects.toThrow('capture failed')
  expect(contents.debugger.isAttached()).toBe(true)
  contents.debugger.detach()
  await enableCaptureMotion(contents)
  expect(contents.debugger.isAttached()).toBe(true)
})

test('failed emulation releases only the capture-owned session for retry', async () => {
  const contents = target()
  contents.debugger.sendCommand = async () => { throw new Error('target not ready') }
  await expect(enableCaptureMotion(contents)).rejects.toThrow('target not ready')
  expect(contents.debugger.isAttached()).toBe(false)
  contents.debugger.sendCommand = async () => undefined
  await enableCaptureMotion(contents)
  expect(contents.debugger.isAttached()).toBe(true)
})

test('never takes ownership of an unrelated debugger session', async () => {
  const contents = target()
  contents.debugger.attach()
  await expect(enableCaptureMotion(contents)).rejects.toThrow('Close page DevTools')
  expect(contents.debugger.isAttached()).toBe(true)
})
