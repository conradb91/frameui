const { spawn } = require('child_process')
const { executableEnvironment, nodeCommand } = require('./runtime-platform.cjs')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { portAvailable, routeResponds } = require('./health.cjs')
const { commandForRecipe, recipeById, packageRun } = require('./project-recipe-engine.cjs')
const { stackerLocalEnvironment } = require('./environment.cjs')

const SAFE_ACTIONS = new Set(['install', 'start', 'build', 'test', 'migrate', 'seed', 'cache-clear'])

async function findAvailablePort(preferred, attempts = 40) {
  for (let offset = 0; offset < attempts; offset += 1) if (await portAvailable(preferred + offset)) return preferred + offset
  return null
}

async function findAvailablePortExcept(preferred, reserved, attempts = 40) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = preferred + offset
    if (candidate !== reserved && await portAvailable(candidate)) return candidate
  }
  return null
}

function commandForScript(project, scriptName) {
  if (project.framework.language !== 'JavaScript' || !/^[A-Za-z0-9:_-]+$/.test(scriptName) || !Object.prototype.hasOwnProperty.call(project.packageScripts || {}, scriptName)) throw new Error('That package script is not available for this project.')
  return packageRun(project.packageManager || 'npm', scriptName)
}

function commandFor(project, action) {
  if (project.framework.id === 'static' && action === 'start') return [process.execPath, [path.join(__dirname, 'static-server.cjs'), project.path, String(project.preferredPort)]]
  if (project.framework.id === 'laravel') {
    if (action === 'migrate-rollback-batch') return ['php', ['artisan', 'migrate:rollback', '--force']]
    if (action === 'migrate-rollback-step') return ['php', ['artisan', 'migrate:rollback', '--step=1', '--force']]
    if (action === 'cache-clear') return ['php', ['artisan', 'optimize:clear']]
  }
  if (project.framework.id === 'codeigniter') {
    if (action === 'migrate-rollback-batch') return ['php', ['spark', 'migrate:rollback', '-f']]
    if (action === 'cache-clear') return ['php', ['spark', 'cache:clear']]
  }
  return commandForRecipe(project, action, project.preferredPort)
}

function announcedPortFromOutput(message) {
  const match = String(message).match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})/i)
  const port = Number(match?.[1])
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

async function waitForReadiness(child, portOrGetter, healthCheck, onAttempt = () => {}) {
  const timeoutMs = Math.max(1_000, Number(healthCheck?.readinessTimeoutMs) || 45_000)
  const started = Date.now()
  let last = { ok: false, detail: 'Not responding' }
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return { ready: false, reason: 'process-exited', detail: `Process exited before becoming ready${child.exitCode == null ? '' : ` (code ${child.exitCode})`}.` }
    const port = typeof portOrGetter === 'function' ? portOrGetter() : portOrGetter
    last = await routeResponds(port, null, healthCheck?.path || '/')
    if (last.ok) return { ready: true, detail: last.detail, port, durationMs: Date.now() - started }
    onAttempt(last)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return { ready: false, reason: 'readiness-timeout', detail: `The process stayed alive but HTTP did not become ready within ${Math.round(timeoutMs / 1000)} seconds (${last.detail}).` }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    const finish = exited => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref()
    child.once('exit', onExit)
  })
}

function waitForPidExit(pid, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now()
    const check = () => {
      if (!isAlive(pid)) return resolve(true)
      if (Date.now() - started >= timeoutMs) return resolve(false)
      setTimeout(check, 50)
    }
    check()
  })
}

async function waitForPortRelease(port, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await portAvailable(port)) return true
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return portAvailable(port)
}

const { signalProcess } = require('./process-signals.cjs')

class ProcessManager {
  constructor(store, emit, runtimeManager = null, phpManager = null, composerManager = null, phpConfigManager = null) {
    this.store = store
    this.emit = emit
    this.runtimeManager = runtimeManager
    this.phpManager = phpManager
    this.composerManager = composerManager
    this.phpConfigManager = phpConfigManager
    this.processes = new Map()
    this.starting = new Map()
    this.adopted = new Map()
    this.actions = new Map()
    this.cancelledActions = new Set()
    this.taskWaiters = new Map()
    this.taskProgressAt = new Map()
  }

  state(projectId) {
    const item = this.processes.get(projectId)
    if (item) return { running: item.status === 'running', status: item.status === 'running' ? 'Running' : 'Starting', pid: item.child.pid, startedAt: item.startedAt, port: item.port, apiPort: item.apiPort || null, readyAt: item.readyAt || null, health: item.health || null }
    const adopted = this.adopted.get(projectId)
    if (adopted) {
      if (isAlive(adopted.pid)) return { running: true, pid: adopted.pid, startedAt: adopted.startedAt, port: adopted.port, apiPort: adopted.apiPort || null, adopted: true }
      this.adopted.delete(projectId)
      this.store.unregisterProcess(projectId)
    }
    return { running: false }
  }

  async start(project, options = {}) {
    if (this.starting.has(project.id)) return this.starting.get(project.id)
    const operation = Promise.resolve().then(() => this.startProject(project, options))
    this.starting.set(project.id, operation)
    try { return await operation } finally { if (this.starting.get(project.id) === operation) this.starting.delete(project.id) }
  }

  async startProject(project, { keepRunning = false } = {}) {
    const current = this.processes.get(project.id)
    if (current) return current.readyPromise || this.state(project.id)
    if (this.state(project.id).running) return this.state(project.id)
    if (project.packageManagerConflict && !project.packageManagerConfirmed) throw new Error('Conflicting lockfiles were detected. Select the package manager in Project Settings before installing or starting this project.')
    if (project.packageManager === 'bun') throw new Error('This project requires Bun, but a Stacker-managed Bun runtime is not available in this build.')
    if (project.runtime?.type === 'Node.js' && this.runtimeManager && !this.runtimeManager.cachedPath(project)) throw new Error(`A compatible Node.js runtime is required (${project.runtime.constraint || project.runtime.minimum || 'recipe requirement'}). Run Setup to select or install one.`)
    if (project.runtime?.type === 'PHP' && this.phpManager && !this.phpManager.cachedPath(project)) throw new Error(`A compatible PHP runtime is required (${project.runtime.constraint || project.runtime.minimum || 'recipe requirement'}). Run Setup to select or install one.`)
    const port = await findAvailablePort(project.preferredPort)
    if (!port || (project.fixedPort && port !== project.preferredPort)) throw new Error(`Port ${project.preferredPort} is already in use${project.fixedPort ? ' and this project requires that fixed port' : ''}.`)
    const recipe = recipeById(project.recipeId || project.framework?.id)
    const apiPort = recipe.composite ? await findAvailablePortExcept(Number(project.apiPort) || port + 1, port) : null
    if (recipe.composite && !apiPort) throw new Error('Stacker could not find an available port for the generated Express API service.')
    const executionProject = { ...project, preferredPort: port, apiPort }
    const command = commandFor(executionProject, 'start')
    if (!command || !command[0] || command[1].includes('')) throw new Error('No start action was detected for this project.')
    if (port !== project.preferredPort) this.store.appendLog(project.id, 'process', 'warning', `Preferred port ${project.preferredPort} was busy. Stacker selected available port ${port} and updated the local proxy route.`)
    // Always give a persistent project its own process group. Framework CLIs
    // such as `php spark serve` and npm commonly launch the real web server as
    // a child; restart/stop must terminate that whole tree, not only the CLI.
    let announcedPort = port
    let item = null
    const detectAnnouncedPort = message => {
      // Access logs contain ephemeral client addresses such as
      // `127.0.0.1:61531 Accepted`. Only an explicit startup URL can announce
      // the listening port, and a ready service's port is immutable.
      if (item?.status === 'running') return
      const detected = announcedPortFromOutput(message)
      if (!detected || detected === announcedPort) return
      announcedPort = detected
      if (item) item.port = detected
      this.store.appendLog(project.id, 'process', 'info', `Detected application port ${detected} from framework output.`)
    }
    // POSIX needs a process group for tree termination. Windows uses taskkill;
    // detaching there gives the .NET CLI invalid console handles.
    const child = this.spawn(executionProject, 'start', command, true, null, null, { detached: process.platform !== 'win32', unref: keepRunning, onOutput: detectAnnouncedPort })
    const startedAt = new Date().toISOString()
    item = { child, startedAt, port, apiPort, processGroup: child.pid, status: 'starting', readyAt: null, health: null, readyPromise: null }
    this.processes.set(project.id, item)
    this.store.registerProcess(project.id, { pid: child.pid, processGroup: child.pid, port, apiPort, startedAt, projectName: project.name, projectPath: project.path, command: [command[0], ...command[1]].join(' ') })
    child.once('exit', (code, signal) => {
      // A restart may already have registered a replacement. The old child's
      // delayed exit must never erase or stop that new process.
      if (this.processes.get(project.id)?.child !== child) return
      this.processes.delete(project.id)
      this.store.unregisterProcess(project.id)
      this.emit('process:state', { projectId: project.id, running: false, status: item.intentionalStop || code === 0 ? 'Stopped' : 'Failed', reason: item.intentionalStop ? 'user' : null, code, signal })
    })
    this.emit('process:state', { projectId: project.id, running: false, status: 'Starting', pid: child.pid, port, apiPort })
    item.readyPromise = (async () => {
      const result = await waitForReadiness(child, () => announcedPort, project.healthCheck || recipe.healthCheck)
      if (!result.ready) {
        const recent = this.store.readLogs(project.id, 30).filter(record => record.source === 'start').map(record => record.message.trim()).filter(Boolean).slice(-8).join('\n')
        await this.stop(project.id).catch(() => null)
        const error = new Error(`${project.framework.name} could not start. ${result.detail}${recent ? `\n\nRecent output:\n${recent}` : ''}`)
        error.code = result.reason === 'process-exited' ? 'PROCESS_EXITED' : 'READINESS_TIMEOUT'
        error.stage = 'Development server startup'
        error.command = [command[0], ...command[1]].join(' ')
        throw error
      }
      if (this.processes.get(project.id) !== item) throw new Error('The project process was stopped before readiness completed.')
      if (apiPort) {
        // Prove the Express process is listening without conflating startup
        // with the database check performed by `/api/health`.
        const apiResult = await waitForReadiness(child, apiPort, { ...project.healthCheck, path: '/api', readinessTimeoutMs: Math.min(30_000, Number(project.healthCheck?.readinessTimeoutMs) || 45_000) })
        if (!apiResult.ready) {
          await this.stop(project.id).catch(() => null)
          const error = new Error(`The generated Express API could not start. ${apiResult.detail}`)
          error.code = apiResult.reason === 'process-exited' ? 'PROCESS_EXITED' : 'READINESS_TIMEOUT'
          error.stage = 'API service startup'
          throw error
        }
      }
      item.status = 'running'
      item.port = result.port || announcedPort
      item.readyAt = new Date().toISOString()
      item.health = result.detail
      item.readyPromise = null
      this.store.registerProcess(project.id, { pid: child.pid, processGroup: child.pid, port: item.port, apiPort: item.apiPort, startedAt, projectName: project.name, projectPath: project.path, command: [command[0], ...command[1]].join(' ') })
      const state = this.state(project.id)
      this.emit('process:state', { projectId: project.id, ...state })
      return state
    })()
    return item.readyPromise
  }

  // Forced quits (kill -9, crash, force-quit from Activity Monitor) skip
  // `before-quit` entirely, so a normally-attached child can be orphaned —
  // still running, but no longer tracked in `this.processes` after a relaunch.
  // The persistent store registry survives the restart; this cross-checks it
  // against real PIDs so the UI can offer reconnect-or-stop rather than
  // silently losing track of (or blindly re-spawning on top of) a live process.
  detectOrphans() {
    const orphans = []
    for (const entry of this.store.listProcessRegistry()) {
      if (this.processes.has(entry.projectId) || this.adopted.has(entry.projectId)) continue
      if (isAlive(entry.pid)) orphans.push(entry)
      else this.store.unregisterProcess(entry.projectId)
    }
    return orphans
  }

  reconnect(projectId) {
    const entry = this.store.listProcessRegistry().find(item => item.projectId === projectId)
    if (!entry || !isAlive(entry.pid)) throw new Error('This process is no longer running.')
    this.adopted.set(projectId, entry)
    this.emit('process:state', { projectId, running: true, pid: entry.pid, port: entry.port, apiPort: entry.apiPort || null, adopted: true })
    return this.state(projectId)
  }

  async stop(projectId) {
    const item = this.processes.get(projectId)
    if (item) {
      const child = item.child
      item.intentionalStop = true
      await signalProcess(child.pid, child, 'SIGTERM', item.processGroup)
      let exited = await waitForChildExit(child, 3500)
      let portReleased = await waitForPortRelease(item.port, 1500)
      let apiPortReleased = item.apiPort ? await waitForPortRelease(item.apiPort, 1500) : true
      if (!exited || !portReleased || !apiPortReleased) {
        await signalProcess(child.pid, child, 'SIGKILL', item.processGroup)
        exited = await waitForChildExit(child, 1500)
        portReleased = await waitForPortRelease(item.port, 1500)
        apiPortReleased = item.apiPort ? await waitForPortRelease(item.apiPort, 1500) : true
      }
      if ((!exited && isAlive(child.pid)) || !portReleased || !apiPortReleased) throw new Error('The existing project process did not release its ports. Stacker did not start a duplicate process.')
      if (this.processes.get(projectId)?.child === child) {
        this.processes.delete(projectId)
        this.store.unregisterProcess(projectId)
        this.emit('process:state', { projectId, running: false, status: 'Stopped', reason: 'user' })
      }
      return { running: false, status: 'Stopped', reason: 'user' }
    }
    const adopted = this.adopted.get(projectId)
    if (adopted) {
      await signalProcess(adopted.pid, null, 'SIGTERM', adopted.processGroup)
      let exited = await waitForPidExit(adopted.pid, 3500)
      let portReleased = adopted.port ? await waitForPortRelease(adopted.port, 1500) : true
      let apiPortReleased = adopted.apiPort ? await waitForPortRelease(adopted.apiPort, 1500) : true
      if (!exited || !portReleased || !apiPortReleased) {
        await signalProcess(adopted.pid, null, 'SIGKILL', adopted.processGroup)
        exited = await waitForPidExit(adopted.pid, 1500)
        portReleased = adopted.port ? await waitForPortRelease(adopted.port, 1500) : true
        apiPortReleased = adopted.apiPort ? await waitForPortRelease(adopted.apiPort, 1500) : true
      }
      if (!exited || !portReleased || !apiPortReleased) throw new Error('The existing project process did not release its ports. Stacker did not start a duplicate process.')
      this.adopted.delete(projectId)
      this.store.unregisterProcess(projectId)
      this.emit('process:state', { projectId, running: false, status: 'Stopped', reason: 'user' })
    }
    return { running: false, status: 'Stopped', reason: 'user' }
  }

  async restart(project, options = {}) {
    await this.stop(project.id)
    return this.start(project, options)
  }

  async run(project, action) {
    if (!SAFE_ACTIONS.has(action) || action === 'start') throw new Error('Unsupported project action.')
    if (project.packageManagerConflict && !project.packageManagerConfirmed && project.framework?.language === 'JavaScript') throw new Error('Conflicting lockfiles were detected. Select the package manager in Project Settings before running project commands.')
    const command = commandFor(project, action)
    if (!command) throw new Error(`The ${project.framework.name} adapter does not expose this action.`)
    const task = { id: crypto.randomUUID(), projectId: project.id, projectName: project.name, action, command: [command[0], ...command[1]].join(' '), status: 'Running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null }
    this.store.addTask(task)
    const child = this.spawn(project, action, command, false, task)
    this.actions.set(task.id, child)
    this.emit('task:changed', task)
    return task
  }

  async runCommand(project, action, command, { cwd, onOutput = null } = {}) {
    const task = { id: crypto.randomUUID(), projectId: project.id, projectName: project.name, action, command: [command[0], ...command[1]].join(' '), status: 'Running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null }
    this.store.addTask(task)
    const capture = { stdout: '', stderr: '' }
    const execProject = cwd ? { ...project, path: cwd } : project
    const child = this.spawn(execProject, action, command, false, task, capture, { onOutput })
    this.actions.set(task.id, child)
    this.emit('task:changed', task)
    const finished = await this.waitForTask(task.id)
    return { task: finished, stdout: capture.stdout, stderr: capture.stderr }
  }

  async runScript(project, scriptName) {
    const command = commandForScript(project, scriptName)
    const task = { id: crypto.randomUUID(), projectId: project.id, projectName: project.name, action: `script:${scriptName}`, command: [command[0], ...command[1]].join(' '), status: 'Running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null }
    this.store.addTask(task)
    const child = this.spawn(project, `script:${scriptName}`, command, false, task)
    this.actions.set(task.id, child)
    this.emit('task:changed', task)
    return task
  }

  async retry(taskId) {
    const previous = this.store.listTasks().find(task => task.id === taskId)
    if (!previous) throw new Error('The previous action could not be found.')
    if (previous.status === 'Running') throw new Error('This action is already running.')
    const project = this.store.getProject(previous.projectId)
    if (!project) throw new Error('The project for this action is no longer in Stacker.')
    if (previous.action.startsWith('script:')) return this.runScript(project, previous.action.slice('script:'.length))
    return this.run(project, previous.action)
  }

  waitForTask(taskId) {
    const current = this.store.listTasks().find(task => task.id === taskId)
    if (!current || current.status !== 'Running') return Promise.resolve(current)
    return new Promise(resolve => {
      const waiters = this.taskWaiters.get(taskId) || []
      waiters.push(resolve)
      this.taskWaiters.set(taskId, waiters)
    })
  }

  async runAndWait(project, action) {
    const task = await this.run(project, action)
    const completed = await this.waitForTask(task.id)
    if (!completed || completed.status !== 'Completed') throw new Error(`${action} did not complete successfully. See Actions and Logs for the raw output.`)
    return completed
  }

  cancel(taskId) {
    const child = this.actions.get(taskId)
    if (!child) return false
    this.cancelledActions.add(taskId)
    void signalProcess(child.pid,child,'SIGTERM')
    return true
  }

  spawn(project, source, [executable, args], persistent, task = null, capture = null, { detached = false, unref = detached, onOutput = null } = {}) {
    const managedPath = project.framework?.language === 'PHP' ? this.phpManager?.cachedPath?.(project) || null : this.runtimeManager?.cachedPath?.(project) || null
    if (project.framework?.language === 'JavaScript' && ['pnpm', 'yarn'].includes(executable) && managedPath && !fs.existsSync(path.join(managedPath, executable)) && fs.existsSync(path.join(managedPath, 'corepack'))) {
      args = [executable, ...args]
      executable = 'corepack'
    }
    const managedComposer = executable === 'composer' && this.composerManager?.cachedPath?.()
    if (managedComposer) { executable = 'php'; args = [managedComposer, ...args] }
    const phpEnvironment = project.framework?.language === 'PHP' ? this.phpConfigManager?.environmentFor?.(project) || {} : {}
    const env = { ...executableEnvironment([managedPath, project.packageTools ? path.join(project.packageTools,'node_modules/.bin') : null]), ...phpEnvironment, ...stackerLocalEnvironment(project), PORT: String(project.preferredPort), API_PORT: project.apiPort ? String(project.apiPort) : '', NODE_ENV: process.env.NODE_ENV || 'development', FORCE_COLOR: '0' }
    if (project.runtime?.type === '.NET') { env.DOTNET_ROOT = managedPath; env.DOTNET_CLI_HOME = path.join(this.runtimeManager.root, 'dotnet-home'); env.DOTNET_CLI_TELEMETRY_OPTOUT = '1'; env.DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'; env.ASPNETCORE_ENVIRONMENT = 'Development'; env.NUGET_PACKAGES = path.join(this.runtimeManager.root, 'nuget-packages') }
    env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    if (this.runtimeManager?.root) env.COREPACK_HOME = path.join(this.runtimeManager.root, 'corepack-cache')
    if (project.framework.id === 'static' && executable === process.execPath) env.ELECTRON_RUN_AS_NODE = '1'
    // detached gives the child its own process group, so it survives Stacker
    // being force-quit/killed instead of dying with it — used only when the
    // user has opted into "keep services running after UI closes".
    if (project.runtime?.type === 'Node.js') {
      if (project.packageTools && ['corepack','pnpm','yarn'].includes(executable)) {
        args = [path.join(project.packageTools,'node_modules/corepack/dist',executable+'.js'),...args]
        executable = 'node'
      }
      [executable,args] = nodeCommand(executable,args,managedPath)
    }
    if (process.platform === 'win32' && executable === 'dotnet' && managedPath) executable = path.join(managedPath,'dotnet.exe')
    if (process.platform === 'win32' && executable === 'php' && managedPath) executable = path.join(managedPath,'php.exe')
    const child = spawn(executable, args, { cwd: project.path, env, shell: false, windowsHide: true, detached })
    if (unref) child.unref()
    const handle = (level, chunk) => {
      const message = chunk.toString()
      onOutput?.(message, level)
      const record = this.store.appendLog(project.id, source, level, message)
      this.emit('log', { projectId: project.id, ...record })
      if (capture) capture[level === 'error' ? 'stderr' : 'stdout'] += message
      if (task) {
        const now = Date.now()
        const detail = message.trim().split(/\r?\n/).filter(Boolean).at(-1)
        if (detail && now - (this.taskProgressAt.get(task.id) || 0) >= 400) {
          this.taskProgressAt.set(task.id, now)
          const changed = this.store.updateTask(task.id, { detail: detail.slice(0, 180), lastOutputAt: new Date(now).toISOString() })
          this.emit('task:changed', changed)
        }
      }
    }
    child.stdout?.on('data', chunk => handle('info', chunk))
    child.stderr?.on('data', chunk => handle('error', chunk))
    child.on('error', error => handle('error', error.message))
    if (!persistent && task) child.once('close', code => {
      this.actions.delete(task.id)
      this.taskProgressAt.delete(task.id)
      const cancelled = this.cancelledActions.delete(task.id)
      const changed = this.store.updateTask(task.id, { status: cancelled ? 'Cancelled' : code === 0 ? 'Completed' : 'Failed', exitCode: code, finishedAt: new Date().toISOString() })
      this.emit('task:changed', changed)
      for (const resolve of this.taskWaiters.get(task.id) || []) resolve(changed)
      this.taskWaiters.delete(task.id)
    })
    return child
  }

  async shutdown({ keepRunning = false } = {}) {
    if (!keepRunning) await Promise.all([...new Set([...this.processes.keys(), ...this.adopted.keys()])].map(id => this.stop(id)))
    await Promise.all([...this.actions.values()].map(child=>signalProcess(child.pid,child,'SIGTERM')))
  }
}

module.exports = { ProcessManager, commandFor, commandForScript, SAFE_ACTIONS, findAvailablePort, findAvailablePortExcept, waitForReadiness, announcedPortFromOutput }
