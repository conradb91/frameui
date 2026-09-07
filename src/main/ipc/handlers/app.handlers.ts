import electron from 'electron'

const { app, ipcMain } = electron

export function registerAppHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getPlatform', () => process.platform)
}
