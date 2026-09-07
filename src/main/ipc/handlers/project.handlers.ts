import electron from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { OpenProjectResult, OpenRecentResult } from '@shared/types/project'
import type { ProjectIndex } from '@shared/types/projectIndex'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { recordProjectOpened } from '@core/workspace/models/recentProjectsStore'
import { indexProject } from '@core/indexer/indexProject'
import { extractPageStructure } from '@core/adapters/react/extractPageStructure'
import { PathScope, PathScopeError } from '../../security/pathScope'
import { activateProject, closeActiveProject, getActiveProject, getCachedIndex, setCachedIndex } from '../../state/activeProject'
import { openDialogInputSchema, openPathInputSchema, getPageStructureInputSchema } from '../schemas/project.schema'

const { app, ipcMain, dialog, BrowserWindow } = electron

export function registerProjectHandlers(): void {
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
    activateProject(project.id, folderPath)
    return { cancelled: false, project }
  })

  ipcMain.handle('project:openPath', (_event, rawPath): OpenRecentResult => {
    const folderPath = openPathInputSchema.parse(rawPath)

    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return { ok: false, reason: 'missing' }
    }

    const name = path.basename(folderPath)
    const project = recordProjectOpened(app.getPath('userData'), folderPath, name)
    activateProject(project.id, folderPath)
    return { ok: true, project }
  })

  ipcMain.handle('project:getIndex', (): ProjectIndex | null => {
    const active = getActiveProject()
    if (!active) return null
    let index = getCachedIndex()
    if (!index) {
      index = indexProject(active.projectId, active.rootPath)
      setCachedIndex(index)
    }
    return index
  })

  ipcMain.handle('project:reindex', (): ProjectIndex | null => {
    const active = getActiveProject()
    if (!active) return null
    const index = indexProject(active.projectId, active.rootPath)
    setCachedIndex(index)
    return index
  })

  ipcMain.handle('project:close', (): { ok: true } => {
    closeActiveProject()
    return { ok: true }
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

    const index = getCachedIndex() ?? indexProject(active.projectId, active.rootPath)
    if (!getCachedIndex()) setCachedIndex(index)
    const knownComponentNames = new Set(index.components.map((c) => c.name))

    const content = fs.readFileSync(absolutePath, 'utf-8')
    return extractPageStructure(content, path.extname(absolutePath), knownComponentNames)
  })
}
