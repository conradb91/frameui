import { importGitHub } from '../../hosting/githubImport'
import electron from 'electron'
import { z } from 'zod'
import { inspectHosting, prepareHosting, hostingAction, hostingEnvironment, planHostingCreation, createHostedProject } from '../../hosting/service'
import { recordProjectOpened } from '@core/workspace/models/recentProjectsStore'
import path from 'node:path'

export function registerHostingHandlers() {
  electron.ipcMain.handle('hosting:importGitHub', async (_event, raw) => {
    const root = await importGitHub(z.string().url().max(500).parse(raw))
    return root ? recordProjectOpened(electron.app.getPath('userData'), root, path.basename(root)) : null
  })
  const id = z.string().min(1).max(200)
  electron.ipcMain.handle('hosting:planCreate', (_event, raw) => {
    const input = z.object({ name: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/), framework: z.enum(['Vanilla HTML / JS', 'React + Vite', 'Next.js', 'Laravel', 'CodeIgniter 4']) }).strict().parse(raw)
    return planHostingCreation(input.name, input.framework)
  })
  electron.ipcMain.handle('hosting:create', async (_event, raw) => {
    const root = await createHostedProject(z.string().uuid().parse(raw))
    return recordProjectOpened(electron.app.getPath('userData'), root, path.basename(root))
  })
  electron.ipcMain.handle('hosting:environment', (_event, raw) => hostingEnvironment(id.parse(raw)))
  electron.ipcMain.handle('hosting:updateEnvironment', (_event, raw) => {
    const value = z.object({ projectId: id, file: z.string().min(1).max(100), changes: z.array(z.object({ key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/), value: z.string().max(20000).refine(s => !/[\r\n]/.test(s)) }).strict()).max(200) }).strict().parse(raw)
    return hostingEnvironment(value.projectId, value)
  })
  electron.ipcMain.handle('hosting:inspect', (_event, raw) => inspectHosting(id.parse(raw)))
  electron.ipcMain.handle('hosting:prepare', (_event, raw) => {
    const parsed = z.object({ projectId: id, options: z.object({ reviewId: z.string().uuid(), approveChanges: z.literal(true), database: z.enum(['skip', 'existing', 'sqlite', 'postgres', 'mariadb']), startWhenReady: z.boolean() }).strict() }).strict().parse(raw)
    return prepareHosting(parsed.projectId, parsed.options)
  })
  electron.ipcMain.handle('hosting:action', (_event, raw) => {
    const parsed = z.object({ projectId: id, action: z.enum(['start', 'stop', 'health', 'logs', 'migration-status', 'migrate', 'restore-database']), confirmation: z.string().max(500).optional() }).strict().parse(raw)
    return hostingAction(parsed.projectId, parsed.action, parsed.confirmation)
  })
}
