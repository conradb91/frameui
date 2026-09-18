import type { WebContents } from 'electron'

// Chromium resets emulation when its debugger session detaches. Keep the
// capture-owned session alive for the lifetime of the page, including reloads.
const sessions = new WeakMap<WebContents, Promise<void>>()

export function captureMotionSession(contents: WebContents): Promise<void> | undefined {
  return sessions.get(contents)
}

export function enableCaptureMotion(contents: WebContents): Promise<void> {
  const existing = sessions.get(contents)
  if (existing) return existing
  if (contents.debugger.isAttached()) return Promise.reject(new Error('Close page DevTools before preparing capture.'))
  contents.debugger.attach('1.3')
  contents.debugger.once('detach', () => sessions.delete(contents))
  const ready = contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  }).then(() => {}).catch((error: unknown) => {
    if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach()
    sessions.delete(contents)
    throw error
  })
  sessions.set(contents, ready)
  return ready
}
