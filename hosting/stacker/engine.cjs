const { app, clipboard, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')

// A crash in an unhandled main-process exception/rejection previously meant
// total silence — no window, no log, nothing to diagnose. Write it to a
// crash-diagnostics file next to the app's own logs (not the app log store
// itself, since that depends on `store` having initialized successfully,
// which may be exactly what failed) so the Logs screen's "Open log folder"
// action still surfaces it.
const { Store } = require('./lib/store.cjs')
const { detectProject, repairedLegacyProjectName } = require('./lib/detector.cjs')
const { ProcessManager } = require('./lib/process-manager.cjs')
const { runHealth } = require('./lib/health.cjs')
const { existingDatabaseConnection, readEnvironment, saveEnvironment, restoreEnvironment, createEnvironmentFromExample, configureDatabaseEnvironment, configureLocalUrlEnvironment, environmentBlock } = require('./lib/environment.cjs')
const { MigrationManager, adapterFor } = require('./lib/migrations.cjs')
const { projectSetup, projectCopy } = require('./lib/copy.cjs')
const { createProject, creatorCommand, runtimeTypeFor } = require('./lib/project-creator.cjs')
const { LocalProxy } = require('./lib/proxy.cjs')
const { RuntimeManager, matchesConstraint } = require('./lib/runtime-manager.cjs')
const { PhpManager, compareVersions: comparePhpVersions } = require('./lib/php-manager.cjs')
const { PhpConfigManager, PHP_CONFIG_FIELDS, validatePhpConfig, serializePhpConfig } = require('./lib/php-config.cjs')
const { ComposerManager } = require('./lib/composer-manager.cjs')
const { DatabaseRuntimeManager } = require('./lib/database-runtime-manager.cjs')
const { DatabaseManager } = require('./lib/database-manager.cjs')
const { DatabaseAdmin } = require('./lib/database-admin.cjs')
const { DatabaseServices } = require('./lib/database-services.cjs')
const { Keychain } = require('./lib/keychain.cjs')
const { listProjectFiles, resolveProjectItem, repairPreview, repairProjectItem } = require('./lib/file-structure.cjs')
const { planProjectSetup } = require('./lib/setup-planner.cjs')
const { openPreparedTerminal } = require('./lib/terminal.cjs')
const { directorySize } = require('./lib/disk-usage.cjs')
const { recipeByName, recipeById, listRecipes, databaseRecommendation, creationRecipeFor, creationCommand } = require('./lib/project-recipe-engine.cjs')
const { configureFrameworkDatabase } = require('./lib/database-integration.cjs')
const { beginSetup, startSetupStep, finishSetupStep, failSetupStep, finishSetup, setupIncompleteStep, reconcileSetupHealth } = require('./lib/setup-state.cjs')
const { GitHubCloneService } = require('./lib/github-clone-service.cjs')
const { ProjectRuntimeStateService, PROJECT_STATUSES } = require('./lib/project-runtime-state.cjs')
const { generateSystemMap, resolveSystemMapSource } = require('./lib/system-map.cjs')
const { sendToWindow } = require('./lib/window-events.cjs')
const { importedProjectRecord, mergeDetectedProject } = require('./lib/project-import.cjs')
const { databaseChoiceFromOptions, inferredManagedDatabaseChoice } = require('./lib/setup-options.cjs')
const { assertNotApplicationSource } = require('./lib/project-path-policy.cjs')

const handlers = new Map()
const ipcMain = { handle: (name, handler) => handlers.set(name, handler) }
let notify = () => {}
let mainWindow = null
let store = null
let manager = null
let isQuitting = false
let localProxy = null
let runtimeManager = null
let phpManager = null
let phpConfigManager = null
let composerManager = null
let dbRuntimeManager = null
let databaseAdmin = null
let pendingOrphans = []
const databaseManager = new DatabaseManager()
let databaseServices = null
let migrationManager = null
let projectRuntimeState = null
let activeCreation = null
const discardableCreationTargets = new Map()
const githubCloneService = new GitHubCloneService()

function stripTerminalFormatting(value) {
  return String(value || '')
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/\r(?=.)/g, '\n')
}

function emit(channel, payload) {
  if (channel === 'process:state' && localProxy) {
    const project = store?.getProject(payload.projectId)
    if (payload.running && project) localProxy.register(project.id, project.localDomain, payload.port, payload.apiPort)
    else localProxy.unregister(payload.projectId)
  }
  if (channel === 'task:changed' && payload.status === 'Completed' && payload.action === 'install') {
    const project = store?.getProject(payload.projectId)
    if (project) detectProject(project.path).then(detected => store.upsertProject({ ...mergeDetectedProject(requireProject(project.id), detected), lastActivity: new Date().toISOString() })).catch(() => null)
    migrationManager?.invalidate(payload.projectId)
  }
  if (channel === 'process:state') projectRuntimeState?.handleProcessState(payload)
  if (channel === 'task:changed' && payload.projectId && ['Completed', 'Failed', 'Cancelled'].includes(payload.status)) {
    void projectRuntimeState?.refresh(payload.projectId, { reason: 'task-changed' }).catch(() => null)
  }
  if (channel === 'migration' && payload.projectId) void projectRuntimeState?.refresh(payload.projectId, { reason: 'migration-changed' }).catch(() => null)
  if (channel === 'database' && ['Running', 'Stopped', 'Initialized'].includes(payload.status)) void projectRuntimeState?.reconcileAll('database-changed').catch(() => null)
  if (channel === 'runtime' && payload.status === 'Complete') void projectRuntimeState?.reconcileAll('runtime-changed').catch(() => null)
  notify(channel, payload)
}

function requireProject(id) {
  const project = store.getProject(id)
  if (!project) throw new Error('Project not found.')
  return project
}

function publicProject(project) {
  const runtimeState = projectRuntimeState?.ensure(project.id)
  const processState = runtimeState?.process || manager.state(project.id)
  return { ...project, setupNextStep: setupIncompleteStep(project), runtimeState, process: processState, migrationSummary: store.getMigrationSummary(project.id), status: runtimeState?.displayStatus || 'Unknown', activePort: processState.port || null, activeApiPort: processState.apiPort || null, proxyPort: localProxy?.port || 4180, localUrl: `http://${project.localDomain}:${localProxy?.port || 4180}` }
}

function sqlitePathFor(project) {
  return project.recipeId?.includes('-vite-express-') ? 'server/database/database.sqlite' : project.framework?.id === 'codeigniter' ? 'writable/database.sqlite' : 'database/database.sqlite'
}

async function persistProjectDatabase(project, connection) {
  connection = { ...connection, managed: true }
  const configured = await configureDatabaseEnvironment(project, connection)
  const service = connection.engine !== 'SQLite'
  const safeUrl = connection.engine === 'PostgreSQL'
    ? `postgresql://${connection.username}@${connection.host}:${connection.port}/${connection.database}`
    : connection.engine === 'MariaDB/MySQL'
      ? `mysql://${connection.username}@${connection.host}:${connection.port}/${connection.database}`
      : null
  const safeConnection = service ? { ...connection, password: '[KEYCHAIN]', url: safeUrl } : connection
  const detected = await detectProject(project.path)
  const updated = store.upsertProject({ ...mergeDetectedProject(project, detected), name: project.name, runtimeSelection: project.runtimeSelection, phpConfig: project.phpConfig, database: safeConnection, databaseHints: [...new Set([...(detected.databaseHints || []), connection.engine])], lastActivity: new Date().toISOString() })
  if (configured.changed) store.appendLog(project.id, 'environment', 'info', `Updated ${configured.updatedKeys.join(', ')} for the new ${connection.engine} database.`)
  migrationManager?.invalidate(project.id)
  return updated
}

async function executeSetupStep(project, id, { state = 'Configuring', detail, command = null }, operation) {
  let current = store.upsertProject(startSetupStep(project, id, { state, command }))
  emit('setup:progress', { projectId: current.id, stage: id, detail, status: 'running', timestamp: new Date().toISOString() })
  emit('task:changed', setupTask(current, current.setup.steps[id]))
  try {
    const value = await operation(current)
    if (value?.project) current = value.project
    const task = value?.task || value?.result?.task
    current = store.upsertProject(finishSetupStep(current, id, {
      command: task?.command || command,
      stdout: value?.stdout || value?.result?.stdout || '',
      stderr: value?.stderr || value?.result?.stderr || '',
      exitCode: task?.exitCode ?? 0,
    }))
    emit('setup:progress', { projectId: current.id, stage: id, detail, status: 'completed', timestamp: new Date().toISOString() })
    emit('task:changed', setupTask(current, current.setup.steps[id]))
    return { project: current, value }
  } catch (error) {
    current = store.upsertProject(failSetupStep(current, id, error, { command: error.command || command, exitCode: error.exitCode ?? null }))
    emit('setup:progress', { projectId: current.id, stage: id, detail: error.message, status: 'failed', timestamp: new Date().toISOString() })
    emit('task:changed', setupTask(current, current.setup.steps[id]))
    throw error
  }
}

function setupTask(project, step) {
  const statuses = { pending: 'Pending', running: 'Running', completed: 'Completed', failed: 'Failed' }
  return {
    id: `${project.id}:setup:${step.id}`, projectId: project.id, projectName: project.name,
    action: `setup:${step.id}`, kind: 'setup', status: statuses[step.status] || 'Pending',
    command: step.command, detail: step.status === 'failed' ? step.stderr : null,
    stdout: step.stdout || '', stderr: step.stderr || '', exitCode: step.exitCode,
    startedAt: step.startedAt || project.setup?.startedAt, finishedAt: step.finishedAt || null,
  }
}

function setupTasks(projectId = null) {
  return store.listProjects().filter(project => !projectId || project.id === projectId)
    .flatMap(project => Object.values(project.setup?.steps || {}).map(step => setupTask(project, step)))
}

async function refreshOpenedProject(project) {
  const detected = await detectProject(project.path)
  let refreshed = store.upsertProject({
    ...mergeDetectedProject(project, detected),
    name: project.name,
    runtimeSelection: project.runtimeSelection,
    phpConfig: project.phpConfig,
    database: project.database,
    status: project.status,
    lastActivity: new Date().toISOString(),
  })
  // Opening a project only refreshes metadata; setup owns all file writes.
  return refreshed
}

async function runAndPersistHealth(project, processState = manager.state(project.id), migrationSummary = store.getMigrationSummary(project.id), authoritativeProject = false) {
  if (authoritativeProject) return runHealth(project, processState, runtimeManager, databaseServices, databaseManager, localProxy, migrationSummary, phpManager)
  if (projectRuntimeState) return (await projectRuntimeState.refresh(project.id, { reason: 'health-check' }))?.health
  return runHealth(project, processState, runtimeManager, databaseServices, databaseManager, localProxy, migrationSummary, phpManager)
}

function writeClipboard(contents, sensitive = false) {
  clipboard.writeText(contents)
  const clearsInSeconds = sensitive ? store.getSettings().clipboardClearSeconds : 0
  if (clearsInSeconds > 0) {
    setTimeout(() => {
      if (clipboard.readText() === contents) clipboard.clear()
    }, clearsInSeconds * 1000).unref()
  }
  return { copied: true, includesSecrets: sensitive, clearsInSeconds }
}

function safeDiagnosticContents() {
  const redact = value => String(value)
    .replace(/:\/\/[^\s:/]+:[^\s@]+@/g, '://[REDACTED]@')
    .replace(/\b(password|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
  const limit = store.getSettings().supportExportRecords
  const records = store.readGlobalLogs(limit).map(record => `${record.timestamp} [${record.projectName}] ${record.source}/${record.level}: ${redact(record.message).trim()}`)
  return [`Stacker support diagnostics`, `Generated: ${new Date().toISOString()}`, `Projects: ${store.listProjects().length}`, `Log records: ${records.length}`, '', ...(records.length ? records : ['No Stacker log records are available.'])].join('\n')
}

function publicSettings() {
  return { ...store.getSettings(), runtimeStoragePath: runtimeManager?.root || null }
}

async function assertManageableProjectPath(projectPath) {
  const manifest = await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
    .then(contents => JSON.parse(contents))
    .catch(() => null)
  assertNotApplicationSource(projectPath, app.getAppPath(), manifest)
}

function registerIpc() {
  ipcMain.handle('settings:get', () => publicSettings())
  ipcMain.handle('settings:save', (_event, patch) => { store.updateSettings(patch); return publicSettings() })
  ipcMain.handle('settings:choose-project-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose the default projects folder', defaultPath: store.getSettings().defaultProjectDirectory, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('settings:open-runtime-folder', async () => {
    await fs.mkdir(runtimeManager.root, { recursive: true })
    return shell.openPath(runtimeManager.root)
  })
  ipcMain.handle('projects:list', () => store.listProjects().map(publicProject))
  ipcMain.handle('projects:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Open an existing project', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    await assertManageableProjectPath(result.filePaths[0])
    const detected = await detectProject(result.filePaths[0])
    return { ...detected, setupPlan: await planProjectSetup(detected, runtimeManager, phpManager) }
  })
  ipcMain.handle('projects:choose-open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose a project folder', properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('projects:inspect-path', async (_event, projectPath) => {
    if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) throw new Error('A valid absolute project path is required.')
    const stat = await fs.stat(projectPath).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('The preserved project folder could not be found.')
    await assertManageableProjectPath(projectPath)
    const detected = await detectProject(projectPath)
    const existing = store.getProject(detected.id)
    const project = existing ? { ...mergeDetectedProject(existing, detected), name: existing.name, setup: existing.setup, database: existing.database, runtimeSelection: existing.runtimeSelection, packageManagerConfirmed: existing.packageManagerConfirmed } : detected
    return { ...project, alreadyImported: Boolean(existing), setupPlan: await planProjectSetup(project, runtimeManager, phpManager) }
  })
  ipcMain.handle('projects:choose-location', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose where to create the project', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('projects:choose-clone-destination', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose where to save the repository', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('projects:clone-github', async (_event, options) => githubCloneService.clone(options, payload => {
    emit('clone:progress', { ...payload, detail: stripTerminalFormatting(payload.detail), timestamp: new Date().toISOString() })
  }))
  ipcMain.handle('projects:cancel-clone', () => githubCloneService.cancel())
  ipcMain.handle('projects:recipes', () => listRecipes({ productionOnly: true, creatableOnly: true }))
  ipcMain.handle('projects:create-plan', async (_event, request) => {
    const framework = typeof request === 'string' ? request : request?.framework
    const applicationType = typeof request === 'object' ? request.applicationType || 'website' : 'website'
    const requestedDatabase = typeof request === 'object' ? request.database : null
    const recipe = recipeByName(framework)
    const creationRecipe = recipe.id === 'astro' ? { ...recipe, database: { ...recipe.database, supported: [], recommended: { default: 'none' } } } : recipe
    const selectedDatabase = requestedDatabase || databaseRecommendation(creationRecipe, applicationType)
    const effectiveRecipe = creationRecipeFor(creationRecipe, applicationType, selectedDatabase)
    const runtimeType = runtimeTypeFor(framework)
    const structure = effectiveRecipe.composite
      ? { kind: 'full-stack', label: `${recipe.name} frontend + Express API${selectedDatabase === 'none' ? '' : ` + ${effectiveRecipe.composite.databaseName}`}`, paths: ['client/', 'server/', 'scripts/start.mjs'] }
      : { kind: applicationType === 'api' ? 'api' : 'native', label: applicationType === 'api' ? `${recipe.name} API` : `${recipe.name} project`, paths: ['.'] }
    const details = { recipe: creationRecipe, effectiveRecipe, runtimeType, packageManager: recipe.packageManagers.recommended, database: selectedDatabase, applicationType, structure }
    if (!runtimeType) return { ...details, step: { id: 'runtime', status: 'ready', detail: 'This project type does not require a managed runtime to scaffold.' } }
    const manager = runtimeType === 'node' ? runtimeManager : phpManager
    const runtimeProbe = { runtime: { constraint: recipe.runtime?.minimum ? `>=${recipe.runtime.minimum}` : null }, framework: { language: recipe.language } }
    const compatiblePath = await manager.executablePath(runtimeProbe).catch(() => null)
    const available = (await manager.list()).filter(runtime => runtimeType !== 'php' || !runtime.broken)
    const compatible = runtimeType === 'node' ? available.filter(runtime => matchesConstraint(runtime.version, runtimeProbe.runtime.constraint)) : available.filter(runtime => runtime.path === compatiblePath)
    const preferredMajor = String(recipe.runtime?.recommended || '')
    const preferredInstalled = compatible.find(runtime => runtime.version.replace(/^v/, '').startsWith(`${preferredMajor}.`))
    const installed = preferredInstalled ? [preferredInstalled] : compatible.slice(0, 1)
    if (installed.length) return { ...details, step: { id: 'runtime', status: 'ready', detail: `Using managed ${runtimeType === 'node' ? 'Node.js' : 'PHP'} ${installed[0].version} to scaffold this project.`, version: installed[0].version } }
    const catalog = await manager.catalog().catch(() => [])
    if (!catalog.length) return { ...details, step: { id: 'runtime', status: 'blocked', detail: 'No trusted catalogue release is available for this Mac.' } }
    const release = runtimeType === 'node' ? catalog[0] : [...catalog].sort((a, b) => comparePhpVersions(a.version, b.version))[0]
    return { ...details, step: { id: 'runtime', label: `Install ${runtimeType === 'node' ? 'Node.js' : 'PHP'} ${release.version}`, status: 'permission', detail: `Download and verify the ${release.architecture} package before scaffolding.`, version: release.version } }
  })
  ipcMain.handle('projects:create', async (_event, options) => {
    if (!options || typeof options !== 'object') throw new Error('Invalid project options.')
    let applicationType = options.applicationType || 'website'
    const baseRecipe = recipeByName(options.framework)
    if (baseRecipe.id === 'unknown' || !baseRecipe.create) throw new Error('That framework is not enabled for project creation.')
    const packageManager = options.packageManager || baseRecipe.packageManagers.recommended
    const databaseChoice = options.database || databaseRecommendation(baseRecipe, applicationType)
    if (applicationType === 'website' && databaseChoice !== 'none' && ['react', 'vue', 'vite'].includes(baseRecipe.id)) applicationType = 'webapp'
    const recipe = creationRecipeFor(baseRecipe, applicationType, databaseChoice)
    if (baseRecipe.id === 'astro' && databaseChoice !== 'none') throw new Error('A new Astro project is static by default. Configure an SSR adapter before attaching a runtime database.')
    if (databaseChoice !== 'none' && !baseRecipe.database.supported.includes(databaseChoice)) {
      throw new Error(`${baseRecipe.name} does not support the selected database.`)
    }
    const controller = new AbortController()
    const creationTarget = path.join(path.resolve(options.location), options.name)
    activeCreation = { controller, target: creationTarget, projectId: null, startedDatabaseEngines: new Set() }
    const progress = (stage, detail, status = 'running') => {
      if (controller.signal.aborted) throw Object.assign(new Error('Project setup was cancelled. The incomplete folder was preserved.'), { code: 'CREATE_CANCELLED' })
      emit('create:progress', { stage, detail: stripTerminalFormatting(detail), status, timestamp: new Date().toISOString() })
    }
    const runtimeStartedAt = new Date().toISOString()
    progress('runtime', 'Resolving the managed runtime…')
    const runtimeType = runtimeTypeFor(options.framework)
    let managedBinDir = null
    let composerPharPath = null
    let runtimeVersionUsed = null
    if (runtimeType) {
      const manager = runtimeType === 'node' ? runtimeManager : phpManager
      const runtimeProbe = { runtime: { constraint: baseRecipe.runtime?.minimum ? `>=${baseRecipe.runtime.minimum}` : null }, framework: { language: baseRecipe.language } }
      let available = (await manager.list()).filter(runtime => runtimeType !== 'php' || !runtime.broken)
      const compatiblePath = await manager.executablePath(runtimeProbe).catch(() => null)
      let compatible = runtimeType === 'node' ? available.filter(runtime => matchesConstraint(runtime.version, runtimeProbe.runtime.constraint)) : available.filter(runtime => runtime.path === compatiblePath)
      const preferredInstalled = compatible.find(runtime => runtime.version.replace(/^v/, '').startsWith(`${String(baseRecipe.runtime?.recommended || '')}.`))
      let installed = preferredInstalled ? [preferredInstalled] : compatible.slice(0, 1)
      if (!installed.length) {
        const catalog = await manager.catalog().catch(() => [])
        const preferred = String(baseRecipe.runtime?.recommended || '')
        const release = (runtimeType === 'node' ? catalog.find(item => item.version.replace(/^v/, '').startsWith(`${preferred}.`)) : null)
          || (runtimeType === 'node' ? catalog[0] : [...catalog].sort((a, b) => comparePhpVersions(a.version, b.version))[0])
        if (!release || options.runtimeVersion !== release.version) throw new Error(`Approve the isolated ${runtimeType === 'node' ? 'Node.js' : 'PHP'} ${release?.version || ''} download before creating this project.`)
        progress('runtime', `Downloading and verifying ${runtimeType === 'node' ? 'Node.js' : 'PHP'} ${release.version}…`)
        await manager.install(release.version)
        installed = (await manager.list()).filter(runtime => runtimeType !== 'php' || !runtime.broken)
      }
      managedBinDir = installed[0].path
      runtimeVersionUsed = installed[0].version
      if (runtimeType === 'php') {
        if (!composerManager.cachedPath()) {
          progress('composer', 'Installing verified Composer…')
          await composerManager.install(path.join(managedBinDir, process.platform === 'win32' ? 'php.exe' : 'php')).catch(() => null)
        }
        composerPharPath = composerManager.cachedPath()
      }
    }
    const temporaryId = `create-${Date.now()}`
    const scaffoldStartedAt = new Date().toISOString()
    progress('scaffold', `Running the official ${options.framework} project creator…`)
    let scaffoldStdout = ''
    let scaffoldStderr = ''
    const target = await createProject({ ...options, packageManager }, (level, rawMessage) => {
      const message = stripTerminalFormatting(rawMessage)
      if (level === 'error') scaffoldStderr += message
      else scaffoldStdout += message
      emit('log', { projectId: temporaryId, timestamp: new Date().toISOString(), source: 'create', level, message })
      const detail = String(message).trim().split(/\r?\n/).filter(Boolean).at(-1)
      if (detail) progress('scaffold', detail.slice(0, 180))
    }, { managedBinDir, composerPharPath, signal: controller.signal })
    progress('inspect', 'Inspecting the created project…')
    const detected = await detectProject(target)
    detected.localDomain = `${detected.localDomain.replace(/\.localhost$/, '')}-${require('crypto').createHash('sha256').update(target).digest('hex').slice(0, 6)}.localhost`
    const stepIds = ['runtime', 'scaffold', 'dependencies', ...(databaseChoice !== 'none' ? ['database', 'database-integration'] : []), 'environment', 'migrations', 'start', 'verify']
    let project = beginSetup({ ...detected, name: options.name.trim(), applicationType, runtimeSelection: runtimeVersionUsed, packageManager, packageManagerConfirmed: true, status: 'New', pinned: false, createdAt: new Date().toISOString(), lastActivity: new Date().toISOString() }, 'create', stepIds)
    project = finishSetupStep(project, 'runtime', { startedAt: runtimeStartedAt, command: null, stdout: runtimeVersionUsed ? `Managed ${recipe.runtime.type} ${runtimeVersionUsed}` : 'No managed runtime required.' })
    const scaffoldSpec = recipe.composite ? creationCommand(baseRecipe, 'client', packageManager) : creatorCommand(options.framework, options.name, packageManager)
    project = finishSetupStep(project, 'scaffold', { startedAt: scaffoldStartedAt, command: [scaffoldSpec[0], ...scaffoldSpec[1]].join(' '), stdout: scaffoldStdout, stderr: scaffoldStderr })
    project = store.upsertProject(project)
    if (activeCreation) activeCreation.projectId = project.id
    store.appendLog(project.id, 'project', 'info', `Created ${project.path} with the official ${options.framework} project tooling.`)
    if (!project.dependenciesInstalled) {
      const executed = await executeSetupStep(project, 'dependencies', { state: 'Installing', detail: `Installing dependencies with ${packageManager}…` }, async current => {
        const result = await manager.runCommand(current, 'install', require('./lib/process-manager.cjs').commandFor(current, 'install'), { cwd: current.dependencyRoot || current.path })
        if (result.task.status !== 'Completed') {
          const error = new Error(`Dependency installation failed with exit code ${result.task.exitCode}.`)
          error.exitCode = result.task.exitCode
          error.command = result.task.command
          throw error
        }
        return result
      })
      project = executed.project
      const refreshed = await detectProject(project.path)
      project = store.upsertProject({ ...mergeDetectedProject(project, refreshed), name: project.name, setup: project.setup, runtimeSelection: project.runtimeSelection, applicationType, packageManager, packageManagerConfirmed: true })
    } else project = store.upsertProject(finishSetupStep(project, 'dependencies', { stdout: 'Dependencies were installed by the official creator.' }))
    if (databaseChoice !== 'none') {
      const created = await executeSetupStep(project, 'database', { state: 'Configuring', detail: `Creating and configuring ${databaseChoice === 'postgres' ? 'PostgreSQL' : databaseChoice === 'mariadb' ? 'MariaDB/MySQL' : 'SQLite'}…` }, async current => {
        if (databaseChoice === 'sqlite') {
          const info = await databaseManager.createSqlite(current, sqlitePathFor(current))
          return { project: await persistProjectDatabase(current, { engine: 'SQLite', file: info.file, relativePath: info.relativePath }) }
        }
        const serviceBefore = await databaseServices.status(databaseChoice)
        if (!serviceBefore.running) activeCreation?.startedDatabaseEngines.add(databaseChoice)
        const connection = await databaseServices.createForProject(databaseChoice, current)
        const configured = await persistProjectDatabase(current, connection)
        const tested = await databaseServices.testConnection(configured)
        if (!tested.connected) throw new Error(tested.error || 'The new database connection test failed.')
        return { project: configured, stdout: `Database connection passed in ${tested.latencyMs}ms.` }
      })
      project = created.project
      const integrated = await executeSetupStep(project, 'database-integration', { state: 'Configuring', detail: `Installing and configuring the ${recipe.name} server-side database integration…` }, async current => configureFrameworkDatabase(current, databaseChoice, manager))
      project = integrated.project
    }
    const environmentResult = await executeSetupStep(project, 'environment', { state: 'Configuring', detail: 'Synchronizing the local application environment…' }, async current => {
      const configuredUrl = await configureLocalUrlEnvironment(current, localProxy?.port || 4180)
      return { stdout: configuredUrl.changed ? `Updated ${configuredUrl.updatedKeys.join(', ')}.` : 'No local URL variables were required.' }
    })
    project = environmentResult.project
    const afterConfiguration = await detectProject(project.path)
    project = store.upsertProject({ ...mergeDetectedProject(project, afterConfiguration), name: project.name, setup: project.setup, runtimeSelection: project.runtimeSelection, database: project.database, applicationType, packageManager, packageManagerConfirmed: true })
    project = store.upsertProject(finishSetupStep(project, 'migrations', { stdout: 'Migration discovery complete. Run migrations manually from Migrations.' }))
    if (options.startWhenReady !== false) {
      const startSpec = require('./lib/process-manager.cjs').commandFor(project, 'start')
      const started = await executeSetupStep(project, 'start', { state: 'Starting', detail: `Starting ${recipe.name} as a managed service…`, command: startSpec ? [startSpec[0], ...startSpec[1]].join(' ') : null }, async current => ({ state: await manager.start(current, { keepRunning: Boolean(store.getSettings().keepServicesRunning) }) }))
      project = started.project
      const verified = await executeSetupStep(project, 'verify', { state: 'Starting', detail: 'HTTP health check passed.' }, async current => ({ stdout: manager.state(current.id).health || 'HTTP application readiness passed.' }))
      project = store.upsertProject(finishSetup(verified.project, 'Running'))
      project = store.upsertProject({ ...project, activePort: manager.state(project.id).port, lastStarted: new Date().toISOString(), lastActivity: new Date().toISOString() })
      const migrations = migrationManager ? await migrationManager.status(project, { force: true }).catch(() => null) : null
      await runAndPersistHealth(project, manager.state(project.id), migrations, true)
      project = requireProject(project.id)
      if (project.browserOnStart ?? store.getSettings().browserOnStart) shell.openExternal(`http://${project.localDomain}:${localProxy.port}`)
    } else {
      project = store.upsertProject(finishSetup(finishSetupStep(finishSetupStep(project, 'start', { stdout: 'Start deferred by user.' }), 'verify', { stdout: 'Verification deferred until start.' }), 'Stopped'))
    }
    progress('complete', 'Project created, configured, and verified.', 'completed')
    activeCreation = null
    return publicProject(project)
  })
  ipcMain.handle('projects:cancel-create', async () => {
    if (!activeCreation) return { cancelled: false }
    const { controller, target, projectId, startedDatabaseEngines } = activeCreation
    controller.abort()
    if (projectId) {
      await manager.stop(projectId).catch(() => null)
      for (const task of store.listTasks(projectId).filter(item => item.status === 'Running')) manager.cancel(task.id)
    }
    await Promise.all([...startedDatabaseEngines].map(engine => databaseServices.stop(engine).catch(() => null)))
    discardableCreationTargets.set(path.resolve(target), projectId)
    activeCreation = null
    return { cancelled: true, target }
  })
  ipcMain.handle('projects:discard-incomplete', async (_event, target) => {
    const resolved = path.resolve(String(target || ''))
    if (!discardableCreationTargets.has(resolved)) throw new Error('That folder is not registered as a cancelled Stacker creation.')
    const projectId = discardableCreationTargets.get(resolved)
    await fs.rm(resolved, { recursive: true, force: true })
    discardableCreationTargets.delete(resolved)
    if (projectId) { phpConfigManager.remove(projectId); store.removeProject(projectId) }
    return { removed: true, target: resolved }
  })
  ipcMain.handle('projects:import', async (_event, projectPath) => {
    await assertManageableProjectPath(projectPath)
    emit('setup:progress', { projectId: null, stage: 'reading', detail: 'Reading project files…', status: 'running', timestamp: new Date().toISOString() })
    const detected = await detectProject(projectPath)
    emit('setup:progress', { projectId: detected.id, stage: 'reading', detail: 'Project files read.', status: 'completed', timestamp: new Date().toISOString() })
    emit('setup:progress', { projectId: detected.id, stage: 'stack', detail: `${detected.framework.name} and ${detected.runtime?.type || 'static runtime'} detected.`, status: 'completed', timestamp: new Date().toISOString() })
    emit('setup:progress', { projectId: detected.id, stage: 'dependencies-check', detail: detected.dependenciesInstalled ? 'Project dependencies are present.' : 'Dependencies need to be installed.', status: 'completed', timestamp: new Date().toISOString() })
    emit('setup:progress', { projectId: detected.id, stage: 'runtime-check', detail: detected.runtime?.constraint ? `Runtime requirement: ${detected.runtime.constraint}.` : 'No explicit runtime constraint detected.', status: 'completed', timestamp: new Date().toISOString() })
    const existing = store.getProject(detected.id)
    const initialPlan = await planProjectSetup(existing ? { ...mergeDetectedProject(existing, detected), setup: existing.setup, database: existing.database } : detected, runtimeManager, phpManager)
    const project = store.upsertProject(importedProjectRecord(existing, detected, initialPlan))
    store.appendLog(project.id, 'project', 'info', `Imported ${project.path}`)
    return publicProject(project)
  })
  ipcMain.handle('projects:activate', async (_event, id) => {
    const project = await refreshOpenedProject(requireProject(id))
    await projectRuntimeState.refresh(id, { reason: 'project-opened' })
    return publicProject(requireProject(id))
  })
  ipcMain.handle('projects:connect-services', async (_event,id,serviceIds) => {
    const project = requireProject(id)
    const services = serviceIds.filter(serviceId=>serviceId!==id).map(requireProject)
    localProxy.connectServices(id,services.map(service=>service.id))
    return require('./lib/service-connections.cjs').configureServiceConnections({...project,localUrl:`http://${project.localDomain}:${localProxy.port}`},services)
  })
  ipcMain.handle('projects:setup-plan', (_event, id) => planProjectSetup(requireProject(id), runtimeManager, phpManager))
  ipcMain.handle('projects:setup', async (_event, id, options = {}) => {
    let project = requireProject(id)
    const progress = (stage, detail) => emit('setup:progress', { projectId: id, stage, detail, timestamp: new Date().toISOString() })
    progress('plan', 'Rechecking completed and remaining setup steps…')
    if (options.packageManager && project.framework?.language === 'JavaScript') {
      if (!['npm', 'pnpm', 'yarn', 'bun'].includes(options.packageManager)) throw new Error('Select a supported package manager.')
      project = store.upsertProject({ ...project, packageManager: options.packageManager, packageManagerConfirmed: true })
    }
    const plan = await planProjectSetup(project, runtimeManager, phpManager)
    const blockingStep = plan.steps.find(step => step.status === 'blocked')
    if (blockingStep) throw new Error(blockingStep.detail)
    const databaseStep = plan.steps.find(step => step.id === 'database')
    let databaseChoice = databaseChoiceFromOptions(options)
    if (databaseChoice === 'skip' && !options.databaseMode) {
      const inferredChoice = inferredManagedDatabaseChoice(project)
      if (inferredChoice) {
        databaseChoice = inferredChoice
        store.appendLog(id, 'setup', 'warning', `Legacy setup selection reported skip; using the single detected local database engine (${inferredChoice}) instead.`)
      }
    }
    store.appendLog(id, 'setup', 'info', `Guided setup choices resolved: database=${databaseChoice || 'none'}, mode=${options.databaseMode || 'legacy'}, engine=${options.databaseEngine || 'none'}.`)
    store.appendLog(id, 'setup', 'info', `Guided setup database selection: mode=${options.databaseMode || 'legacy'}, engine=${options.databaseEngine || 'none'}, resolved=${databaseChoice || 'none'}.`)
    if (project.databaseTarget?.classification === 'remote' && !['existing', 'sqlite', 'postgres', 'mariadb'].includes(databaseChoice)) throw new Error(`Remote database detected at ${project.databaseTarget.host}. Choose Use Existing Connection, Create Local Database, or Cancel.`)
    const dependenciesStep = plan.steps.find(step => step.id === 'dependencies')
    const environmentStep = plan.steps.find(step => step.id === 'environment')
    if (databaseStep?.required && !['skip', 'existing', 'sqlite', 'postgres', 'mariadb'].includes(databaseChoice)) throw new Error(`Choose how the local ${databaseStep.engines?.[0] || 'project'} database connection should be configured.`)
    if (dependenciesStep?.required && dependenciesStep.status === 'recommended' && !options.installDependencies) throw new Error('Install the detected project dependencies before continuing setup.')
    if (environmentStep?.required && environmentStep.status === 'recommended' && !options.createEnvironment) throw new Error('Create the local environment file before continuing setup.')
    if (['local', 'existing'].includes(options.environmentMode)) project = store.upsertProject({ ...project, environmentMode: options.environmentMode })
    const setupSteps = [...plan.steps.map(step => ({ id: step.id, required: Boolean(step.required) })), { id: 'verify', required: false }]
    project = beginSetup(project, 'import', setupSteps)
    for (const step of plan.steps.filter(item => item.status === 'ready')) project = finishSetupStep(project, step.id, { stdout: step.detail })
    project = store.upsertProject(project)
    const runtimeStep = plan.steps.find(step => step.id === 'runtime')
    if (runtimeStep?.status === 'ready' && runtimeStep.version && runtimeStep.version !== 'compatible') {
      project = store.upsertProject({ ...project, runtimeSelection: runtimeStep.version, runtimeSource: runtimeStep.source || 'managed', lastActivity: new Date().toISOString() })
      store.appendLog(project.id, 'runtime', 'info', `Selected ${runtimeStep.source || 'managed'} ${project.runtime?.type || 'runtime'} ${runtimeStep.version} for this project.`)
    }
    if (runtimeStep?.status === 'permission') {
      const isPhp = project.runtime?.type === 'PHP'
      if (options.runtimeVersion !== runtimeStep.version) throw new Error(`Approve the isolated ${isPhp ? 'PHP' : 'Node.js'} ${runtimeStep.version} download before continuing setup.`)
      const installed = await executeSetupStep(project, 'runtime', { state: 'Installing', detail: `Downloading and verifying ${isPhp ? 'PHP' : 'Node.js'} ${runtimeStep.version}…` }, async current => {
        await (isPhp ? phpManager : runtimeManager).install(runtimeStep.version)
        return { project: store.upsertProject({ ...current, runtimeSelection: runtimeStep.version, runtimeSource: 'managed', lastActivity: new Date().toISOString() }) }
      })
      project = installed.project
      store.appendLog(project.id, 'runtime', 'info', `Selected managed ${isPhp ? 'PHP' : 'Node.js'} ${runtimeStep.version} for this project.`)
    }
    if (project.runtime?.type === 'PHP' && project.packageManager === 'composer' && !project.dependenciesInstalled) {
      const bootstrap = phpManager.cachedPath(project)
      if (bootstrap && !(await composerManager.info(path.join(bootstrap, process.platform === 'win32' ? 'php.exe' : 'php'))).version) {
        progress('composer', 'Installing verified Composer…')
        await composerManager.install(path.join(bootstrap, process.platform === 'win32' ? 'php.exe' : 'php'))
        if (composerManager.cachedPath()) store.appendLog(project.id, 'runtime', 'info', 'Installed managed Composer for this project.')
      }
    }
    if (['pnpm','yarn'].includes(project.packageManager)) {
      progress('package-manager', 'Preparing the project package manager…')
      const packageTools = await require('./lib/package-manager-bootstrap.cjs').ensurePackageManager(project,runtimeManager)
      project = store.upsertProject({...project,packageTools})
    }
    if (!project.dependenciesInstalled && options.installDependencies) {
      const dependencies = await executeSetupStep(project, 'dependencies', { state: 'Installing', detail: `Installing dependencies with ${project.packageManager || 'the detected package manager'}…` }, async current => {
        const result = await manager.runCommand(current, 'install', require('./lib/process-manager.cjs').commandFor(current, 'install'), { cwd: current.dependencyRoot || current.path })
        if (result.task.status !== 'Completed') throw Object.assign(new Error('Dependency installation failed. Review the Operations output and retry.'), { command: result.task.command, exitCode: result.task.exitCode })
        const refreshed = await detectProject(current.path)
        await fs.writeFile(path.join(current.path, '.frameui-dependencies.json'), JSON.stringify({ signature: refreshed.dependencySignature }), { mode: 0o600 })
        return result
      })
      project = dependencies.project
    }
    if (options.shouldContinue && !options.shouldContinue()) throw new Error('Project preparation was cancelled.')
    if (environmentStep?.status === 'recommended' && options.createEnvironment) {
      const createdEnvironment = await executeSetupStep(project, 'environment', { state: 'Configuring', detail: 'Creating the active environment file…' }, async current => ({ project: current, ...(await createEnvironmentFromExample(current, current.framework?.id === 'next' ? '.env.local' : '.env')) }))
      project = createdEnvironment.project
      store.appendLog(project.id, 'environment', 'info', 'Created .env from the detected environment template during guided setup.')
    }
    const configuredUrl = options.environmentMode === 'local'
      ? await configureLocalUrlEnvironment({ ...project, envFiles: (await detectProject(project.path)).envFiles }, localProxy?.port || 4180)
      : { changed: false, file: null, updatedKeys: [] }
    if (configuredUrl.changed) {
      const afterEnvironment = await detectProject(project.path)
      project = store.upsertProject({ ...project, ...afterEnvironment, name: project.name, runtimeSelection: project.runtimeSelection, phpConfig: project.phpConfig, database: project.database, localEnvironmentFile: configuredUrl.file })
      store.appendLog(project.id, 'environment', 'info', `Created ${configuredUrl.file} with local application URL overrides for ${configuredUrl.updatedKeys.join(', ')}. The existing environment was not changed.`)
    }
    if (databaseChoice === 'skip' && !options.databaseMode && !project.database?.engine) {
      const inferredChoice = inferredManagedDatabaseChoice(project)
      if (inferredChoice) {
        databaseChoice = inferredChoice
        store.appendLog(id, 'setup', 'warning', `Database metadata was missing after environment preparation; recovering the legacy selection as ${inferredChoice}.`)
      }
    }
    if (databaseChoice === 'existing') {
      progress('database', 'Connecting the project to the selected existing database without changing its schema…')
      const detectedEngine = project.databaseHints?.includes('PostgreSQL') ? 'PostgreSQL' : project.databaseHints?.includes('MariaDB/MySQL') ? 'MariaDB/MySQL' : project.databaseHints?.includes('SQLite') ? 'SQLite' : 'External database'
      if (detectedEngine === 'SQLite') {
        const info = await databaseManager.info(project)
        if (!info.file) throw new Error('Stacker detected SQLite, but could not find the existing database file. Create a local database or review the project configuration.')
        project = store.upsertProject({ ...project, database: { engine: 'SQLite', file: info.file, relativePath: info.relativePath, managed: false, service: false } })
      } else if (project.databaseTarget?.host) {
        const connection = await existingDatabaseConnection(project)
        if (!connection?.database || !connection?.username) throw new Error('The existing database configuration is incomplete. Add its database name and username in Environment, then retry setup.')
        const { password, url, ...metadata } = connection
        const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(metadata.host)
        project = store.upsertProject({ ...project, database: { ...metadata, external: !local, managed: false, service: local, credentialSource: 'environment' }, externalDatabaseApproved: true })
      } else {
        const supplied = options.existingDatabase || {}
        const engine = supplied.engine === 'postgres' ? 'PostgreSQL' : supplied.engine === 'mariadb' ? 'MariaDB/MySQL' : null
        if (!engine || !supplied.host || !supplied.database || !supplied.username) throw new Error('Enter the host, database name, and username for the existing database connection.')
        const port = Number(supplied.port) || (supplied.engine === 'postgres' ? 5432 : 3306)
        const url = supplied.engine === 'postgres'
          ? `postgresql://${encodeURIComponent(supplied.username)}:${encodeURIComponent(supplied.password || '')}@${supplied.host}:${port}/${encodeURIComponent(supplied.database)}`
          : `mysql://${encodeURIComponent(supplied.username)}:${encodeURIComponent(supplied.password || '')}@${supplied.host}:${port}/${encodeURIComponent(supplied.database)}`
        const connection = { engine, host: supplied.host, port, database: supplied.database, username: supplied.username, password: supplied.password || '', url }
        const configured = await configureDatabaseEnvironment(project, connection)
        const redetected = await detectProject(project.path)
        project = store.upsertProject({ ...mergeDetectedProject(project, redetected), name: project.name, setup: project.setup, database: { engine, host: supplied.host, port, database: supplied.database, username: supplied.username, external: !['localhost', '127.0.0.1', '::1', '[::1]'].includes(supplied.host), managed: false, service: ['localhost', '127.0.0.1', '::1', '[::1]'].includes(supplied.host), credentialSource: 'environment' }, externalDatabaseApproved: true })
        if (configured.changed) store.appendLog(project.id, 'environment', 'info', `Configured ${configured.updatedKeys.join(', ')} for the existing database connection.`)
      }
      const location = project.databaseTarget?.classification === 'remote' ? `remote connection at ${project.databaseTarget.host}` : 'existing local connection'
      project = store.upsertProject(finishSetupStep(project, 'database', { stdout: `Configured the ${location}. No resources or migrations were changed.` }))
    }
    if (['sqlite', 'postgres', 'mariadb'].includes(databaseChoice)) {
      const setupRecipe = recipeById(project.recipeId || project.framework?.id)
      if (!setupRecipe.database.supported.includes(databaseChoice)) {
        if (setupRecipe.database.access === 'backend-required') throw new Error(`${setupRecipe.name} cannot connect directly to ${databaseChoice}. Create or attach a backend service first.`)
        throw new Error(`${setupRecipe.name} does not support the selected database.`)
      }
      if (setupRecipe.id === 'astro' && !project.serverRendering) throw new Error('This Astro project is static. Configure an SSR adapter before attaching a runtime database.')
      const configuredDatabase = await executeSetupStep(project, 'database', { state: 'Configuring', detail: `Creating and configuring ${databaseChoice === 'postgres' ? 'PostgreSQL' : databaseChoice === 'mariadb' ? 'MariaDB/MySQL' : 'SQLite'}…` }, async current => {
        if (databaseChoice === 'sqlite') {
          const info = await databaseManager.createSqlite(current, sqlitePathFor(current))
          return { project: await persistProjectDatabase(current, { engine: 'SQLite', file: info.file, relativePath: info.relativePath }) }
        }
        const connection = await databaseServices.createForProject(databaseChoice, current)
        const configured = await persistProjectDatabase(current, connection)
        const tested = await databaseServices.testConnection(configured)
        if (!tested.connected) throw new Error(tested.error || 'The new database connection test failed.')
        return { project: configured, stdout: `Database connection passed in ${tested.latencyMs}ms.` }
      })
      project = configuredDatabase.project
      if (!project.database?.engine) throw new Error(`The ${databaseChoice} database was created, but its project configuration could not be saved.`)

      store.appendLog(project.id, 'database', 'info', `Created and configured a local ${databaseChoice} database during guided setup. Migrations were not run.`)
    }
    await require('./lib/php-assets.cjs').preparePhpAssets(project,runtimeManager,manager,progress)
    progress('migrations', 'Detecting migration files and checking status. No migrations will be run.')
    const detected = await detectProject(project.path)
    project = store.upsertProject({ ...mergeDetectedProject(project, detected), name: project.name, setup: project.setup, runtimeSelection: project.runtimeSelection, database: project.database, packageManager: project.packageManager, packageManagerConfirmed: project.packageManagerConfirmed, status: detected.dependenciesInstalled ? 'Stopped' : 'Needs Setup', lastActivity: new Date().toISOString() })
    migrationManager?.invalidate(project.id)
    store.appendLog(project.id, 'setup', 'info', `Validating project with database metadata: ${project.database?.engine || 'none'}; requested choice: ${databaseChoice || 'none'}.`)
    const checked = await executeSetupStep(project, 'health', { state: 'Configuring', detail: 'Validating runtime, dependencies, environment, database connection, and project files…' }, async current => {
      const migrations = migrationManager ? await migrationManager.status(current, { force: true }).catch(() => null) : null
      const health = await runAndPersistHealth(current, manager.state(id), migrations, true)
      const blockingChecks = (health.checks || []).filter(check => check.status === 'failed' && check.id !== 'migrations' && !(databaseChoice === 'skip' && /database/i.test(check.id)))
      if (blockingChecks.length) {
        const error = new Error(blockingChecks.map(check => `${check.label}: ${check.detail}`).join('\n'))
        error.code = 'SETUP_VALIDATION_FAILED'
        throw error
      }
      return { project: requireProject(current.id), migrations, health, stdout: `${health.summary.healthy}/${health.summary.total} checks healthy; ${health.summary.failed} failed; ${health.summary.warnings} warning(s).` }
    })
    project = checked.project
    let { migrations, health } = checked.value
    if (plan.steps.some(step => step.id === 'migrations')) project = store.upsertProject(finishSetupStep(project, 'migrations', { stdout: migrations?.statusMessage || 'Migration status reviewed. No migrations were run automatically.' }))
    project = store.upsertProject({ ...project, status: health.summary.warnings ? 'Warning' : 'Stopped' })
    if (options.shouldContinue && !options.shouldContinue()) throw new Error('Project preparation was cancelled.')
    if (options.startWhenReady) {
      try {
        const startSpec = require('./lib/process-manager.cjs').commandFor(project, 'start')
        const started = await executeSetupStep(project, 'start', { state: 'Starting', detail: 'Starting the project and waiting for HTTP readiness…', command: startSpec ? [startSpec[0], ...startSpec[1]].join(' ') : null }, async current => ({ state: await manager.start(current, { keepRunning: Boolean(store.getSettings().keepServicesRunning) }) }))
        project = started.project
        const state = manager.state(project.id)
        const verified = await executeSetupStep(project, 'verify', { state: 'Starting', detail: 'Application HTTP health check passed.' }, async current => ({ stdout: state.health || 'HTTP readiness passed.' }))
        project = store.upsertProject({ ...finishSetup(verified.project, 'Running'), activePort: state.port, lastStarted: new Date().toISOString(), lastActivity: new Date().toISOString() })
        health = await runAndPersistHealth(project, state, migrations)
        project = requireProject(project.id)
        store.appendLog(project.id, 'setup', 'info', `Project is ready at http://${project.localDomain}:${localProxy.port}. Browser launch is deferred until the user chooses Open app.`)
      } catch (startError) {
        project = store.upsertProject(finishSetup(requireProject(project.id), 'Warning'))
        store.appendLog(project.id, 'setup', 'warning', `Project setup completed, but the optional application start failed: ${startError.message}`)
        progress('validate', `Project configuration is complete. The optional application start failed: ${startError.message}`)
      }
    } else project = store.upsertProject(finishSetup(project, health.summary.warnings ? 'Warning' : 'Stopped'))
    progress('finalise', 'Finalising workspace…')
    progress('complete', 'Project setup completed.')
    if (activeCreation?.target && path.resolve(activeCreation.target) === path.resolve(project.path)) activeCreation = null
    return { project: publicProject(project), health, migrations }
  })
  ipcMain.handle('projects:remove', async (_event, id) => { await manager.stop(id); phpConfigManager.remove(id); projectRuntimeState.remove(id); store.removeProject(id); return true })
  ipcMain.handle('projects:pin', (_event, id, pinned) => publicProject(store.upsertProject({ ...requireProject(id), pinned: Boolean(pinned), lastActivity: new Date().toISOString() })))
  ipcMain.handle('projects:update-settings', async (_event, id, patch) => {
    const project = requireProject(id)
    const next = { ...project }
    if (typeof patch.name === 'string') {
      const name = patch.name.trim()
      if (!name || name.length > 80) throw new Error('Project name must be between 1 and 80 characters.')
      next.name = name
    }
    if (typeof patch.localDomain === 'string') {
      const domain = patch.localDomain.trim().toLowerCase()
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.localhost$/.test(domain)) throw new Error('Local domains must use a valid name ending in .localhost.')
      if (store.listProjects().some(item => item.id !== id && item.localDomain === domain)) throw new Error('Another project already uses that local domain.')
      next.localDomain = domain
    }
    if (patch.preferredPort != null) {
      const port = Number(patch.preferredPort)
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Preferred port must be between 1024 and 65535.')
      next.preferredPort = port
    }
    if (typeof patch.documentRoot === 'string') {
      const documentRoot = path.resolve(patch.documentRoot)
      const root = path.resolve(project.path)
      if (documentRoot !== root && !documentRoot.startsWith(`${root}${path.sep}`)) throw new Error('Document root must stay inside the project folder.')
      if (!(await fs.stat(documentRoot).catch(() => null))?.isDirectory()) throw new Error('Document root must be an existing folder.')
      next.documentRoot = documentRoot
    }
    if (patch.packageManager != null) {
      if (!['npm', 'pnpm', 'yarn', 'bun', 'composer', null].includes(patch.packageManager)) throw new Error('Unsupported package manager selection.')
      next.packageManager = patch.packageManager
      next.packageManagerConfirmed = true
    }
    if (patch.runtimeSelection != null) next.runtimeSelection = String(patch.runtimeSelection).trim() || null
    if (patch.phpConfig != null) next.phpConfig = validatePhpConfig(patch.phpConfig)
    if (patch.autoStart != null) next.autoStart = Boolean(patch.autoStart)
    if (patch.browserOnStart != null) next.browserOnStart = Boolean(patch.browserOnStart)
    if (patch.fixedPort != null) next.fixedPort = Boolean(patch.fixedPort)
    const phpConfigChanged = JSON.stringify(next.phpConfig || {}) !== JSON.stringify(project.phpConfig || {})
    if (manager.state(id).running && (next.preferredPort !== project.preferredPort || next.localDomain !== project.localDomain || next.runtimeSelection !== project.runtimeSelection || phpConfigChanged)) throw new Error('Stop the project before changing its runtime, domain, port, or PHP configuration.')
    let saved = store.upsertProject({ ...next, lastActivity: new Date().toISOString() })
    if (saved.localDomain !== project.localDomain) {
      const configuredUrl = await configureLocalUrlEnvironment(saved, localProxy?.port || 4180)
      if (configuredUrl.changed) {
        const afterEnvironment = await detectProject(saved.path)
        saved = store.upsertProject({ ...mergeDetectedProject(saved, afterEnvironment), name: saved.name, runtimeSelection: saved.runtimeSelection, phpConfig: saved.phpConfig, database: saved.database })
        store.appendLog(saved.id, 'environment', 'info', `Updated ${configuredUrl.updatedKeys.join(', ')} after the local domain changed.`)
      }
    }
    if (saved.framework?.language === 'PHP') phpConfigManager.sync(saved)
    return publicProject(saved)
  })
  ipcMain.handle('projects:open-folder', (_event, id) => shell.openPath(requireProject(id).path))
  ipcMain.handle('projects:open-code', (_event, id) => { const child = spawn('open', ['-a', 'Visual Studio Code', requireProject(id).path], { detached: true }); child.unref(); return true })
  ipcMain.handle('projects:open-terminal', (_event, id) => { const project = requireProject(id); const managedPath = project.framework?.language === 'PHP' ? phpManager.cachedPath(project) : runtimeManager.cachedPath(project); const environment = project.framework?.language === 'PHP' ? phpConfigManager.environmentFor(project) : {}; return openPreparedTerminal(project.path, managedPath, environment) })
  ipcMain.handle('php-config:fields', () => PHP_CONFIG_FIELDS)
  ipcMain.handle('php-config:preview', (_event, id, values) => {
    const project = requireProject(id)
    if (project.framework?.language !== 'PHP') throw new Error('PHP overrides are only available for PHP projects.')
    const validated = validatePhpConfig(values)
    return { values: validated, contents: serializePhpConfig(validated), path: path.join(phpConfigManager.directoryFor(project), '99-stacker-project.ini') }
  })
  ipcMain.handle('projects:open-app', (_event, id) => {
    const project = requireProject(id)
    const port = manager.state(id).port || project.preferredPort
    const url = manager.state(id).running && localProxy ? `http://${project.localDomain}:${localProxy.port}` : `http://127.0.0.1:${port}`
    return shell.openExternal(url)
  })
  ipcMain.handle('projects:copy-setup', async (_event, id, includeSecrets) => {
    let project = publicProject(requireProject(id))
    const info = await databaseManager.info(project)
    project = { ...project, database: info.engine === 'None detected' ? project.database : { ...project.database, ...info } }
    if (includeSecrets && project.database?.service) {
      const credentials = await databaseServices.projectConnection(project)
      const encoded = encodeURIComponent(credentials.password)
      const scheme = credentials.engine === 'postgres' ? 'postgresql' : 'mysql'
      project.database = { ...project.database, password: credentials.password, url: `${scheme}://${project.database.username}:${encoded}@${project.database.host}:${project.database.port}/${project.database.database}` }
    }
    const contents = await projectSetup(project, Boolean(includeSecrets))
    return writeClipboard(contents, Boolean(includeSecrets))
  })
  ipcMain.handle('projects:copy-details', async (_event, id, kind) => {
    let project = publicProject(requireProject(id))
    const info = await databaseManager.info(project)
    project = { ...project, database: info.engine === 'None detected' ? project.database : { ...project.database, ...info } }
    clipboard.writeText(await projectCopy(project, kind, false))
    return true
  })
  ipcMain.handle('processes:start', async (_event, id) => {
    const project = requireProject(id)
    projectRuntimeState.beginTransition(id, PROJECT_STATUSES.STARTING)
    try {
      const state = await manager.start(project, { keepRunning: Boolean(store.getSettings().keepServicesRunning) })
      projectRuntimeState.handleProcessState({ projectId: id, ...state, status: 'Running' })
      store.upsertProject({ ...project, lastStarted: new Date().toISOString(), lastActivity: new Date().toISOString() })
      const snapshot = await projectRuntimeState.refresh(id, { reason: 'project-started' })
      if (project.browserOnStart ?? store.getSettings().browserOnStart) shell.openExternal(`http://${project.localDomain}:${localProxy?.port || 4180}`)
      return { ...snapshot.process, runtimeState: snapshot, status: snapshot.displayStatus }
    } catch (error) {
      store.upsertProject({ ...project, lastActivity: new Date().toISOString() })
      projectRuntimeState.recordError(id, error)
      throw error
    }
  })
  ipcMain.handle('processes:stop', async (_event, id) => {
    projectRuntimeState.beginTransition(id, PROJECT_STATUSES.STOPPING)
    let state
    try { state = await manager.stop(id) } catch (error) {
      projectRuntimeState.recordError(id, error)
      throw error
    }
    projectRuntimeState.handleProcessState({ projectId: id, ...state, status: 'Stopped', reason: 'user' })
    const project = requireProject(id)
    store.upsertProject({ ...project, lastActivity: new Date().toISOString() })
    const snapshot = await projectRuntimeState.refresh(id, { reason: 'project-stopped' })
    return { ...state, runtimeState: snapshot, status: snapshot.displayStatus }
  })
  ipcMain.handle('processes:restart', async (_event, id) => {
    const project = requireProject(id)
    projectRuntimeState.beginTransition(id, PROJECT_STATUSES.STOPPING)
    try {
      const state = await manager.restart(project, { keepRunning: Boolean(store.getSettings().keepServicesRunning) })
      projectRuntimeState.handleProcessState({ projectId: id, ...state, status: 'Running' })
      store.upsertProject({ ...project, lastStarted: new Date().toISOString(), lastActivity: new Date().toISOString() })
      const snapshot = await projectRuntimeState.refresh(id, { reason: 'project-restarted' })
      return { ...snapshot.process, runtimeState: snapshot, status: snapshot.displayStatus }
    } catch (error) {
      projectRuntimeState.recordError(id, error)
      throw error
    }
  })
  ipcMain.handle('processes:state', (_event, id) => projectRuntimeState.ensure(id).process)
  ipcMain.handle('processes:orphans', () => pendingOrphans)
  ipcMain.handle('processes:reconnect', (_event, id) => {
    const project = requireProject(id)
    const state = manager.reconnect(id)
    store.upsertProject({ ...project, lastActivity: new Date().toISOString() })
    pendingOrphans = pendingOrphans.filter(entry => entry.projectId !== id)
    return state
  })
  ipcMain.handle('processes:stop-orphan', async (_event, id) => {
    const project = requireProject(id)
    manager.reconnect(id)
    projectRuntimeState.beginTransition(id, PROJECT_STATUSES.STOPPING)
    let state
    try { state = await manager.stop(id) } catch (error) {
      projectRuntimeState.recordError(id, error)
      throw error
    }
    projectRuntimeState.handleProcessState({ projectId: id, ...state, status: 'Stopped', reason: 'user' })
    store.upsertProject({ ...project, lastActivity: new Date().toISOString() })
    pendingOrphans = pendingOrphans.filter(entry => entry.projectId !== id)
    return state
  })
  ipcMain.handle('actions:run', (_event, projectId, action) => manager.run(requireProject(projectId), action))
  ipcMain.handle('actions:run-script', (_event, projectId, scriptName) => manager.runScript(requireProject(projectId), scriptName))
  ipcMain.handle('actions:list', (_event, projectId) => [...setupTasks(projectId), ...store.listTasks(projectId)].sort((left, right) => new Date(right.startedAt || 0) - new Date(left.startedAt || 0)))
  ipcMain.handle('actions:cancel', (_event, taskId) => manager.cancel(taskId))
  ipcMain.handle('actions:retry', (_event, taskId) => manager.retry(taskId))
  ipcMain.handle('health:run', async (_event, id) => (await projectRuntimeState.refresh(requireProject(id).id, { reason: 'manual-health-check' })).health)
  ipcMain.handle('runtime-state:get', (_event, id) => projectRuntimeState.ensure(requireProject(id).id))
  ipcMain.handle('runtime-state:list', () => projectRuntimeState.list())
  ipcMain.handle('system-map:generate', (_event, id) => {
    const project = requireProject(id)
    return generateSystemMap(project, projectRuntimeState.ensure(id))
  })
  ipcMain.handle('system-map:open-source', async (_event, id, relativePath) => {
    const absolutePath = await resolveSystemMapSource(requireProject(id), relativePath)
    const child = spawn('open', ['-a', 'Visual Studio Code', absolutePath], { detached: true })
    child.unref()
    return true
  })
  ipcMain.handle('logs:list', (_event, id, limit) => store.readLogs(id, limit))
  ipcMain.handle('logs:global', (_event, limit) => store.readGlobalLogs(limit))
  ipcMain.handle('logs:open', (_event, id) => { requireProject(id); shell.showItemInFolder(path.join(store.logsRoot, `${id}.jsonl`)); return true })
  ipcMain.handle('logs:open-folder', () => shell.openPath(store.logsRoot))
  ipcMain.handle('logs:copy-diagnostics', () => {
    clipboard.writeText(safeDiagnosticContents())
    return true
  })
  ipcMain.handle('logs:export-diagnostics', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export safe support diagnostics',
      defaultPath: `stacker-support-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text document', extensions: ['txt'] }],
    })
    if (result.canceled || !result.filePath) return { exported: false }
    await fs.writeFile(result.filePath, safeDiagnosticContents(), { mode: 0o600 })
    return { exported: true, path: result.filePath }
  })
  ipcMain.handle('environment:read', (_event, id, file) => readEnvironment(requireProject(id), file))
  ipcMain.handle('environment:save', async (_event, id, file, variables) => { const result = await saveEnvironment(requireProject(id), file, variables); migrationManager?.invalidate(id); return result })
  ipcMain.handle('environment:restore', async (_event, id, file) => { const result = await restoreEnvironment(requireProject(id), file); migrationManager?.invalidate(id); return result })
  ipcMain.handle('environment:copy', async (_event, id, file, key) => {
    const environment = await readEnvironment(requireProject(id), file)
    const variable = environment.variables.find(item => item.key === key)
    if (!variable) throw new Error('Environment variable not found.')
    return writeClipboard(variable.value, variable.secret)
  })
  ipcMain.handle('environment:copy-block', async (_event, id, file, kind, includeSecrets) => {
    const contents = await environmentBlock(requireProject(id), file, kind, Boolean(includeSecrets))
    if (!contents) throw new Error(`No ${kind === 'all' ? '' : `${kind} `}environment variables were detected.`)
    return writeClipboard(contents, Boolean(includeSecrets))
  })
  ipcMain.handle('environment:create-from-example', async (_event, id) => {
    const project = requireProject(id)
    await createEnvironmentFromExample(project, project.framework?.id === 'next' ? '.env.local' : '.env')
    const detected = await detectProject(project.path)
    const updated = store.upsertProject({ ...mergeDetectedProject(project, detected), name: project.name, lastActivity: new Date().toISOString() })
    migrationManager?.invalidate(id)
    return readEnvironment(updated, '.env')
  })
  ipcMain.handle('files:list', (_event, id) => listProjectFiles(requireProject(id)))
  ipcMain.handle('files:repair-preview', (_event, id, relativePath) => repairPreview(requireProject(id), relativePath))
  ipcMain.handle('files:repair', async (_event, id, relativePath) => {
    const project = requireProject(id)
    const result = await repairProjectItem(project, relativePath)
    const detected = await detectProject(project.path)
    store.upsertProject({ ...mergeDetectedProject(project, detected), name: project.name, lastActivity: new Date().toISOString() })
    migrationManager?.invalidate(id)
    return result
  })
  ipcMain.handle('files:open', async (_event, id, relativePath) => {
    const item = await resolveProjectItem(requireProject(id), relativePath)
    if (item.kind === 'Folder') return shell.openPath(item.absolutePath)
    shell.showItemInFolder(item.absolutePath)
    return true
  })
  ipcMain.handle('files:copy-path', async (_event, id, relativePath) => {
    const item = await resolveProjectItem(requireProject(id), relativePath)
    clipboard.writeText(item.absolutePath)
    return true
  })
  ipcMain.handle('files:open-code', async (_event, id, relativePath) => {
    const item = await resolveProjectItem(requireProject(id), relativePath)
    const child = spawn('open', ['-a', 'Visual Studio Code', item.absolutePath], { detached: true })
    child.unref()
    return true
  })
  ipcMain.handle('runtimes:list', async () => {
    const [node, php] = await Promise.all([runtimeManager.listAll(), phpManager.listAll()])
    const composerPath = composerManager.cachedPath()
    if (composerPath) {
      const installedPhp = (await phpManager.list()).filter(runtime => !runtime.broken)
      const composerInfo = await composerManager.info(installedPhp[0] ? path.join(installedPhp[0].path, process.platform === 'win32' ? 'php.exe' : 'php') : 'php')
      php.push({ type: 'Composer', version: composerInfo.version || 'installed', architecture: phpManager.arch, managed: true, path: composerPath, size: await directorySize(composerPath) })
    }
    const runtimes = [...node, ...php]
    const defaults = store.getSettings()
    const projects = store.listProjects()
    for (const runtime of runtimes) {
      if (!runtime.managed) continue
      const usedBy = []
      for (const project of projects) {
        if (runtime.type === 'Composer') {
          if (project.framework?.language === 'PHP' && project.packageManager === 'composer') usedBy.push(project.name)
          continue
        }
        if ((runtime.type === 'PHP') !== (project.framework?.language === 'PHP')) continue
        const selectedPath = await (runtime.type === 'PHP' ? phpManager : runtimeManager).executablePath(project)
        if (selectedPath === runtime.path) usedBy.push(project.name)
      }
      runtime.projectUsage = usedBy
      runtime.isDefault = runtime.type === 'Node.js' ? defaults.defaultNodeVersion === runtime.version : runtime.type === 'PHP' ? defaults.defaultPhpVersion === runtime.version : false
    }
    return runtimes
  })
  ipcMain.handle('runtimes:catalog', async () => [...(await runtimeManager.catalog()), ...(await phpManager.catalog())])
  ipcMain.handle('runtimes:install', (_event, version) => (version.startsWith('v') ? runtimeManager : phpManager).install(version))
  ipcMain.handle('runtimes:set-default', async (_event, type, version) => {
    const targetManager = type === 'PHP' ? phpManager : runtimeManager
    const runtime = (await targetManager.list()).find(item => item.version === version)
    if (!runtime) throw new Error('Only a Stacker-managed runtime can be set as the managed default.')
    store.updateSettings(type === 'PHP' ? { defaultPhpVersion: version } : { defaultNodeVersion: version })
    await projectRuntimeState?.reconcileAll('runtime-default-changed')
    return true
  })
  ipcMain.handle('runtimes:test', (_event, type, version) => (type === 'PHP' ? phpManager : runtimeManager).test(version))
  ipcMain.handle('runtimes:open-location', async (_event, type, version) => {
    const targetManager = type === 'PHP' ? phpManager : runtimeManager
    const runtime = (await targetManager.list()).find(item => item.version === version)
    if (!runtime) throw new Error('Only Stacker-managed runtime locations can be opened.')
    return shell.openPath(path.dirname(runtime.path))
  })
  ipcMain.handle('composer:status', async () => {
    const installed = (await phpManager.list()).filter(runtime => !runtime.broken)
    const bootstrap = installed[0] ? path.join(installed[0].path, process.platform === 'win32' ? 'php.exe' : 'php') : 'php'
    return composerManager.info(bootstrap)
  })
  ipcMain.handle('composer:install', async () => {
    const installed = (await phpManager.list()).filter(runtime => !runtime.broken)
    if (!installed.length) throw new Error('Install a managed PHP runtime before installing Composer.')
    return composerManager.install(path.join(installed[0].path, process.platform === 'win32' ? 'php.exe' : 'php'))
  })
  ipcMain.handle('runtimes:remove', async (_event, version) => {
    const targetManager = version.startsWith('v') ? runtimeManager : phpManager
    const target = (await targetManager.list()).find(runtime => runtime.version === version)
    if (!target) throw new Error('Only runtimes installed by Stacker can be removed.')
    let inUse = false
    for (const project of store.listProjects()) {
      if (!manager.state(project.id).running) continue
      if (await targetManager.executablePath(project) === target?.path) { inUse = true; break }
    }
    const removed = await targetManager.remove(version, inUse)
    await projectRuntimeState?.reconcileAll('runtime-removed')
    return removed
  })
  ipcMain.handle('databases:info', (_event, projectId) => databaseManager.info(requireProject(projectId)))
  ipcMain.handle('databases:create-sqlite', async (_event, projectId, relativePath) => {
    const project = requireProject(projectId)
    const info = await databaseManager.createSqlite(project, relativePath || sqlitePathFor(project))
    await persistProjectDatabase(project, { engine: 'SQLite', file: info.file, relativePath: info.relativePath })
    return info
  })
  ipcMain.handle('databases:backup', async (_event, projectId) => {
    const project = requireProject(projectId)
    const result = await dialog.showSaveDialog(mainWindow, { title: `Back up ${project.name}`, defaultPath: `${project.name.replace(/[^a-z0-9_-]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.sqlite`, filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }] })
    if (result.canceled || !result.filePath) return null
    return databaseManager.backup(project, result.filePath)
  })
  ipcMain.handle('databases:restore', async (_event, projectId, confirmation) => {
    const project = requireProject(projectId)
    const result = await dialog.showOpenDialog(mainWindow, { title: `Restore ${project.name}`, properties: ['openFile'], filters: [{ name: 'SQLite database', extensions: ['sqlite', 'sqlite3', 'db'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const restored = await databaseManager.restore(project, result.filePaths[0], confirmation)
    migrationManager?.invalidate(projectId)
    return restored
  })
  ipcMain.handle('databases:reset', async (_event, projectId, confirmation) => { const result = await databaseManager.reset(requireProject(projectId), confirmation); migrationManager?.invalidate(projectId); return result })
  ipcMain.handle('database-admin:tables', (_event, projectId) => databaseAdmin.listTables(requireProject(projectId)))
  ipcMain.handle('database-admin:overview', (_event, projectId) => databaseAdmin.overview(requireProject(projectId)))
  ipcMain.handle('database-admin:browse', (_event, projectId, table, options) => databaseAdmin.browse(requireProject(projectId), table, options || {}))
  ipcMain.handle('database-admin:structure', (_event, projectId, table) => databaseAdmin.structure(requireProject(projectId), table))
  ipcMain.handle('database-admin:table-action', (_event, projectId, payload) => databaseAdmin.tableAction(requireProject(projectId), payload || {}))
  ipcMain.handle('database-admin:delete-row', (_event, projectId, payload) => databaseAdmin.deleteRow(requireProject(projectId), payload || {}))
  ipcMain.handle('database-admin:save-row', (_event, projectId, payload) => databaseAdmin.saveRow(requireProject(projectId), payload || {}))
  ipcMain.handle('database-admin:column-action', (_event, projectId, payload) => databaseAdmin.columnAction(requireProject(projectId), payload || {}))
  ipcMain.handle('database-admin:index-action', (_event, projectId, payload) => databaseAdmin.indexAction(requireProject(projectId), payload || {}))
  ipcMain.handle('database-admin:relation-action', (_event, projectId, payload) => databaseAdmin.relationAction(requireProject(projectId), payload || {}))
  ipcMain.handle('database-admin:import-csv', async (_event, projectId, table) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: `Import CSV into ${table}`, properties: ['openFile'], filters: [{ name: 'CSV file', extensions: ['csv'] }] })
    return result.canceled ? null : databaseAdmin.importCsv(requireProject(projectId), table, result.filePaths[0])
  })
  ipcMain.handle('database-admin:export-csv', async (_event, projectId, table) => {
    const result = await dialog.showSaveDialog(mainWindow, { title: `Export ${table} as CSV`, defaultPath: `${table}.csv`, filters: [{ name: 'CSV file', extensions: ['csv'] }] })
    return result.canceled ? null : databaseAdmin.exportCsv(requireProject(projectId), table, result.filePath)
  })
  ipcMain.handle('database-admin:import-sql', async (_event, projectId) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import SQL dump', properties: ['openFile'], filters: [{ name: 'SQL dump', extensions: ['sql'] }] })
    return result.canceled ? null : databaseAdmin.importSql(requireProject(projectId), result.filePaths[0])
  })
  ipcMain.handle('database-admin:query', (_event, projectId, sql, options) => databaseAdmin.query(requireProject(projectId), sql, options || {}))
  ipcMain.handle('database-runtimes:catalog', (_event, engine) => dbRuntimeManager.catalog(engine))
  ipcMain.handle('database-runtimes:install', (_event, engine) => dbRuntimeManager.install(engine))
  ipcMain.handle('database-runtimes:remove', async (_event, engine, version) => {
    const status = await databaseServices.status(engine)
    return dbRuntimeManager.remove(engine, version, status.running)
  })
  ipcMain.handle('database-services:list', () => databaseServices.list())
  ipcMain.handle('database-services:start', (_event, engine) => databaseServices.start(engine))
  ipcMain.handle('database-services:stop', (_event, engine) => databaseServices.stop(engine))
  ipcMain.handle('database-services:create-project', async (_event, projectId, engine) => {
    if (!['postgres', 'mariadb'].includes(engine)) throw new Error('Unsupported database engine.')
    const project = requireProject(projectId)
    const connection = await databaseServices.createForProject(engine, project)
    await persistProjectDatabase(project, connection)
    return { ...connection, password: '[STORED IN KEYCHAIN]' }
  })
  ipcMain.handle('database-services:dump', async (_event, projectId) => {
    const project = requireProject(projectId)
    const postgres = project.database?.engine === 'PostgreSQL'
    const extension = postgres ? 'dump' : 'sql'
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Back up ${project.name}`,
      defaultPath: `${project.name.replace(/[^a-z0-9_-]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.${extension}`,
      filters: [{ name: postgres ? 'PostgreSQL custom dump' : 'MariaDB SQL dump', extensions: [extension] }],
    })
    if (result.canceled || !result.filePath) return null
    return databaseServices.dump(project, result.filePath)
  })
  ipcMain.handle('database-services:restore', async (_event, projectId, confirmation) => {
    const project = requireProject(projectId)
    const postgres = project.database?.engine === 'PostgreSQL'
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Restore ${project.name}`,
      properties: ['openFile'],
      filters: [{ name: postgres ? 'PostgreSQL dump' : 'MariaDB SQL dump', extensions: postgres ? ['dump', 'backup', 'sql'] : ['sql'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const restored = await databaseServices.restore(project, result.filePaths[0], confirmation)
    migrationManager?.invalidate(projectId)
    return restored
  })
  ipcMain.handle('database-services:test', (_event, projectId) => databaseServices.testConnection(requireProject(projectId)))
  ipcMain.handle('database-services:reset', async (_event, projectId, confirmation) => { const result = await databaseServices.reset(requireProject(projectId), confirmation); migrationManager?.invalidate(projectId); return result })

  ipcMain.handle('migrations:status', (_event, projectId, force) => migrationManager.status(requireProject(projectId), { force: Boolean(force) }))
  ipcMain.handle('migrations:run', (_event, projectId, options) => migrationManager.run(requireProject(projectId), options || {}))
  ipcMain.handle('migrations:run-selected', (_event, projectId, names, options) => migrationManager.runSelected(requireProject(projectId), names || [], options || {}))
  ipcMain.handle('migrations:initialize', (_event, projectId, options) => migrationManager.initialize(requireProject(projectId), options || {}))
  ipcMain.handle('migrations:rollback', (_event, projectId, options) => migrationManager.rollback(requireProject(projectId), options || {}))
  ipcMain.handle('migrations:history', (_event, projectId) => migrationManager.history(projectId))
  ipcMain.handle('migrations:backups', (_event, projectId) => migrationManager.backups(projectId))
  ipcMain.handle('migrations:restore-backup', async (_event, projectId, backupId, confirmation) => migrationManager.restoreBackup(requireProject(projectId), backupId, confirmation))
  ipcMain.handle('migrations:seeders', (_event, projectId) => migrationManager.listSeeders(requireProject(projectId)))
  ipcMain.handle('migrations:run-seeder', (_event, projectId, name, options) => migrationManager.runSeeder(requireProject(projectId), name || null, options || {}))
  ipcMain.handle('migrations:select-folder', async (_event, projectId) => {
    const project = requireProject(projectId)
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Select Migrations Folder', defaultPath: project.migrationFolder || project.path, properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const folder = await fs.realpath(result.filePaths[0])
    const updated = store.upsertProject({ ...requireProject(projectId), migrationFolder: folder })
    migrationManager.invalidate(projectId)
    return migrationManager.status(updated, { force: true })
  })
  ipcMain.handle('migrations:open-folder', async (_event, projectId) => {
    const project = requireProject(projectId)
    const adapter = adapterFor(project)
    if (!adapter) throw new Error('This project does not expose a supported migration workflow.')
    const error = await shell.openPath(path.resolve(project.path, adapter.migrationFolder))
    if (error) throw new Error(error)
  })
}

let initialization = null
function initialize(window, listener) {
  mainWindow = window
  notify = listener
  if (!initialization) initialization = (async () => {
    store = new Store(path.join(app.getPath('userData'), 'LocalEnvironment'))
    store.updateSettings({ browserOnStart: false, keepServicesRunning: false })
    // Older builds saved upstream starter names such as "AppStarter". Repair
    // those records once using the project folder the user actually selected.
    for (const project of store.listProjects()) {
      if (project.setup?.status === 'running') {
        const step = project.setup.currentStep || setupIncompleteStep(project) || 'health'
        store.upsertProject(failSetupStep(project, step, new Error('Stacker closed before setup finished. Retry the unfinished setup step.')))
      }
      const repairedName = repairedLegacyProjectName(project)
      if (repairedName && repairedName !== project.name) store.upsertProject({ ...project, name: repairedName })
    }
    localProxy = new LocalProxy(store, 4181)
    await localProxy.start()
    runtimeManager = new RuntimeManager(path.join(app.getPath('userData'), 'LocalEnvironment', 'runtimes'), emit, () => store.getSettings().defaultNodeVersion)
    phpManager = new PhpManager(path.join(app.getPath('userData'), 'LocalEnvironment', 'runtimes'), emit, () => store.getSettings().defaultPhpVersion)
    phpConfigManager = new PhpConfigManager(path.join(app.getPath('userData'), 'LocalEnvironment', 'php-config'))
    composerManager = new ComposerManager(path.join(app.getPath('userData'), 'LocalEnvironment', 'runtimes', 'composer'), emit)
    dbRuntimeManager = new DatabaseRuntimeManager(path.join(app.getPath('userData'), 'LocalEnvironment', 'runtimes', 'databases'), emit)
    databaseServices = new DatabaseServices(path.join(app.getPath('userData'), 'LocalEnvironment', 'services'), new Keychain('com.frameui.hosting'), emit, dbRuntimeManager)
    databaseAdmin = new DatabaseAdmin(databaseManager, databaseServices)
    manager = new ProcessManager(store, emit, runtimeManager, phpManager, composerManager, phpConfigManager)
    migrationManager = new MigrationManager({ store, processManager: manager, databaseManager, databaseServices, readEnvironment, emit })
    projectRuntimeState = new ProjectRuntimeStateService({
      listProjects: () => store.listProjects(),
      getProject: id => store.getProject(id),
      processManager: manager,
      checkHealth: async (project, processState, migrationSummary) => {
        // Re-detect files so external installs and environment repairs clear stale issues.
        const detected = await detectProject(project.path).catch(() => null)
        const current = detected ? { ...mergeDetectedProject(project, detected), database: project.database, setup: project.setup } : project
        const health = await runHealth(current, processState, runtimeManager, databaseServices, databaseManager, localProxy, migrationSummary, phpManager)
        const latest = requireProject(project.id)
        const refreshed = detected ? mergeDetectedProject(latest, detected) : latest
        const reconciled = reconcileSetupHealth(refreshed, health)
        const comparable = item => JSON.stringify({ ...item, detectedAt: null })
        if (comparable(reconciled) !== comparable(latest)) store.upsertProject(reconciled)
        return health
      },
      getMigrationSummary: id => store.getMigrationSummary(id),
      emit: snapshot => { const project = store.getProject(snapshot.projectId); emit('project-state:changed', { ...snapshot, setup: project?.setup, setupNextStep: setupIncompleteStep(project || {}) }) },
    })

    registerIpc()
  })().catch(error => { localProxy?.stop(); initialization = null; throw error })
  return initialization
}
async function invoke(name, ...args) {
  const handler = handlers.get(name)
  if (!handler) throw new Error('Unsupported hosting operation')
  return handler(null, ...args)
}
async function inspect(projectPath) {
  const detected = await detectProject(projectPath)
  const existing = store.getProject(detected.id)
  if (!existing) {
    await invoke('projects:import', projectPath)
    const imported = requireProject(detected.id)
    store.upsertProject({ ...imported, localDomain: `${imported.localDomain.replace(/\.localhost$/, '')}-${require('crypto').createHash('sha256').update(projectPath).digest('hex').slice(0, 6)}.localhost` })
  }
  const project = existing ? store.upsertProject(mergeDetectedProject(existing, detected)) : requireProject(detected.id)
  return { project: publicProject(project), plan: await planProjectSetup(project, runtimeManager, phpManager) }
}
function snapshot(id) { return publicProject(requireProject(id)) }
async function shutdown() {
  projectRuntimeState?.stopPolling()
  await Promise.allSettled([manager?.shutdown({ keepRunning: false }), databaseServices?.shutdown()])
  localProxy?.stop()
}
module.exports = { initialize, inspect, invoke, snapshot, shutdown }
