import electron, { type BrowserWindow } from 'electron'

const { app, shell } = electron

/**
 * V2 spec §4 "Capture Session": an embedded `<webview>` lets the user sign
 * into their own running application inside FrameUI. That page is
 * unreviewed third-party-shaped content (it's the user's own app, but still
 * a full webpage FrameUI didn't author), so it gets the same treatment as
 * any untrusted renderer:
 *   - never given a `preload` script (renderer never sets one) -> zero
 *     access to window.frameui or any Node API, regardless of what script
 *     runs inside the captured page.
 *   - default nodeIntegration:false, contextIsolation:true, sandboxed —
 *     enforced here rather than trusted from the renderer's tag attributes,
 *     since the host webContents (not the guest) is what fires
 *     `will-attach-webview`.
 *   - navigation restricted to http/https (blocks file://, chrome://, and
 *     other privileged schemes a malicious redirect could otherwise reach).
 *   - popups/new-window attempts route to the OS browser, never open a new
 *     unrestricted Electron window.
 * This mirrors the exact guarantees createMainWindow.ts already applies to
 * the main window itself.
 */
export function installCaptureWebviewGuard(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
  })

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return

    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    contents.on('will-navigate', (navEvent, url) => {
      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        navEvent.preventDefault()
      }
    })
  })
}
