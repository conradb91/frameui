import electron from 'electron'
import { z } from 'zod'
import { hostingPreview, hostingAction } from '../../hosting/service'
import { getActiveProject } from '../../state/activeProject'

/** Compatibility status for workspaces using the managed local application. */
export function registerPreviewHandlers(): void {
  const { ipcMain, shell } = electron
  ipcMain.handle('preview:getCommand', () => null)
  ipcMain.handle('preview:getStatus', () => hostingPreview() ?? { status: 'stopped', url: null })
  ipcMain.handle('preview:setCommand', () => ({ ok: false }))
  ipcMain.handle('preview:start', () => ({
    ok: false,
    message:
      'Start your application using your normal development environment, then connect to it.',
  }))
  ipcMain.handle('preview:stop', async () => {
    const project = getActiveProject()
    if (project && hostingPreview()) await hostingAction(project.projectId, 'stop')
    return { ok: true }
  })
  ipcMain.handle('preview:openExternal', async (_event, raw) => {
    const parsed = z.string().url().safeParse(raw)
    if (!parsed.success || !/^https?:/.test(parsed.data)) return { ok: false }
    await shell.openExternal(parsed.data)
    return { ok: true }
  })
}
