import electron, { type BrowserWindow as BrowserWindowType } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { BrowserWindow, shell } = electron

// __dirname here resolves to dist-electron/main at runtime (this file's own
// build output location), which is what the two paths below are relative to.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const preloadPath = path.join(__dirname, '../preload/index.cjs')
const rendererIndexPath = path.join(__dirname, '../../dist/index.html')

export function createMainWindow(): BrowserWindowType {
  const win = new BrowserWindow({
    title: 'FrameUI',
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0A0A0C',
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
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
