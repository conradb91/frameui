import { beginImport, importSignal, cancelImport, finishImport, disposeImport } from '../../artifacts/importJob'
import { unpackPrototype, servePrototype, managedPrototypeRoutes } from '../../artifacts/prototypeImport'
import { randomUUID } from 'node:crypto'
import {createHash} from 'node:crypto'
import { z } from 'zod'
import { configureRuntime, readRuntime, verifyRuntime, runtimeAddress, isLocalRuntime } from '../../security/runtimePolicy'
import { readProjectVisuals } from '@core/design-system/projectVisuals'
import electron from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { OpenProjectResult, OpenRecentResult, ProjectLibraryEntry } from '@shared/types/project'
import type { ProjectIndex } from '@shared/types/projectIndex'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { renameProject, clearRecentProjects, deleteProjectFromDisk, getRegisteredProject, listAllProjects, recordProjectOpened, removeProjectFromFrameUi, removeProjectFromRecent } from '@core/workspace/models/recentProjectsStore'
import * as captureStore from '@core/workspace/models/captureStore'
import { extractPageStructureFromSource } from '@core/adapters/markup/extractPageStructure'
import { attachComponentPaths, componentKey } from '@core/design-model/buildProjectModel'
import { PathScope, PathScopeError, resolveWithinBoundary } from '../../security/pathScope'
import { activateProject, closeActiveProject, getActiveProject, getCachedIndex, getIndexService, setCachedIndex } from '../../state/activeProject'
import { deleteProjectFromDiskInputSchema, openDialogInputSchema, openPathInputSchema, getPageStructureInputSchema, projectIdInputSchema, selectApplicationInputSchema } from '../schemas/project.schema'
import { broadcast } from '../rendererEvents'

const { app, ipcMain, dialog, BrowserWindow, shell } = electron

export function registerProjectHandlers(): void {
  const importOwners=new WeakSet<Electron.WebContents>()
  const runtimeProject = () => {
    const active = getActiveProject()
    if (!active) throw new Error('Open a local repository first.')
    return active.projectId
  }
  ipcMain.handle('project:getRuntime', () => readRuntime(app.getPath('userData'), runtimeProject()))
  ipcMain.handle('project:configureRuntime', (_event, raw) => {
    const input = z.object({ url: z.string().max(4096), source: z.enum(['local', 'staging', 'production']) }).parse(raw)
    return configureRuntime(app.getPath('userData'), runtimeProject(), input.url, input.source)
  })
  ipcMain.handle('project:verifyRuntime', () => verifyRuntime(app.getPath('userData'), runtimeProject()))
  ipcMain.handle('project:downloadVerification', async event => {
    const projectId = runtimeProject()
    const connection = readRuntime(app.getPath('userData'), projectId)
    if (!connection || connection.source === 'local') throw new Error('Save a staging or production URL first.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('Open verification setup in FrameUI.')
    const result = await dialog.showSaveDialog(owner, {
      title: 'Download domain verification file',
      defaultPath: path.join(app.getPath('downloads'), 'frameui-verification.txt'),
      filters: [{ name: 'Text file', extensions: ['txt'] }],
    })
    if (result.canceled || !result.filePath) return { saved: false }
    const current = readRuntime(app.getPath('userData'), runtimeProject())
    if (runtimeProject() !== projectId || current?.token !== connection.token || current.origin !== connection.origin) throw new Error('The runtime changed. Download the verification file again.')
    await fs.promises.writeFile(result.filePath, connection.token + '\n', 'utf8')
    return { saved: true }
  })


  ipcMain.handle('project:rename', (_event, projectId, name) => {
    if (typeof name !== 'string') throw new Error('Invalid project name.')
    renameProject(app.getPath('userData'), projectIdInputSchema.parse(projectId), name)
    return { ok: true }
  })
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
    if (getActiveProject()?.projectId === projectId) { closeActiveProject() }
    removeProjectFromFrameUi(app.getPath('userData'), projectId)
    return { ok: true }
  })

  ipcMain.handle('project:deleteFromDisk', (_event, raw): { ok: true } => {
    const { projectId, confirmationName } = deleteProjectFromDiskInputSchema.parse(raw)
    if (getActiveProject()?.projectId === projectId) { closeActiveProject() }
    deleteProjectFromDisk(app.getPath('userData'), projectId, confirmationName)
    return { ok: true }
  })

  ipcMain.handle('project:reveal', (_event, rawProjectId): { ok: boolean } => {
    const project = getRegisteredProject(app.getPath('userData'), projectIdInputSchema.parse(rawProjectId))
    if (!project || !fs.existsSync(project.path)) return { ok: false }
    shell.showItemInFolder(project.path)
    return { ok: true }
  })

  ipcMain.handle('project:revealFile', (_event, rawProjectId, rawRelativePath): { ok: boolean } => {
    const project = getRegisteredProject(app.getPath('userData'), projectIdInputSchema.parse(rawProjectId))
    if (!project || !fs.existsSync(project.path) || typeof rawRelativePath !== 'string' || !rawRelativePath) return { ok: false }
    try {
      const target = resolveWithinBoundary(project.path, rawRelativePath)
      if (!fs.existsSync(target)) return { ok: false }
      shell.showItemInFolder(target)
      return { ok: true }
    } catch (err) {
      if (err instanceof PathScopeError) return { ok: false }
      throw err
    }
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

  ipcMain.handle('project:cancelPrototypeImport',(event,raw)=>({ok:cancelImport(event.sender.id,z.string().uuid().parse(raw))}))
  ipcMain.handle('project:finishPrototypeImport',(event,raw)=>{finishImport(event.sender.id,z.string().uuid().parse(raw))})
  ipcMain.handle('project:importPrototype',async(event,raw)=>{
    const id=z.string().uuid().parse(raw),signal=beginImport(event.sender.id,id)
    if(!importOwners.has(event.sender)){const ownerId=event.sender.id;importOwners.add(event.sender);event.sender.once('destroyed',()=>disposeImport(ownerId))}
    const owner=BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions={title:'Import HTML prototype',properties:['openFile'],filters:[{name:'HTML artifact or ZIP prototype',extensions:['html','htm','zip']}]}
    const selected=owner?await dialog.showOpenDialog(owner,options):await dialog.showOpenDialog(options)
    signal.throwIfAborted()
    if(selected.canceled||!selected.filePaths[0])return null
    const file=selected.filePaths[0],originalName=path.basename(file,path.extname(file)),name=originalName.replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()||'Imported prototype'
    const folder=path.join(app.getPath('userData'),'artifact-projects',randomUUID())
    try {
      await unpackPrototype(file,path.join(folder,'prototype'),signal,(completed,total,detail)=>{if(!event.sender.isDestroyed())event.sender.send('project:prototypeImportProgress',{id,stage:'extract',file:path.basename(file),completed,total,detail})})
      importSignal(event.sender.id,id)
      const routes=await managedPrototypeRoutes(folder)
      if(!routes.length||routes.length>100)throw new Error('Choose a runnable prototype with 1–100 HTML pages. Source-only projects need a running app.')
      fs.writeFileSync(path.join(folder,'frameui-artifact.json'),JSON.stringify({version:1,name,originalName,sourceFile:path.basename(file)}))
      const url=await servePrototype(folder)
      signal.throwIfAborted()
      const project=recordProjectOpened(app.getPath('userData'),folder,name)
      activateProject(project.id,folder,app.getPath('userData'))
      configureRuntime(app.getPath('userData'),project.id,url,'local')
      return {project,url,routes}
    }catch(error){await fs.promises.rm(folder,{recursive:true,force:true});throw error}
  })
  ipcMain.handle('project:connectApplication',(_event,raw)=>{
    const url=runtimeAddress(z.string().max(4096).parse(raw))
    const key=createHash('sha256').update(url.origin).digest('hex').slice(0,16)
    const folder=path.join(app.getPath('userData'),'application-projects',key)
    fs.mkdirSync(folder,{recursive:true})
    fs.writeFileSync(path.join(folder,'frameui-application.json'),JSON.stringify({kind:'application-only',origin:url.origin}))
    const project=recordProjectOpened(app.getPath('userData'),folder,url.host)
    activateProject(project.id,folder,app.getPath('userData'))
    configureRuntime(app.getPath('userData'),project.id,url.href,isLocalRuntime(url)?'local':'staging')
    return project
  })
  ipcMain.handle('project:openPath', async (_event, rawPath): Promise<OpenRecentResult> => {
    const folderPath = openPathInputSchema.parse(rawPath)

    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return { ok: false, reason: 'missing' }
    }

    const artifact=folderPath.startsWith(path.join(app.getPath('userData'),'artifact-projects')+path.sep)&&fs.existsSync(path.join(folderPath,'frameui-artifact.json'))
    const name = artifact ? JSON.parse(fs.readFileSync(path.join(folderPath,'frameui-artifact.json'),'utf8')).name : path.basename(folderPath)
    const project = recordProjectOpened(app.getPath('userData'), folderPath, name)
    activateProject(project.id, folderPath, app.getPath('userData'))
    if(artifact)configureRuntime(app.getPath('userData'),project.id,await servePrototype(folderPath),'local')
    return { ok: true, project }
  })

  ipcMain.handle('project:getIndex', async (): Promise<ProjectIndex | null> => {
    const active = getActiveProject()
    if (!active) return null
    let index = getCachedIndex()
    if (!index) {
      index = await getIndexService()!.load((step) => broadcast('project:onIndexProgress', { step }))
      if (getActiveProject()?.projectId === index.projectId) setCachedIndex(index)
    }
    return index
  })

  ipcMain.handle('project:reindex', async (): Promise<ProjectIndex | null> => {
    const active = getActiveProject()
    if (!active) return null
    const index = await getIndexService()!.rebuild((step) => broadcast('project:onIndexProgress', { step }))
    if (getActiveProject()?.projectId === index.projectId) setCachedIndex(index)
    return index
  })

  ipcMain.handle('project:selectApplication', async (_event, rawId): Promise<ProjectIndex | null> => {
    if (!getActiveProject()) return null
    const index = await getIndexService()!.selectApplication(selectApplicationInputSchema.parse(rawId))
    if (getActiveProject()?.projectId === index.projectId) setCachedIndex(index)
    return index
  })

  ipcMain.handle('project:close', (): { ok: true } => {
    closeActiveProject()
    return { ok: true }
  })

  ipcMain.handle('project:getVisuals', async () => {
    const active = getActiveProject()
    if (!active) throw new Error('No active project')
    const index = getCachedIndex() ?? await getIndexService()!.load()
    return readProjectVisuals(active.rootPath, Object.keys(index.files ?? {}), index.projectModel.assetRoots)
  })

  ipcMain.handle('project:getPageStructure', async (_event, rawPath): Promise<PageStructureItem[]> => {
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

    const index = getCachedIndex() ?? await getIndexService()!.load()
    if (!getCachedIndex() && getActiveProject()?.projectId === index.projectId) setCachedIndex(index)
    const components = index.projectModel.components
    const knownComponentNames = new Set(components.map((c) => c.name))
    const componentPathsByName = new Map(components.map((component) => [componentKey(component.name), component.source.filePath]))

    const content = fs.readFileSync(absolutePath, 'utf-8')
    const items = extractPageStructureFromSource(content, absolutePath, knownComponentNames)
    attachComponentPaths(items, componentPathsByName)
    return items
  })
}
