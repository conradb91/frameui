const fs = require('fs/promises')
const { constants } = require('fs')
const net = require('net')
const http = require('http')
const path = require('path')
const { execFile } = require('child_process')
const { executableEnvironment, findExecutable } = require('./runtime-platform.cjs')
const { environmentTemplateFor, activeEnvironmentFiles, readEnvironment, readEffectiveEnvironment, missingRequiredEnvironmentValues } = require('./environment.cjs')

async function canAccess(target, mode) {
  try { await fs.access(target, mode); return true } catch { return false }
}

async function portAvailable(port) {
  // On macOS a wildcard listener (notably AirPlay on 5000) can coexist
  // with a temporary loopback bind. A successful bind alone is not proof
  // that HTTP requests will reach our future child process.
  const occupied = await new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const finish = value => { socket.destroy(); resolve(value) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(500, () => finish(true))
  })
  if (occupied) return false
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

function portOwner(port) {
  return new Promise(resolve => execFile('/usr/sbin/lsof', ['-i', `:${port}`, '-P', '-n', '-sTCP:LISTEN'], { timeout: 2000 }, (error, stdout) => {
    if (error || !stdout) return resolve(null)
    const line = stdout.trim().split(/\r?\n/)[1]
    if (!line) return resolve(null)
    const [command, pid] = line.trim().split(/\s+/)
    resolve(command ? { command, pid } : null)
  }))
}

function routeResponds(port, host = null, routePath = '/') {
  return new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const request = http.get({ host: '127.0.0.1', port, path: routePath, timeout: 1200, headers: host ? { host } : undefined }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { if (body.length < 512) body += chunk })
      response.on('end', () => {
        const ok = response.statusCode < 500 && response.statusCode !== 400 && !(response.statusCode === 403 && !body.trim())
        let message = ''
        if (!ok && body) {
          try { message = JSON.parse(body).message || '' } catch { message = body.trim().replace(/\s+/g, ' ').slice(0, 180) }
        }
        finish({ ok, detail: `HTTP ${response.statusCode}${message ? `: ${message}` : ''}` })
      })
    })
    request.on('timeout', () => { request.destroy(); finish({ ok: false, detail: 'Timed out' }) })
    request.on('error', () => finish({ ok: false, detail: 'Not responding' }))
  })
}

function commandOutput(command, args = []) {
  return new Promise(resolve => execFile(command, args, { env: executableEnvironment(), timeout: 3000 }, (error, stdout) => resolve(error ? null : stdout)))
}

async function commandAvailable(command) { return Boolean(findExecutable(command)) }

async function runHealth(project, processState, runtimeManager = null, databaseServices = null, databaseManager = null, localProxy = null, migrationSummary = null, phpManager = null) {
  const isRunning = typeof processState === 'object' ? Boolean(processState.running) : Boolean(processState)
  const activePort = typeof processState === 'object' ? processState.port : project.activePort
  const activeApiPort = typeof processState === 'object' ? processState.apiPort : project.activeApiPort
  const checks = []
  const add = (id, label, status, detail, fix = null) => checks.push({ id, label, status, detail, fix })
  const readable = await canAccess(project.path)
  add('path', 'Project path', readable ? 'healthy' : 'failed', readable ? 'Folder exists and is readable.' : 'Project folder is missing or unreadable.', 'choose-path')
  add('framework', 'Framework', project.framework.id !== 'unknown' ? 'healthy' : 'warning', project.framework.id !== 'unknown' ? `${project.framework.name} detected from project files.` : 'No supported framework signature was found.')
  for (const relative of project.expectedFiles || []) {
    const present = await canAccess(path.join(project.path, relative))
    add(`expected-${relative}`, 'Expected project file', present ? 'healthy' : 'failed', present ? `${relative} is present.` : `${relative} is required by the ${project.framework.name} recipe.`, present ? null : 'open-folder')
  }
  const runtimeType = project.runtime?.type
  if (runtimeType === '.NET') {
    const selected = runtimeManager?.dotnet?.cachedPath(project)
    add('runtime', '.NET SDK', selected ? 'healthy' : 'failed', selected ? 'Compatible SDK is ready.' : 'The required SDK is unavailable.')
  } else if (runtimeType === 'Node.js') {
    const selected = await runtimeManager?.executablePath(project)
    const system = !runtimeManager && !selected ? await commandAvailable('node') : false
    const managed = selected && runtimeManager?.root ? path.resolve(selected).startsWith(path.resolve(runtimeManager.root)) : false
    add('runtime', 'Runtime', selected || system ? 'healthy' : 'failed', selected ? `${managed ? 'Stacker-managed' : 'Compatible system'} Node.js is selected at ${selected}.` : system ? 'Node.js is available for this unmanaged test context.' : `A compatible Node.js ${project.runtime.constraint || ''} is not installed.`, selected || system ? null : 'install-runtime')
  } else if (runtimeType === 'PHP') {
    const managedDir = phpManager?.cachedPath?.(project) || null
    const system = !phpManager && !managedDir ? await commandAvailable('php') : false
    const isManaged = managedDir && phpManager?.root ? path.resolve(managedDir).startsWith(path.resolve(phpManager.root)) : false
    add('runtime', 'Runtime', managedDir || system ? 'healthy' : 'failed', managedDir ? `${isManaged ? 'Stacker-managed' : 'Compatible system'} PHP is selected at ${managedDir}.` : system ? 'PHP is available for this unmanaged test context.' : `A compatible PHP ${project.runtime.constraint || ''} is not installed.`, managedDir || system ? null : 'install-runtime')
    if ((managedDir || system) && project.runtime?.requiredExtensions?.length) {
      const phpBinary = managedDir ? path.join(managedDir, process.platform === 'win32' ? 'php.exe' : 'php') : 'php'
      // get_loaded_extensions() alone under-reports: some static builds compile
      // pdo_sqlite/pdo_pgsql directly into PDO's driver registry without
      // listing them as separately loaded extensions, so a project requiring
      // ext-pdo_sqlite would be wrongly flagged missing even though
      // `new PDO('sqlite:...')` works. Cross-check PDO::getAvailableDrivers().
      const probe = await commandOutput(phpBinary, ['-r', 'echo implode(",", get_loaded_extensions()) . "|" . implode(",", class_exists("PDO") ? PDO::getAvailableDrivers() : []);'])
      const [extPart, pdoPart] = (probe || '').split('|')
      const available = new Set((extPart || '').toLowerCase().split(',').filter(Boolean))
      for (const driver of (pdoPart || '').toLowerCase().split(',').filter(Boolean)) available.add(`pdo_${driver}`)
      const missing = project.runtime.requiredExtensions.filter(extension => !available.has(extension.toLowerCase()))
      add('php-extensions', 'PHP extensions', missing.length ? 'failed' : 'healthy', missing.length ? `Missing required extensions: ${missing.join(', ')}.` : `${project.runtime.requiredExtensions.length} Composer platform extension requirement(s) are available.`, missing.length ? 'runtime-details' : null)
    }
  } else add('runtime', 'Runtime', 'healthy', 'This project does not require a language runtime.')
  if (project.nativeToolingRequired) {
    const tools = await commandAvailable('clang')
    add('developer-toolchain', 'Developer toolchain', tools ? 'healthy' : 'failed', tools ? 'Apple command-line compilation tools are available.' : 'This project may compile native dependencies, but the Apple command-line tools were not found.', tools ? null : 'toolchain-help')
  }
  add('dependencies', 'Dependencies', project.dependenciesInstalled ? 'healthy' : 'failed', project.dependenciesInstalled ? 'Dependency directory is present.' : 'Project dependencies have not been installed.', 'install')
  const environmentTemplate = environmentTemplateFor(project)
  const envNeeded = Boolean(environmentTemplate && !activeEnvironmentFiles(project).length)
  add('environment', 'Environment', envNeeded ? 'warning' : 'healthy', envNeeded ? `${environmentTemplate} exists but an active environment file is missing.` : project.envFiles.length ? `${project.envFiles.length} environment file(s) detected.` : 'No environment file required by the detected adapter.', envNeeded ? 'create-env' : null)
  if (!envNeeded && activeEnvironmentFiles(project).length) {
    const requiredFile = project.recipeId?.includes('-vite-express-') && project.envFiles.includes('server/.env') ? 'server/.env' : null
    const environment = await (requiredFile ? readEnvironment(project, requiredFile) : readEffectiveEnvironment(project)).catch(() => ({ variables: [] }))
    const missing = missingRequiredEnvironmentValues(project, environment.variables)
    add('environment-values', 'Required environment values', missing.length ? 'failed' : 'healthy', missing.length ? `Missing required values: ${missing.join(', ')}.` : 'Adapter-required environment values are present.', missing.length ? 'environment' : null)
    if (project.missingEnvironmentValues?.length) add('project-environment-values', 'Project environment values', 'warning', `${project.missingEnvironmentValues.length} template value(s) still need input: ${project.missingEnvironmentValues.join(', ')}.`, 'environment')
  }
  const docRoot = await canAccess(project.documentRoot)
  add('document-root', 'Document root', docRoot ? 'healthy' : 'failed', docRoot ? path.relative(project.path, project.documentRoot) || 'Project root' : 'Expected document root is missing.')
  const writableCandidates = project.writableDirectories || (project.framework.id === 'laravel' ? ['storage', 'bootstrap/cache'] : project.framework.id === 'codeigniter' ? ['writable'] : [])
  for (const relative of writableCandidates) {
    const target = path.join(project.path, relative)
    const writable = await canAccess(target, constants.W_OK)
    add(`writable-${relative}`, 'Writable path', writable ? 'healthy' : 'failed', writable ? `${relative} is writable.` : `${relative} is missing or not writable.`, writable ? null : 'open-folder')
  }
  if (databaseManager) {
    const database = await databaseManager.info(project)
    if (database.service && database.managed === false && databaseServices) {
      const connection = await databaseServices.testConnection(project).catch(error => ({ connected: false, error: error.message }))
      add('database-connectivity', 'Existing database connection', connection.connected ? 'healthy' : 'failed', connection.connected ? `Connected to ${database.host}:${database.port}/${database.database}.` : connection.error, connection.connected ? null : 'database-details')
    } else if (database.service && databaseServices) {
      const engine = database.engine === 'PostgreSQL' ? 'postgres' : 'mariadb'
      const service = await databaseServices.status(engine)
      add('database-service', 'Database service', service.running ? 'healthy' : 'failed', service.running ? `${database.engine} is running on port ${service.port}.` : `${database.engine} is not running.`, service.running ? null : 'start-database')
      if (service.running) {
        const connection = await databaseServices.testConnection(project).catch(error => ({ connected: false, error: error.message }))
        add('database-connectivity', 'Database connectivity', connection.connected ? 'healthy' : 'failed', connection.connected ? `Connection succeeded in ${connection.latencyMs}ms.` : connection.error, connection.connected ? null : 'database-details')
      }
    } else if (database.external) add('database-connectivity', 'Remote database', 'warning', `Existing remote connection at ${database.host} was explicitly selected. Stacker did not test it or run migrations.`, 'database-details')
    else if (database.engine === 'SQLite') add('database-connectivity', 'Database connectivity', database.file ? 'healthy' : 'failed', database.file ? `${database.relativePath} is available.` : 'The SQLite database file is missing.', database.file ? null : 'database-details')
    else if (database.engine !== 'None detected') add('database-service', 'Database setup', 'failed', `${database.engine} is required but no project database is configured.`, 'database-details')
  }
  if (migrationSummary && migrationSummary.status !== 'unsupported') {
    if (migrationSummary.status === 'pending') add('migrations', 'Migrations pending', 'warning', migrationSummary.statusMessage || 'This project has pending database migrations.', 'open-migrations')
    else if (migrationSummary.status === 'failed') add('migrations', 'Migration failed', 'failed', migrationSummary.statusMessage || 'The most recent migration action failed.', 'open-migrations')
    else if (migrationSummary.status === 'unknown') add('migrations', 'Migration status unknown', 'warning', migrationSummary.statusMessage || 'Stacker could not confirm the migration state.', 'open-migrations')
    else if (migrationSummary.status === 'current') add('migrations', 'Migrations', 'healthy', 'Database is up to date.')
  }
  const portFree = await portAvailable(project.preferredPort)
  const owner = !portFree && !isRunning ? await portOwner(project.preferredPort) : null
  const ownerText = owner ? ` (${owner.command}, PID ${owner.pid})` : ''
  add('port', 'Preferred port', portFree || isRunning ? 'healthy' : project.fixedPort ? 'failed' : 'warning', isRunning ? `Owned by this project on ${activePort || project.preferredPort}.` : portFree ? `Port ${project.preferredPort} is available.` : project.fixedPort ? `Required port ${project.preferredPort} is already in use${ownerText}.` : `Port ${project.preferredPort} is busy${ownerText}; an alternate will be selected at startup.`, portFree || isRunning ? null : 'choose-port')
  if (isRunning) {
    const route = await routeResponds(activePort || project.preferredPort)
    add('route', 'Application response', route.ok ? 'healthy' : 'failed', route.detail, 'restart')
    if (activeApiPort) {
      // API liveness and database connectivity are separate checks. The
      // generated `/api/health` route intentionally returns 503 when its
      // database is unavailable, while `/api` proves Express itself works.
      const apiRoute = await routeResponds(activeApiPort, null, '/api')
      add('api-route', 'API response', apiRoute.ok ? 'healthy' : 'failed', apiRoute.ok ? `${apiRoute.detail} from /api on port ${activeApiPort}.` : apiRoute.detail, 'restart')
    }
    if (localProxy?.port) {
      const proxy = await routeResponds(localProxy.port, project.localDomain)
      add('proxy-route', 'Proxy route', proxy.ok ? 'healthy' : 'failed', proxy.ok ? `${project.localDomain}:${localProxy.port} routes to this project.` : `The stable local domain returned: ${proxy.detail}.`, proxy.ok ? null : 'restart-proxy')
    }
  } else add('route', 'Application response', 'idle', 'Start the project to check its response.')
  const failed = checks.filter(check => check.status === 'failed').length
  const warnings = checks.filter(check => check.status === 'warning').length
  return { status: failed ? 'Failed' : warnings ? 'Warning' : 'Healthy', summary: { total: checks.length, healthy: checks.filter(check => check.status === 'healthy').length, warnings, failed }, checks, checkedAt: new Date().toISOString() }
}

module.exports = { runHealth, portAvailable, routeResponds }
