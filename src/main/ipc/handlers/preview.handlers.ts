import electron from 'electron'
import { z } from 'zod'
import type { DevCommand } from '@shared/types/projectIndex'
import { PreviewProcess } from '../../security/spawnPreview'
import { getActiveProject, getCachedIndex } from '../../state/activeProject'
import { broadcast } from '../rendererEvents'

const { shell } = electron

const openExternalSchema = z.string().url()

const process_ = new PreviewProcess()

export function registerPreviewHandlers(): void {
  const { ipcMain } = electron

  ipcMain.handle('preview:getCommand', (): DevCommand | null => {
    return getCachedIndex()?.devCommand ?? null
  })

  ipcMain.handle('preview:start', (): { ok: boolean; message?: string } => {
    const active = getActiveProject()
    const command = getCachedIndex()?.devCommand
    if (!active || !command) {
      return { ok: false, message: 'No project or detected preview command.' }
    }
    if (process_.isRunning) {
      return { ok: false, message: 'Preview is already running.' }
    }

    process_.start(command.command, command.args, active.rootPath, {
      onOutput: (line, stream) => broadcast('preview:onOutput', { line, stream }),
      onStatus: (status, detail) => broadcast('preview:onStatus', { status, detail }),
      onUrlDetected: (url) => broadcast('preview:onUrlDetected', { url }),
    })
    return { ok: true }
  })

  ipcMain.handle('preview:stop', (): { ok: true } => {
    process_.stop()
    return { ok: true }
  })

  // The ONLY path allowed to call shell.openExternal — main validates the
  // scheme itself rather than trusting the renderer (spec §23/27.2).
  ipcMain.handle('preview:openExternal', async (_event, rawUrl): Promise<{ ok: boolean }> => {
    const parsed = openExternalSchema.safeParse(rawUrl)
    if (!parsed.success) return { ok: false }
    const url = new URL(parsed.data)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false }
    await shell.openExternal(parsed.data)
    return { ok: true }
  })
}
