// Named imports from 'electron' break the ESM cjs-module-lexer interop for
// Electron's synthetic built-in module (a real, documented Electron/Node
// gap) — default-import + destructure is the working pattern.
import electron, { type BrowserWindow } from 'electron'
import { createMainWindow } from './windows/createMainWindow'
import { registerIpc } from './ipc/registerIpc'
import { setMainWindowRef } from './ipc/rendererEvents'
import { fixPath } from './security/fixPath'
import { installCaptureWebviewGuard } from './security/captureWebviewGuard'

const { app } = electron

// A second launch should focus the existing window rather than open a
// second instance — relevant once a project is open and has file watchers.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    fixPath() // async, non-blocking — see fixPath.ts for why this is needed
    registerIpc()
    mainWindow = createMainWindow()
    setMainWindowRef(mainWindow)
    installCaptureWebviewGuard(mainWindow)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
      setMainWindowRef(mainWindow)
      installCaptureWebviewGuard(mainWindow)
    }
  })
}
