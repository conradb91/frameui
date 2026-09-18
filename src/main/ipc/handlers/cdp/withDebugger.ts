import type { WebContents } from 'electron'
import { captureMotionSession } from './captureMotion'

export type SendCommand = <T = unknown>(
  method: string,
  params?: object,
) => Promise<T>

/**
 * Reuses a capture-owned emulation session without detaching it; otherwise
 * uses a temporary attach/run/detach session. Shared primitive for Electron's `webContents.debugger`
 * (Chrome DevTools Protocol). Extracted from the one-off pattern that used
 * to live inline in `captureVisualStates.ts` so a second CDP consumer
 * (`cdp/domSnapshot.ts`) doesn't duplicate it. Takes a plain `WebContents`
 * (a `BrowserWindow`'s `.webContents`, or a `<webview>` guest resolved via
 * `electron.webContents.fromId()`) since `.debugger` lives there either way.
 *
 * Unlike the code this replaces, errors from `fn` are never swallowed here
 * — that decision belongs to the caller (`captureVisualStates.ts` keeps its
 * own outer try/catch around this call; `domSnapshot.ts` lets them
 * propagate, since CDP is now a primary data source there).
 */
export async function withDebugger<T>(
  contents: WebContents,
  protocolVersion: '1.3',
  fn: (send: SendCommand) => Promise<T>,
): Promise<T> {
  const motionSession = captureMotionSession(contents)
  if (motionSession) {
    await motionSession
    return fn((method, params) => contents.debugger.sendCommand(method, params))
  }
  const debuggerApi = contents.debugger
  if (debuggerApi.isAttached())
    throw new Error(
      'The DevTools debugger is already attached to this window.',
    )
  debuggerApi.attach(protocolVersion)
  try {
    return await fn((method, params) => debuggerApi.sendCommand(method, params))
  } finally {
    if (debuggerApi.isAttached()) debuggerApi.detach()
  }
}
