import {documentRequest} from '../../design/documentStore'
import { beginImport, importSignal, setImportProject, cancelImport, finishImport, disposeImport } from '../../artifacts/importJob'
import { unpackPrototypes, servePrototype, stopPrototype, managedPrototypeRoutes } from '../../artifacts/prototypeImport'
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
  const selectedLocations=new Map<number,{kind:string;path:string;files?:string[]}>()
  const importOwners=new WeakSet<Electron.WebContents>()
  let activationSequence=0
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

  ipcMain.handle('project:removeFromFrameUi', async (_event, rawProjectId): Promise<{ ok: true }> => {
    const projectId = projectIdInputSchema.parse(rawProjectId),project=getRegisteredProject(app.getPath('userData'),projectId)
    if (getActiveProject()?.projectId === projectId) { closeActiveProject() }
    await documentRequest('removeProject',path.join(app.getPath('userData'),'design-files','index.json'),projectId)
    removeProjectFromFrameUi(app.getPath('userData'), projectId)
    if(project)stopPrototype(project.path)
    return { ok: true }
  })

  ipcMain.handle('project:deleteFromDisk', async (_event, raw): Promise<{ ok: true }> => {
    const { projectId, confirmationName } = deleteProjectFromDiskInputSchema.parse(raw)
    const project=getRegisteredProject(app.getPath('userData'),projectId)
    if (getActiveProject()?.projectId === projectId) { closeActiveProject() }
    deleteProjectFromDisk(app.getPath('userData'), projectId, confirmationName)
    if(project)stopPrototype(project.path)
    await documentRequest('removeProject',path.join(app.getPath('userData'),'design-files','index.json'),projectId)
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

  ipcMain.handle('project:activate',async(_event,raw)=>{
    const sequence=++activationSequence
    const project=getRegisteredProject(app.getPath('userData'),projectIdInputSchema.parse(raw))
    if(!project||!fs.existsSync(project.path))throw new Error('The project folder is unavailable. Reconnect its repository.')
    const artifact=project.path.startsWith(path.join(app.getPath('userData'),'artifact-projects')+path.sep)
    const url=artifact?await servePrototype(project.path):readRuntime(app.getPath('userData'),project.id)?.url
    if(sequence!==activationSequence)return {url}
    if(artifact&&url)configureRuntime(app.getPath('userData'),project.id,url,'local')
    if(getActiveProject()?.projectId!==project.id)activateProject(project.id,project.path,app.getPath('userData'))
    if(!getCachedIndex())void getIndexService()?.load(step=>broadcast('project:onIndexProgress',{step})).then(index=>{if(getActiveProject()?.projectId===project.id)setCachedIndex(index)}).catch(()=>{})
    return {url}
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
    activationSequence++
    activateProject(project.id, folderPath, app.getPath('userData'))
    return { cancelled: false, project }
  })

  ipcMain.handle('project:selectStarterLocation',async(event,raw)=>{
    const kind=z.enum(['repository','application','prototype','blank']).parse(raw),owner=BrowserWindow.fromWebContents(event.sender)
    const options:Electron.OpenDialogOptions=kind==='prototype'?{title:'Select files to import · ZIP or HTML',properties:['openFile','multiSelections'],filters:[{name:'ZIP or HTML prototype',extensions:['zip','html','htm']}]}:{title:'Select project folder',properties:['openDirectory','createDirectory']}
    const selected=owner?await dialog.showOpenDialog(owner,options):await dialog.showOpenDialog(options)
    if(selected.canceled||!selected.filePaths[0])return null
    selectedLocations.set(event.sender.id,{kind,path:selected.filePaths[0],files:kind==='prototype'?selected.filePaths:undefined})
    return kind==='prototype'?selected.filePaths:selected.filePaths[0]
  })
  ipcMain.handle('project:createStarterProject',(event,raw)=>{
    const {name,kind,parentPath}=z.object({name:z.string().trim().min(1).max(120).refine(value=>!/[\\/]/.test(value)&&!Array.from(value).some(character=>character.charCodeAt(0)<32),'Choose a name without slashes or control characters.'),kind:z.enum(['repository','application','prototype','blank']),parentPath:z.string().max(4096).optional()}).parse(raw)
    const group=kind==='prototype'?'artifact-projects':kind==='application'?'application-projects':kind==='blank'?'blank-projects':'workspace-projects'
    const slug=name.normalize('NFKD').replace(/[^a-zA-Z0-9 _-]/g,'').trim().replace(/\s+/g,'-').slice(0,80)||'project'
    if(parentPath&&(selectedLocations.get(event.sender.id)?.path!==parentPath||selectedLocations.get(event.sender.id)?.kind!==kind||kind==='prototype'))throw new Error('Select a project folder first.')
    const folder=path.join(parentPath??path.join(app.getPath('userData'),group),slug+'-'+randomUUID().slice(0,8))
    fs.mkdirSync(folder,{recursive:true})
    fs.writeFileSync(path.join(folder,'frameui-project.json'),JSON.stringify({version:1,name,kind}))
    const project=recordProjectOpened(app.getPath('userData'),folder,name)
    activateProject(project.id,folder,app.getPath('userData'))
    return project
  })
  ipcMain.handle('project:resumePrototypeImport',async(event,raw)=>{
    const {id,projectId}=z.object({id:z.string().uuid(),projectId:z.string().uuid()}).parse(raw),project=getRegisteredProject(app.getPath('userData'),projectId)
    if(!project||!project.path.startsWith(path.join(app.getPath('userData'),'artifact-projects')+path.sep)||!fs.existsSync(path.join(project.path,'frameui-artifact.json')))throw new Error('Open an imported HTML or ZIP project first.')
    beginImport(event.sender.id,id);setImportProject(event.sender.id,id,{projectId,rootPath:project.path})
    if(!importOwners.has(event.sender)){const ownerId=event.sender.id;importOwners.add(event.sender);event.sender.once('destroyed',()=>disposeImport(ownerId))}
    const url=await servePrototype(project.path);configureRuntime(app.getPath('userData'),projectId,url,'local')
    return {project,url,routes:await managedPrototypeRoutes(project.path)}
  })
  ipcMain.handle('project:cancelPrototypeImport',(event,raw)=>({ok:cancelImport(event.sender.id,z.string().uuid().parse(raw))}))
  ipcMain.handle('project:finishPrototypeImport',(event,raw)=>{finishImport(event.sender.id,z.string().uuid().parse(raw))})
  ipcMain.handle('project:importPrototype',async(event,raw)=>{
    const input=z.union([z.string().uuid(),z.object({id:z.string().uuid(),projectId:z.string().uuid(),file:z.union([z.string().max(4096),z.array(z.string().max(4096)).min(1).max(100)]).optional()})]).parse(raw)
    const id=typeof input==='string'?input:input.id,prepared=typeof input==='string'?undefined:getRegisteredProject(app.getPath('userData'),input.projectId)
    if(prepared&&!prepared.path.startsWith(path.join(app.getPath('userData'),'artifact-projects')+path.sep))throw new Error('Choose a prototype project folder.')
    const signal=beginImport(event.sender.id,id)
    if(!importOwners.has(event.sender)){const ownerId=event.sender.id;importOwners.add(event.sender);event.sender.once('destroyed',()=>disposeImport(ownerId))}
    const owner=BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions={title:'Import HTML prototypes',properties:['openFile','multiSelections'],filters:[{name:'HTML artifact or ZIP prototype',extensions:['html','htm','zip']}]}
    const chosenFile=typeof input==='string'?undefined:input.file
    const chosenFiles=chosenFile?(Array.isArray(chosenFile)?chosenFile:[chosenFile]):undefined
    const authorized=selectedLocations.get(event.sender.id)
    if(chosenFiles&&(authorized?.kind!=='prototype'||chosenFiles.some(file=>!authorized.files?.includes(file))))throw new Error('Select your ZIP or HTML files first.')
    const selected=chosenFiles?{canceled:false,filePaths:chosenFiles}:owner?await dialog.showOpenDialog(owner,options):await dialog.showOpenDialog(options)
    signal.throwIfAborted()
    if(selected.canceled||!selected.filePaths.length)return null
    const files=[...new Set(selected.filePaths)],originalName=path.basename(files[0],path.extname(files[0])),name=prepared?.name??(originalName.replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()||'Imported prototype')
    const folder=prepared?.path??path.join(app.getPath('userData'),'artifact-projects',randomUUID())
    try {
      await unpackPrototypes(files,path.join(folder,'prototype'),signal,(completed,total,detail,file)=>{if(!event.sender.isDestroyed())event.sender.send('project:prototypeImportProgress',{id,stage:'extract',file:path.basename(file),completed,total,detail})})
      importSignal(event.sender.id,id)
      const routes=await managedPrototypeRoutes(folder)
      if(!routes.length||routes.length>100)throw new Error('Choose a runnable prototype with 1–100 HTML pages. Source-only projects need a running app.')
      fs.writeFileSync(path.join(folder,'frameui-artifact.json'),JSON.stringify({version:1,name,originalName,sourceFile:path.basename(files[0]),sourceFiles:files.map(file=>path.basename(file))}))
      const url=await servePrototype(folder)
      signal.throwIfAborted()
      const project=recordProjectOpened(app.getPath('userData'),folder,name)
      setImportProject(event.sender.id,id,{projectId:project.id,rootPath:folder})
      configureRuntime(app.getPath('userData'),project.id,url,'local')
      return {project,url,routes}
    }catch(error){await fs.promises.rm(prepared?path.join(folder,'prototype'):folder,{recursive:true,force:true});throw error}
  })
  ipcMain.handle('project:connectApplication',(_event,raw)=>{
    const input=z.union([z.string().max(4096),z.object({url:z.string().max(4096),projectId:z.string().uuid()})]).parse(raw)
    const prepared=typeof input==='string'?undefined:getRegisteredProject(app.getPath('userData'),input.projectId)
    if(prepared&&JSON.parse(fs.readFileSync(path.join(prepared.path,'frameui-project.json'),'utf8')).kind!=='application')throw new Error('Choose an application project folder.')
    const url=runtimeAddress(typeof input==='string'?input:input.url)
    const key=createHash('sha256').update(url.origin).digest('hex').slice(0,16)
    const folder=prepared?.path??path.join(app.getPath('userData'),'application-projects',key)
    fs.mkdirSync(folder,{recursive:true})
    fs.writeFileSync(path.join(folder,'frameui-application.json'),JSON.stringify({kind:'application-only',origin:url.origin}))
    const project=recordProjectOpened(app.getPath('userData'),folder,prepared?.name??url.host)
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
    activationSequence++
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
