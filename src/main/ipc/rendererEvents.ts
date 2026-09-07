import type { BrowserWindow } from 'electron'

let mainWindowRef: BrowserWindow | null = null

export function setMainWindowRef(win: BrowserWindow): void {
  mainWindowRef = win
}

/** Sends a main->renderer event. Silently no-ops if the window is gone
 * (closed mid-scan, etc.) rather than throwing. */
export function broadcast(channel: string, payload: unknown): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload)
  }
}
