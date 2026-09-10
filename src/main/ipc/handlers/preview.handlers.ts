import net from 'node:net'
import electron from 'electron'
import { z } from 'zod'
import type { DevCommand } from '@shared/types/projectIndex'
import { previewProcess } from '../../security/spawnPreview'
import { getActiveProject, getDevCommand, setDevCommandOverride } from '../../state/activeProject'
import { broadcast } from '../rendererEvents'
import path from 'node:path'
import { hostingPreview, hostingAction } from '../../hosting/service'

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

  ipcMain.handle('preview:getStatus', () => hostingPreview() ?? previewProcess.getSnapshot())

  ipcMain.handle('preview:setCommand', (_event, raw): { ok: boolean } => {
    const parsed = setCommandSchema.safeParse(raw)
    if (!parsed.success) return { ok: false }
    setDevCommandOverride(parsed.data)
    return { ok: true }
  })

  ipcMain.handle('preview:start', async (): Promise<{ ok: boolean; message?: string }> => {
    const active = getActiveProject()
    if (active && hostingPreview()) {
      try { await hostingAction(active.projectId, 'start'); return { ok: true } }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) } }
    }
    const command = getDevCommand()
    if (!active || !command) {
      return { ok: false, message: 'No project or detected preview command.' }
    }
    if (previewProcess.isRunning) {
      return { ok: false, message: 'Preview is already running.' }
    }

    const commandRoot = command.workingDirectory ? path.resolve(active.rootPath, command.workingDirectory) : active.rootPath
    if (commandRoot !== active.rootPath && !commandRoot.startsWith(`${active.rootPath}${path.sep}`)) return { ok: false, message: 'Invalid application working directory.' }
    const args = [...command.args]
    if (path.basename(command.command).startsWith('php') && args[0] === '-S' && args[1] === '127.0.0.1:8080') {
      const port = await new Promise<number>((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          const address = server.address() as net.AddressInfo
          server.close((error) => error ? reject(error) : resolve(address.port))
        })
      })
      args[1] = `127.0.0.1:${port}`
    }
    return previewProcess.start(command.command, args, commandRoot, {
      onOutput: (line, stream) => broadcast('preview:onOutput', { line, stream }),
      onStatus: (status, detail) => broadcast('preview:onStatus', { status, detail }),
      onUrlDetected: (url) => broadcast('preview:onUrlDetected', { url }),
    })
  })

  ipcMain.handle('preview:stop', async (): Promise<{ ok: true }> => {
    const active = getActiveProject()
    if (active && hostingPreview()) await hostingAction(active.projectId, 'stop')
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
