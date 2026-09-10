import { themes } from '../../shared/theme'
import electron, { type BrowserWindow as BrowserWindowType } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { BrowserWindow, shell, app, nativeImage } = electron

// __dirname here resolves to dist-electron/main at runtime (this file's own
// build output location), which is what the two paths below are relative to.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const preloadPath = path.join(__dirname, '../preload/index.cjs')
const rendererIndexPath = path.join(__dirname, '../../dist/index.html')

let quitting = false
app.on('before-quit', () => { quitting = true })

export function createMainWindow(): BrowserWindowType {
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../../build/icon.png')
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(iconPath))
  const win = new BrowserWindow({
    icon: iconPath,
    title: 'FrameUI',
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: themes.dark.bg,
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // Only <webview> use in the app is the V2 Capture Session — its guest
      // content is locked down in captureWebviewGuard.ts (no preload, no
      // node integration, http(s)-only navigation).
      webviewTag: true,
    },
  })

  let savedForClose = false
  let closing = false
  win.on('close', (event) => {
    if (savedForClose || win.webContents.isDestroyed() || win.webContents.isCrashed()) return
    event.preventDefault()
    if (closing) return
    closing = true
    void win.webContents.executeJavaScript('window.frameuiFlushSaves ? window.frameuiFlushSaves() : Promise.resolve()').then(() => {
      savedForClose = true
      if (quitting) app.quit()
      else win.close()
    }).catch((error: unknown) => {
      closing = false
      quitting = false
      console.error('[main] Could not save before closing', error)
      void electron.dialog.showMessageBox(win, { type: 'error', message: 'Your changes could not be saved.', detail: 'FrameUI has kept this window open. Check available disk space and permissions, then try closing again.' })
    })
  })

  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load', code, desc, url)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] render-process-gone', details)
  })

  // Every external navigation goes to the OS browser, never inside the app
  // window — the renderer has a separate, explicit openExternal IPC call for
  // links it wants to offer the user; this handles anything else (e.g. a
  // stray target=_blank) so nothing ever navigates the editor itself away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const isDevServer = devServerUrl && url.startsWith(devServerUrl)
    if (!isDevServer) {
      event.preventDefault()
    }
  })

  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(rendererIndexPath)
  }

  return win
}
