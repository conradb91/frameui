import fs from 'node:fs/promises'
import { privateProjectCopy, existingPrivateProjectCopy } from './privateCopy'
import { sanitizeDiagnostics } from '@shared/diagnostics'
import electron from 'electron'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { PathScope } from '../security/pathScope'
import { getActiveProject } from '../state/activeProject'
import { broadcast } from '../ipc/rendererEvents'
import type { HostingSnapshot, HostingOptions, HostingAction, HostingEnvironment, HostingCreatePlan } from '@shared/types/hosting'
import type { PreviewStatusSnapshot } from '@shared/types/preview'

// The vendored CommonJS engine is shipped as a file, not bundled into Vite.
// Its internal handler map never registers Stacker's IPC surface with Electron.
interface EngineProject { id: string; name: string; localUrl: string; framework?: { name: string; id?: string }; database?: { engine: string; managed?: boolean }; databaseTarget?: { classification: string };  process?: { running: boolean }; setup?: { status: string } }
interface Engine {
  initialize(window: Electron.BrowserWindow | null, listener: (channel: string, payload: Record<string, unknown>) => void): Promise<void>
  inspect(root: string): Promise<{ project: EngineProject; plan: { blocking: boolean; steps: HostingSnapshot['steps'] } }>
  snapshot(id: string): EngineProject
  invoke(name: string, ...args: unknown[]): Promise<unknown>
  shutdown(): Promise<void>
}
let engine: Engine | null = null
let busy = false
let operationProject: string | null = null
let scanController: AbortController | null = null
let scanningProjectId: string | null = null
const links = new Map<string, { id: string; root: string; reviewId: string; runtimeVersion?: string; copyRoot?: string; serviceRoots?: string[]; serviceIds?: string[]; cancelled?: boolean }>()
const brand = (text: string) => text.replace(/Stacker/g, 'FrameUI')
function redact(text: string) { return String(sanitizeDiagnostics(text)) }
const sanitize = sanitizeDiagnostics

async function getEngine() {
  engine ??= createRequire(__filename)(path.join(electron.app.getAppPath(), 'hosting/stacker/engine.cjs')) as Engine
  await engine.initialize(electron.BrowserWindow.getAllWindows()[0] ?? null, (channel, payload) => {
    if (operationProject === 'creation') broadcast('hosting:onProgress', { projectId: 'creation', channel, detail: redact(String(payload.detail ?? payload.message ?? payload.status ?? '')) })
    const link = [...links.entries()].find(([id, value]) => value.id === payload.projectId || value.serviceIds?.includes(String(payload.projectId)) || (!payload.projectId && id === operationProject))
    if (!link) return
    const detail = redact(String(payload.detail ?? payload.message ?? payload.line ?? payload.status ?? ''))
    broadcast('hosting:onProgress', { projectId: link[0], channel, detail, stage: typeof payload.stage === 'string' ? payload.stage : undefined })
    if (getActiveProject()?.projectId === link[0] && channel === 'process:state') publish(link[0])
  })
  return engine
}
function active(projectId: string) {
  const project = getActiveProject()
  if (!project || project.projectId !== projectId) throw new Error('This project is no longer active. Reopen its local environment.')
  return project
}
export async function inspectHosting(projectId: string): Promise<HostingSnapshot> {
  const project = active(projectId)
  const host = await getEngine()
  const previous = links.get(projectId)
  const copyRoot = previous?.copyRoot ?? await existingPrivateProjectCopy(project.rootPath, electron.app.getPath('userData'), projectId) ?? undefined
  let serviceRoots = previous?.serviceRoots
  if (!serviceRoots) {
    const { discoverServices } = createRequire(__filename)(path.join(electron.app.getAppPath(), 'hosting/stacker/lib/repository-adapters.cjs')) as { discoverServices: (root: string, options?: { signal: AbortSignal }) => Promise<{ relativeRoot: string }[]> }
    scanController?.abort()
    scanController = new AbortController()
    scanningProjectId = projectId
    serviceRoots = (await discoverServices(project.rootPath, { signal: scanController.signal })).map(service => service.relativeRoot)
    scanningProjectId = null
    if (!serviceRoots.length) serviceRoots = ['']
  }
  const { project: found, plan } = await host.inspect(path.join(copyRoot ?? project.rootPath, serviceRoots[0]))
  active(projectId)
  const reviewId = crypto.randomUUID()
  links.set(projectId, { id: found.id, root: project.rootPath, copyRoot, serviceRoots, serviceIds: previous?.serviceIds, reviewId, runtimeVersion: plan.steps.find(s => s.id === 'runtime' && s.status === 'permission')?.version })
  const snapshot = { projectId, name: path.basename(project.rootPath), framework: found.framework?.name ?? 'Project', prepared: !!copyRoot && await fs.access(path.join(copyRoot, '.frameui-preparation.json')).then(() => true).catch(() => false), localUrl: found.localUrl, running: !!found.process?.running && (!previous?.serviceIds?.length || previous.serviceIds.every(id => host.snapshot(id).process?.running)), ready: !!found.process?.running && (!previous?.serviceIds?.length || previous.serviceIds.every(id => host.snapshot(id).process?.running)), database: found.database?.engine, remoteDatabase: found.databaseTarget?.classification === 'remote', reviewId, blocking: plan.blocking, steps: plan.steps.map(step => ({ ...step, detail: brand(step.detail), label: brand(step.label) })) }
  publish(projectId)
  return snapshot
}
export function hostingPreview(): PreviewStatusSnapshot | null {
  const project = getActiveProject()
  const link = project && links.get(project.projectId)
  if (!link || !engine) return null
  const state = engine.snapshot(link.id)
  const running = (link.serviceIds?.length ? link.serviceIds : [link.id]).every(id => engine!.snapshot(id).process?.running)
  return { status: running ? 'running' : 'stopped', url: running ? state.localUrl : null }
}
function publish(projectId: string) {
  if (getActiveProject()?.projectId !== projectId) return
  const state = hostingPreview()
  if (!state) return
  broadcast('preview:onStatus', { status: state.status })
  if (state.url) broadcast('preview:onUrlDetected', { url: state.url })
}
async function exclusively<T>(run: () => Promise<T>, projectId?: string) {
  if (busy) throw new Error('A local environment operation is already running. Wait for it to finish.')
  busy = true
  operationProject = projectId ?? null
  try { return await run() } finally { busy = false; operationProject = null }
}
export async function prepareHosting(projectId: string, options: HostingOptions) {
  const project = active(projectId)
  const link = links.get(projectId)
  if (!link || link.root !== project.rootPath || link.reviewId !== options.reviewId || !options.approveChanges) throw new Error('Review and approve this project’s setup before continuing.')
  return exclusively(async () => {
    const host = await getEngine()
    active(projectId)
    const original = host.snapshot(link.id)
    if (original.databaseTarget?.classification === 'remote' && ['skip', 'existing'].includes(options.database)) throw new Error('Remote database detected. Choose an isolated local database before preparing this project.')
    // Stop the complete previous service set before synchronizing source or dependencies.
    for (const id of [...(link.serviceIds?.length ? link.serviceIds : [link.id])].reverse()) await host.invoke('processes:stop', id)
    const { discoverServices } = createRequire(__filename)(path.join(electron.app.getAppPath(), 'hosting/stacker/lib/repository-adapters.cjs')) as { discoverServices: (root: string) => Promise<{ relativeRoot: string }[]> }
    const discovered = await discoverServices(project.rootPath)
    active(projectId)
    link.serviceRoots = discovered.length ? discovered.map(service => service.relativeRoot) : ['']
    broadcast('hosting:onProgress', { projectId, channel: 'setup:progress', detail: 'Creating private local copy', stage: 'copy' })
    const copyRoot = await privateProjectCopy(project.rootPath, electron.app.getPath('userData'), projectId)
    active(projectId)
    await fs.writeFile(path.join(copyRoot, '.frameui-preparation.json'), JSON.stringify({ authorized: true, database: options.database }), { mode: 0o600 })
    const copied = await host.inspect(path.join(copyRoot, link.serviceRoots?.[0] ?? ''))
    link.id = copied.project.id
    link.copyRoot = copyRoot
    link.runtimeVersion = copied.plan.steps.find(step => step.id === 'runtime' && step.status === 'permission')?.version
    if (options.database === 'postgres' || options.database === 'mariadb') await host.invoke('database-runtimes:install', options.database)
    link.cancelled = false
    link.serviceIds = []
    try {
    for (const relative of [...(link.serviceRoots ?? [''])].reverse()) {
      active(projectId)
      const service = await host.inspect(path.join(copyRoot, relative))
      if (service.project.databaseTarget?.classification === 'remote' && ['skip', 'existing'].includes(options.database)) throw new Error('Remote database detected in a supporting service. Configure local data before continuing.')
      await host.invoke('projects:connect-services', service.project.id, [...link.serviceIds])
      link.serviceIds.push(service.project.id)
      await host.invoke('projects:setup', service.project.id, {
      runtimeVersion: service.plan.steps.find(step => step.id === 'runtime' && step.status === 'permission')?.version, installDependencies: true, createEnvironment: true,
      environmentMode: 'local', database: options.database,
      databaseMode: options.database === 'existing' ? 'existing' : options.database === 'skip' ? 'skip' : 'create',
      databaseEngine: options.database, startWhenReady: options.startWhenReady, shouldContinue: () => !link.cancelled && getActiveProject()?.projectId === projectId,
      })
    }
    if (options.startWhenReady) {
      broadcast('hosting:onProgress', { projectId, channel: 'setup:progress', detail: 'Checking screens', stage: 'verify' })
      const state = host.snapshot(link.id)
      if (!state.process?.running) throw new Error('The local application stopped before its screens could open.')
      const response = await electron.net.fetch(state.localUrl, { signal: AbortSignal.timeout(20000) })
      if (response.status >= 500 || response.status === 400 || (response.status === 403 && !(await response.text()).trim())) throw new Error('The application could not render its first screen. Check local data and project settings.')
    }
    active(projectId)
    return inspectHosting(projectId)
    } catch (error) {
      for (const id of [...link.serviceIds].reverse()) await host.invoke('processes:stop', id).catch(() => {})
      throw error
    }
  }, projectId)
}
export async function hostingAction(projectId: string, action: HostingAction, confirmation?: string): Promise<unknown> {
  const current = active(projectId)
  const host = await getEngine()
  const link = links.get(projectId)
  if (!link || link.root !== current.rootPath) throw new Error('Review the local environment first.')
  const names: Record<HostingAction, string> = { start: 'processes:start', stop: 'processes:stop', health: 'health:run', logs: 'logs:list', 'migration-status': 'migrations:status', migrate: 'migrations:run', 'restore-database': 'database-services:restore' }
  if (action === 'migrate' || action === 'restore-database') {
    const project = host.snapshot(link.id)
    if (confirmation !== path.basename(current.rootPath)) throw new Error('Type the exact project name to confirm this database operation.')
    if (!project.database?.managed) throw new Error('Database changes here are limited to FrameUI-managed local databases. Configure a local database first.')
  }
  if (action === 'start') {
    const saved = link.copyRoot ? await fs.readFile(path.join(link.copyRoot, '.frameui-preparation.json'), 'utf8').then(text => JSON.parse(text) as { database?: HostingOptions['database'] }).catch(() => null) : null
    const database = saved?.database && ['skip', 'existing', 'sqlite', 'postgres', 'mariadb'].includes(saved.database) ? saved.database : 'skip'
    return prepareHosting(projectId, { reviewId: link.reviewId, approveChanges: true, database, startWhenReady: true })
  }
  const run = async () => {
    if (action === 'stop') {
      const ids = link.serviceIds?.length ? link.serviceIds : [link.id]
      for (const serviceId of [...ids].reverse()) await host.invoke(names[action], serviceId)
      publish(projectId)
      return null
    }
    const method = action === 'restore-database' && host.snapshot(link.id).database?.engine === 'SQLite' ? 'databases:restore' : names[action]
    const result = await host.invoke(method, link.id, action === 'migrate' ? { skipBackup: false } : action === 'restore-database' ? host.snapshot(link.id).name : action === 'logs' ? 100 : undefined)
    publish(projectId)
    return sanitize(result ?? null)
  }
  return ['logs', 'health', 'migration-status'].includes(action) ? run() : exclusively(run, projectId)
}
export async function shutdownHosting() { await engine?.shutdown() }
const creationPlans = new Map<string, { name: string; framework: string; location: string; runtimeVersion?: string; expires: number }>()
export async function planHostingCreation(name: string, framework: string): Promise<HostingCreatePlan | null> {
  const selected = await electron.dialog.showOpenDialog({ title: 'Choose where to create your FrameUI project', properties: ['openDirectory', 'createDirectory'] })
  if (selected.canceled || !selected.filePaths[0]) return null
  const host = await getEngine()
  const plan = await host.invoke('projects:create-plan', { framework, applicationType: 'website', database: 'none' }) as { step: { status: string; detail: string; version?: string } }
  const token = crypto.randomUUID()
  creationPlans.clear()
  creationPlans.set(token, { name, framework, location: selected.filePaths[0], runtimeVersion: plan.step.version, expires: Date.now() + 30 * 60_000 })
  return { token, name, framework, location: path.join(selected.filePaths[0], name), detail: brand(plan.step.detail), blocked: plan.step.status === 'blocked' }
}
export async function createHostedProject(token: string): Promise<string> {
  const plan = creationPlans.get(token)
  if (!plan || plan.expires < Date.now()) throw new Error('Review the new project setup again before creating it.')
  return exclusively(async () => {
    const host = await getEngine()
    creationPlans.delete(token)
    const created = await host.invoke('projects:create', { ...plan, applicationType: 'website', database: 'none', startWhenReady: false }) as { path: string }
    return created.path
  }, 'creation')
}
export async function hostingEnvironment(projectId: string, update?: { file: string; changes: { key: string; value: string }[] }): Promise<HostingEnvironment> {
  const project = active(projectId)
  const host = await getEngine()
  const link = links.get(projectId)
  if (!link || link.root !== project.rootPath) throw new Error('Review the local environment first.')
  if (!link.copyRoot) {
    link.copyRoot = await privateProjectCopy(project.rootPath, electron.app.getPath('userData'), projectId)
    const copied = await host.inspect(path.join(link.copyRoot, link.serviceRoots?.[0] ?? ''))
    link.id = copied.project.id
  }
  if (host.snapshot(link.id).framework?.id === 'dotnet') {
    const root = path.join(link.copyRoot, link.serviceRoots?.[0] ?? '')
    const override = path.join(root, '.env.stacker.local')
    if (!await fs.access(override).then(() => true).catch(() => false)) {
      const read = (file: string) => fs.readFile(path.join(root, file), 'utf8').then(text => JSON.parse(text) as { ConnectionStrings?: Record<string, string> }).catch(() => ({} as { ConnectionStrings?: Record<string, string> }))
      const settings = { ...(await read('appsettings.json')).ConnectionStrings, ...(await read('appsettings.Development.json')).ConnectionStrings }
      const contents = Object.entries(settings).filter(([key]) => /^[A-Za-z0-9_]+$/.test(key)).map(([key, value]) => `ConnectionStrings__${key}=${JSON.stringify(String(value))}`).join('\n')
      await fs.writeFile(override, contents + '\n', { mode: 0o600, flag: 'wx' })
      await host.inspect(root)
    }
  }
  type Raw = { file: string | null; variables: { key: string; value: string; secret: boolean }[] }
  const run = async () => {
    const current = await host.invoke('environment:read', link.id) as Raw
    if (current.file) new PathScope(path.join(link.copyRoot ?? project.rootPath, link.serviceRoots?.[0] ?? '')).resolve(current.file)
    if (update) {
      if (!current.file || current.file !== update.file) throw new Error('The environment file changed. Reload it before saving.')
      const values = new Map(current.variables.map(v => [v.key, v.value]))
      for (const change of update.changes) values.set(change.key, change.value)
      await host.invoke('environment:save', link.id, current.file, [...values].map(([key, value]) => ({ key, value })))
      return hostingEnvironment(projectId)
    }
    return { file: current.file, variables: current.variables.map(v => ({ key: v.key, value: v.secret ? '' : v.value, secret: v.secret, configured: !!v.value })) }
  }
  return update ? exclusively(run, projectId) : run()
}
export async function stopHostingProject(projectId: string) {
  if (scanningProjectId === projectId) scanController?.abort()
  const link = links.get(projectId)
  if (link) link.cancelled = true
  if (link && engine) for (const id of [...(link.serviceIds?.length ? link.serviceIds : [link.id])].reverse()) await engine.invoke('processes:stop', id)
}
