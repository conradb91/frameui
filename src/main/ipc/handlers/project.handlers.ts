import { readProjectVisuals } from '@core/design-system/projectVisuals'
import electron from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { OpenProjectResult, OpenRecentResult, ProjectLibraryEntry } from '@shared/types/project'
import type { ProjectIndex } from '@shared/types/projectIndex'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { clearRecentProjects, deleteProjectFromDisk, getRegisteredProject, listAllProjects, recordProjectOpened, removeProjectFromFrameUi, removeProjectFromRecent } from '@core/workspace/models/recentProjectsStore'
import * as captureStore from '@core/workspace/models/captureStore'
import { extractPageStructureFromSource } from '@core/adapters/markup/extractPageStructure'
import { attachComponentPaths, componentKey } from '@core/design-model/buildProjectModel'
import { PathScope, PathScopeError } from '../../security/pathScope'
import { activateProject, closeActiveProject, getActiveProject, getCachedIndex, getIndexService, setCachedIndex } from '../../state/activeProject'
import { deleteProjectFromDiskInputSchema, openDialogInputSchema, openPathInputSchema, getPageStructureInputSchema, projectIdInputSchema, selectApplicationInputSchema } from '../schemas/project.schema'
import { broadcast } from '../rendererEvents'
import { previewProcess } from '../../security/spawnPreview'

const { app, ipcMain, dialog, BrowserWindow, shell } = electron

export function registerProjectHandlers(): void {
  ipcMain.handle('project:listLibrary', (): ProjectLibraryEntry[] => listAllProjects(app.getPath('userData')))

  ipcMain.handle('project:removeFromRecent', (_event, rawProjectId): { ok: true } => {
    removeProjectFromRecent(app.getPath('userData'), projectIdInputSchema.parse(rawProjectId))
    return { ok: true }
  })

  ipcMain.handle('project:clearRecent', (): { ok: true } => {
    clearRecentProjects(app.getPath('userData'))
    return { ok: true }
  })

  ipcMain.handle('project:removeFromFrameUi', (_event, rawProjectId): { ok: true } => {
    const projectId = projectIdInputSchema.parse(rawProjectId)
    if (getActiveProject()?.projectId === projectId) { previewProcess.stop(); closeActiveProject() }
    removeProjectFromFrameUi(app.getPath('userData'), projectId)
    return { ok: true }
  })

  ipcMain.handle('project:deleteFromDisk', (_event, raw): { ok: true } => {
    const { projectId, confirmationName } = deleteProjectFromDiskInputSchema.parse(raw)
    if (getActiveProject()?.projectId === projectId) { previewProcess.stop(); closeActiveProject() }
    deleteProjectFromDisk(app.getPath('userData'), projectId, confirmationName)
    return { ok: true }
  })

  ipcMain.handle('project:reveal', (_event, rawProjectId): { ok: boolean } => {
    const project = getRegisteredProject(app.getPath('userData'), projectIdInputSchema.parse(rawProjectId))
    if (!project || !fs.existsSync(project.path)) return { ok: false }
    shell.showItemInFolder(project.path)
    return { ok: true }
  })

  ipcMain.handle('project:getLibraryCover', (_event, rawProjectId): string | null => {
    const projectId = projectIdInputSchema.parse(rawProjectId)
    const captures = captureStore.listCaptures(app.getPath('userData'), projectId).filter((capture) => capture.screenshotFileName)
    const score = (url: string) => /dashboard/i.test(url) ? 4 : /home/i.test(url) ? 3 : new URL(url).pathname === '/' ? 2 : 1
    const selected = captures.sort((a, b) => score(b.url) - score(a.url) || new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())[0]
    return selected ? captureStore.getCaptureScreenshotDataUrl(app.getPath('userData'), projectId, selected.id) : null
  })

  ipcMain.handle('project:openDialog', async (event, rawRelinkId): Promise<OpenProjectResult> => {
    const relinkId = openDialogInputSchema.parse(rawRelinkId)
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined

    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })

    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true }
    }

    const folderPath = result.filePaths[0]
    const name = path.basename(folderPath)
    const project = recordProjectOpened(app.getPath('userData'), folderPath, name, relinkId)
    activateProject(project.id, folderPath, app.getPath('userData'))
    return { cancelled: false, project }
  })

  ipcMain.handle('project:openPath', (_event, rawPath): OpenRecentResult => {
    const folderPath = openPathInputSchema.parse(rawPath)

    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return { ok: false, reason: 'missing' }
    }

    const name = path.basename(folderPath)
    const project = recordProjectOpened(app.getPath('userData'), folderPath, name)
    activateProject(project.id, folderPath, app.getPath('userData'))
    return { ok: true, project }
  })

  ipcMain.handle('project:getIndex', (): ProjectIndex | null => {
    const active = getActiveProject()
    if (!active) return null
    let index = getCachedIndex()
    if (!index) {
      index = getIndexService()!.load((step) => broadcast('project:onIndexProgress', { step }))
      setCachedIndex(index)
    }
    return index
  })

  ipcMain.handle('project:reindex', (): ProjectIndex | null => {
    const active = getActiveProject()
    if (!active) return null
    const index = getIndexService()!.rebuild((step) => broadcast('project:onIndexProgress', { step }))
    setCachedIndex(index)
    return index
  })

  ipcMain.handle('project:selectApplication', (_event, rawId): ProjectIndex | null => {
    if (!getActiveProject()) return null
    const index = getIndexService()!.selectApplication(selectApplicationInputSchema.parse(rawId))
    setCachedIndex(index)
    return index
  })

  ipcMain.handle('project:close', (): { ok: true } => {
    previewProcess.stop()
    closeActiveProject()
    return { ok: true }
  })

  ipcMain.handle('project:getVisuals', () => {
    const active = getActiveProject()
    if (!active) throw new Error('No active project')
    const index = getCachedIndex() ?? getIndexService()!.load()
    return readProjectVisuals(active.rootPath, Object.keys(index.files ?? {}))
  })

  ipcMain.handle('project:getPageStructure', (_event, rawPath): PageStructureItem[] => {
    const relativePath = getPageStructureInputSchema.parse(rawPath)
    const active = getActiveProject()
    if (!active) return []

    let absolutePath: string
    try {
      absolutePath = new PathScope(active.rootPath).resolve(relativePath)
    } catch (err) {
      if (err instanceof PathScopeError) return []
      throw err
    }

    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return []

    const index = getCachedIndex() ?? getIndexService()!.load()
    if (!getCachedIndex()) setCachedIndex(index)
    const components = index.projectModel.components
    const knownComponentNames = new Set(components.map((c) => c.name))
    const componentPathsByName = new Map(components.map((component) => [componentKey(component.name), component.source.filePath]))

    const content = fs.readFileSync(absolutePath, 'utf-8')
    const items = extractPageStructureFromSource(content, absolutePath, knownComponentNames)
    attachComponentPaths(items, componentPathsByName)
    return items
  })
}
