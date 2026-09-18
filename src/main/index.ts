import fs from 'node:fs'
import path from 'node:path'
import { closeActiveProject } from './state/activeProject'
import { shutdownHosting } from './hosting/service'
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

// Review builds are isolated from installed FrameUI data and from each other.
// An explicit smoke-test profile always takes precedence.
if (app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  const metadata = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { frameuiReviewProfile?: string }
  if (metadata.frameuiReviewProfile && /^review-[0-9]+-[a-f0-9-]+$/.test(metadata.frameuiReviewProfile)) {
    const profile = path.join(app.getPath('appData'), 'FrameUI Reviews', metadata.frameuiReviewProfile)
    fs.mkdirSync(profile, { recursive: true })
    app.setPath('userData', profile)
    app.setPath('sessionData', profile)
  }
}

// A second launch should focus the existing window rather than open a
// second instance — relevant once a project is open and has file watchers.
// Automated desktop smoke tests need an isolated second instance while a
// user's installed FrameUI may already be open. Production behavior stays
// single-instance; the opt-in is deliberately environment-only.
const gotSingleInstanceLock = process.env.FRAMEUI_ALLOW_MULTIPLE_INSTANCES === '1' || app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let hostingStopped = false
  app.on('before-quit', (event) => {
    if (hostingStopped) return
    event.preventDefault()
    void shutdownHosting().finally(() => { hostingStopped = true; app.quit() })
  })

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else { app.emit('activate') }
  })

  app.whenReady().then(() => {
    fixPath() // async, non-blocking — see fixPath.ts for why this is needed
    registerIpc()
    mainWindow = createMainWindow()
    setMainWindowRef(mainWindow)
    installCaptureWebviewGuard(mainWindow)
  })

  app.on('window-all-closed', () => {
    mainWindow = null
    closeActiveProject()
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
