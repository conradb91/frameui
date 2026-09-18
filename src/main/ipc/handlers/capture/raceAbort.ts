/**
 * Races `promise` against `signal` so a caller never waits on a promise that
 * might never settle. This matters for `webContents.executeJavaScript()`
 * and CDP calls made through `webContents.debugger`: destroying the target
 * `BrowserWindow` mid-call (exactly what cancellation does, via
 * `design:cancelCapture`'s immediate `win.destroy()`) does not reliably
 * reject an in-flight call in Electron — it can be left dangling forever.
 * Checking `signal.throwIfAborted()` only between calls isn't enough once a
 * single call can legitimately take hundreds of milliseconds, as
 * scroll-to-settle's repeated round-trips do.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
