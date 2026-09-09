import electron from 'electron'
import { z } from 'zod'
import type { DevCommand } from '@shared/types/projectIndex'
import { PreviewProcess } from '../../security/spawnPreview'
import { getActiveProject, getDevCommand, setDevCommandOverride } from '../../state/activeProject'
import { broadcast } from '../rendererEvents'

const { shell } = electron

const openExternalSchema = z.string().url()

// Still just command + argv — spec §23/27.2's "no generic shell command"
// guarantee holds for a user-edited command exactly as it does for a
// detected one: spawnPreview always calls spawn(command, args, {shell:false}).
const setCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
})

const process_ = new PreviewProcess()

export function registerPreviewHandlers(): void {
  const { ipcMain } = electron

  ipcMain.handle('preview:getCommand', (): DevCommand | null => {
    return getDevCommand()
  })

  ipcMain.handle('preview:getStatus', () => process_.getSnapshot())

  ipcMain.handle('preview:setCommand', (_event, raw): { ok: boolean } => {
    const parsed = setCommandSchema.safeParse(raw)
    if (!parsed.success) return { ok: false }
    setDevCommandOverride(parsed.data)
    return { ok: true }
  })

  ipcMain.handle('preview:start', (): { ok: boolean; message?: string } => {
    const active = getActiveProject()
    const command = getDevCommand()
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
