import electron from 'electron'
import { z } from 'zod'
import type { DevCommand } from '@shared/types/projectIndex'
import { previewProcess } from '../../security/spawnPreview'
import { getActiveProject, getDevCommand, setDevCommandOverride } from '../../state/activeProject'
import { broadcast } from '../rendererEvents'
import path from 'node:path'

const { shell } = electron

const openExternalSchema = z.string().url()

// Still just command + argv — spec §23/27.2's "no generic shell command"
// guarantee holds for a user-edited command exactly as it does for a
// detected one: spawnPreview always calls spawn(command, args, {shell:false}).
const setCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
})

export function registerPreviewHandlers(): void {
  const { ipcMain } = electron

  ipcMain.handle('preview:getCommand', (): DevCommand | null => {
    return getDevCommand()
  })

  ipcMain.handle('preview:getStatus', () => previewProcess.getSnapshot())

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
    if (previewProcess.isRunning) {
      return { ok: false, message: 'Preview is already running.' }
    }

    const commandRoot = command.workingDirectory ? path.resolve(active.rootPath, command.workingDirectory) : active.rootPath
    if (commandRoot !== active.rootPath && !commandRoot.startsWith(`${active.rootPath}${path.sep}`)) return { ok: false, message: 'Invalid application working directory.' }
    return previewProcess.start(command.command, command.args, commandRoot, {
      onOutput: (line, stream) => broadcast('preview:onOutput', { line, stream }),
      onStatus: (status, detail) => broadcast('preview:onStatus', { status, detail }),
      onUrlDetected: (url) => broadcast('preview:onUrlDetected', { url }),
    })
  })

  ipcMain.handle('preview:stop', (): { ok: true } => {
    previewProcess.stop()
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
