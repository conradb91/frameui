const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { commandFor } = require('./process-manager.cjs')

const ADAPTERS = {
  laravel: { id: 'laravel', name: 'Laravel', migrationFolder: 'database/migrations', seedFolder: 'database/seeders', supportsRollbackStep: true, supportsIndividual: true },
  codeigniter: { id: 'codeigniter', name: 'CodeIgniter 4', migrationFolder: 'app/Database/Migrations', seedFolder: 'app/Database/Seeds', supportsRollbackStep: false, supportsIndividual: false },
  prisma: { id: 'prisma', name: 'Prisma', migrationFolder: 'prisma/migrations', seedFolder: null, supportsRollbackStep: false, supportsIndividual: false },
}

function adapterFor(project) {
  const adapter = ADAPTERS[project?.framework?.id] || (project?.migrationsDetected || []).map(id => ADAPTERS[id]).find(Boolean) || null
  return adapter ? { ...adapter, migrationFolder: project.migrationFolder || adapter.migrationFolder } : null
}

function supportsMigrations(project) {
  return Boolean(adapterFor(project))
}

function splitRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

// Laravel's `migrate:status` renders either the modern compact list
// ("name .......... [1] Ran" / "name .......... Pending") or a classic
// ASCII table ("| Yes | name | 1 |"). Parse failure returns recognized:false
// so the caller reports Unknown rather than guessing.
function parseLaravelStatus(output) {
  const lines = String(output || '').split(/\r?\n/)
  const items = []
  let tableMissing = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/migration table not found/i.test(line)) { tableMissing = true; continue }
    // Laravel shortens the dot leader to two characters when stdout is
    // non-interactive/narrow, which is exactly how Electron captures it.
    let match = line.match(/^(.+?)\s*\.{2,}\s*(?:\[(\d+)\]\s*)?(Ran|Pending)\s*$/)
    if (match) { items.push({ name: match[1].trim(), batch: match[2] ? Number(match[2]) : null, ran: match[3] === 'Ran' }); continue }
    match = line.match(/^\|\s*(Yes|No)\s*\|\s*([^|]+?)\s*\|\s*(\d*)\s*\|?/i)
    if (match) { items.push({ name: match[2].trim(), batch: match[3] ? Number(match[3]) : null, ran: /^yes$/i.test(match[1]) }); continue }
  }
  if (tableMissing) return { items: [], pendingCount: null, tableMissing: true, recognized: true }
  if (!items.length) {
    if (/nothing to migrate|no migrations (were )?found/i.test(output || '')) return { items: [], pendingCount: 0, tableMissing: false, recognized: true }
    return { items: [], pendingCount: null, tableMissing: false, recognized: false }
  }
  return { items, pendingCount: items.filter(item => !item.ran).length, tableMissing: false, recognized: true }
}

// CodeIgniter 4's `spark migrate:status` renders an ASCII table with a
// "Filename" column and a "Migrated On" column (blank/"--" when pending).
function parseCodeIgniterStatus(output) {
  const lines = String(output || '').split(/\r?\n/)
  let filenameIdx = -1
  let migratedIdx = -1
  let headerSeen = false
  const items = []
  for (const line of lines) {
    const cells = splitRow(line)
    if (!cells) continue
    if (!headerSeen && cells.some(cell => /filename/i.test(cell))) {
      headerSeen = true
      filenameIdx = cells.findIndex(cell => /filename/i.test(cell))
      migratedIdx = cells.findIndex(cell => /migrated/i.test(cell))
      continue
    }
    if (!headerSeen || filenameIdx === -1) continue
    const name = cells[filenameIdx]
    if (!name) continue
    const migratedValue = migratedIdx === -1 ? '' : (cells[migratedIdx] || '')
    const ran = Boolean(migratedValue) && !/^-+$/.test(migratedValue) && migratedValue.toLowerCase() !== 'n/a'
    items.push({ name, batch: null, ran, appliedAt: ran ? migratedValue : null })
  }
  if (!headerSeen) {
    if (/no migrations (were )?found|nothing to migrate|already (up to date|latest)/i.test(output || '')) return { items: [], pendingCount: 0, tableMissing: false, recognized: true }
    return { items: [], pendingCount: null, tableMissing: false, recognized: false }
  }
  return { items, pendingCount: items.filter(item => !item.ran).length, tableMissing: false, recognized: true }
}

function parsePrismaStatus(output) {
  const value = String(output || '')
  if (/database schema is up to date|no pending migrations/i.test(value)) return { items: [], pendingCount: 0, tableMissing: false, recognized: true }
  const items = []
  let capture = false
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/following migration.*not yet been applied/i.test(line)) { capture = true; continue }
    if (capture && /^\d{8,}[_-][a-z0-9_-]+$/i.test(line)) items.push({ name: line, batch: null, ran: false })
  }
  if (capture) return { items, pendingCount: items.length, tableMissing: false, recognized: true }
  return { items: [], pendingCount: null, tableMissing: false, recognized: false }
}

// CodeIgniter's Spark runner can render an uncaught exception and still exit
// with code 0. Schema actions must therefore inspect its structured exception
// banner instead of treating the process exit code as the only source of truth.
function frameworkCommandFailed(project, output) {
  if (project?.framework?.id !== 'codeigniter') return false
  return /^\[(?:[^\]\r\n]*Exception|Error|ParseError|Throwable)\]\s*$/mi.test(String(output || ''))
}

function migrationItem(item, index) {
  const name = String(item.name || '')
  const version = name.match(/^(\d{4}[_-]\d{2}[_-]\d{2}(?:[_-]\d{6})?|\d{8,14})/)?.[1] || null
  return { ...item, order: index + 1, version, status: item.ran ? 'applied' : 'pending' }
}

function hostFromUrl(value) {
  if (!value) return null
  try { return new URL(value).hostname || null } catch { return null }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

async function classifyDatabaseTarget(project, readEnvironmentFn) {
  const db = project.database
  if (db?.engine === 'SQLite') return { classification: 'local', reason: 'SQLite is a local project file.' }
  if (db?.host && LOCAL_HOSTS.has(db.host)) return { classification: 'local', reason: 'Stacker-managed local database service.' }
  try {
    const environment = await readEnvironmentFn(project)
    const vars = Object.fromEntries(environment.variables.map(item => [item.key, item.value]))
    const host = vars.DB_HOST || hostFromUrl(vars.DATABASE_URL) || hostFromUrl(vars.DB_URL)
    if (!host) return { classification: 'unknown', reason: 'No database host could be determined from the project environment.' }
    if (LOCAL_HOSTS.has(host) || host.startsWith('/')) return { classification: 'local', reason: `${host} is a local address.` }
    return { classification: 'remote', reason: `${host} does not appear to be a local address.` }
  } catch {
    return { classification: 'unknown', reason: 'Could not read the project environment file.' }
  }
}

class MigrationManager {
  constructor({ store, processManager, databaseManager, databaseServices, readEnvironment, emit = () => {} }) {
    this.store = store
    this.processManager = processManager
    this.databaseManager = databaseManager
    this.databaseServices = databaseServices
    this.readEnvironment = readEnvironment
    this.emit = emit
    this.locks = new Set()
  }

  invalidate(projectId) {
    this.store.invalidateMigrationSummary(projectId)
  }

  async databaseIdentity(project) {
    if (project.database?.engine === 'SQLite') {
      const info = await this.databaseManager.info(project)
      if (!info.file) return null
      return { engine: 'SQLite', databaseId: info.relativePath, database: info.relativePath, host: null }
    }
    if (project.database?.engine) {
      return { engine: project.database.engine, databaseId: `${project.database.engine}:${project.database.database}`, database: project.database.database, host: project.database.host || null }
    }
    return null
  }

  async scanMigrationFiles(project, adapter) {
    try {
      const entries = await fs.readdir(path.resolve(project.path, adapter.migrationFolder), { withFileTypes: true })
      return entries.filter(entry => adapter.id === 'prisma' ? entry.isDirectory() : entry.isFile() && entry.name.endsWith('.php'))
        .map(entry => ({ name: entry.name.replace(/\.php$/, ''), file: entry.name, batch: null, ran: false, source: 'project' }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch { return [] }
  }

  finalizeSummary(project, patch) {
    const previous = this.store.getMigrationSummary(project.id) || {}
    const summary = {
      projectId: project.id,
      databaseId: patch.databaseId ?? previous.databaseId ?? null,
      adapterId: patch.adapterId ?? previous.adapterId ?? adapterFor(project)?.id ?? null,
      engine: patch.engine ?? previous.engine ?? null,
      status: patch.status,
      reason: patch.reason || null,
      pendingCount: patch.pendingCount ?? null,
      pendingItems: patch.pendingItems || [],
      items: patch.items || previous.items || [],
      statusMessage: patch.statusMessage || '',
      primaryAction: patch.primaryAction || null,
      targetClassification: patch.target?.classification || previous.targetClassification || 'unknown',
      targetReason: patch.target?.reason || previous.targetReason || null,
      rawOutput: patch.rawOutput || '',
      lastCheckedAt: new Date().toISOString(),
      lastActionId: patch.actionId || previous.lastActionId || null,
      lastSuccessfulActionId: patch.status === 'current' ? (patch.actionId || previous.lastSuccessfulActionId || null) : (previous.lastSuccessfulActionId || null),
      latestSafetyBackupId: previous.latestSafetyBackupId || null,
      lastRunAt: previous.lastRunAt || null,
      supportsIndividual: Boolean(adapterFor(project)?.supportsIndividual),
      execution: patch.execution || null,
      migrationFolder: adapterFor(project)?.migrationFolder || project.migrationFolder || null,
      stale: false,
    }
    this.store.setMigrationSummary(project.id, summary)
    this.emit('migration', summary)
    return summary
  }

  async refreshStatus(project) {
    const adapter = adapterFor(project)
    if (!adapter) return this.finalizeSummary(project, { status: 'unsupported', statusMessage: 'This project does not expose a supported migration workflow yet.' })
    const folder = path.resolve(project.path, adapter.migrationFolder)
    const available = await fs.stat(folder).then(info => info.isDirectory()).catch(() => false)
    if (!available) return this.finalizeSummary(project, { status: 'unknown', reason: 'migration-folder-missing', items: [], statusMessage: `Migrations folder is unavailable: ${adapter.migrationFolder}. Select Migrations Folder to locate it.`, primaryAction: 'select-folder' })
    const files = await this.scanMigrationFiles(project, adapter)
    const finalize = patch => this.finalizeSummary(project, { items: files.map((item, index) => ({ ...migrationItem(item, index), status: 'unknown' })), ...patch })
    if (project.migrationFolder && adapter.id !== 'laravel' && path.resolve(project.path, ADAPTERS[adapter.id].migrationFolder) !== folder) return finalize({ status: 'unknown', reason: 'framework-folder-configuration', statusMessage: `${adapter.name} controls its migration directory through framework configuration. Configure that directory in the project before running migrations.`, primaryAction: 'view-details' })
    if (!project.dependenciesInstalled) return finalize({ status: 'unknown', reason: 'dependencies-missing', statusMessage: 'Migration tools are not available until project dependencies are installed.', primaryAction: 'install' })
    const identity = await this.databaseIdentity(project)
    if (!identity) return finalize({ status: 'unknown', reason: 'no-database', statusMessage: 'Configure a project database before checking migrations.', primaryAction: 'configure-database' })
    const target = await classifyDatabaseTarget(project, this.readEnvironment)
    if (target.classification === 'remote') return finalize({ status: 'unknown', reason: 'remote-database', statusMessage: `Remote database detected at ${identity.host || 'an external host'}. Stacker did not run a migration command.`, primaryAction: 'view-details', databaseId: identity.databaseId, engine: identity.engine, target })
    if (identity.engine !== 'SQLite' && project.database?.managed !== false) {
      const engineKey = identity.engine === 'PostgreSQL' ? 'postgres' : 'mariadb'
      const serviceStatus = await this.databaseServices.status(engineKey)
      if (!serviceStatus.running) return finalize({ status: 'unknown', reason: 'database-not-running', statusMessage: 'Local database is not running.', primaryAction: 'start-database', databaseId: identity.databaseId, engine: identity.engine })
    }
    const command = commandFor(project, 'migrate-status')
    if (command && project.migrationFolder && adapter.id === 'laravel') command[1].push(`--path=${project.migrationFolder}`, '--realpath')
    if (!command) return finalize({ status: 'unsupported', statusMessage: 'This project does not expose a supported migration workflow yet.' })
    let result
    try {
      result = await this.processManager.runCommand(project, 'migrate-status', command)
    } catch (error) {
      return finalize({ status: 'unknown', reason: 'command-failed', statusMessage: 'Migration status could not be confirmed.', rawOutput: String(error.message || error), primaryAction: 'view-details', databaseId: identity.databaseId, engine: identity.engine, target })
    }
    const raw = `${result.stdout}${result.stderr}`
    const missingLaravelTable = adapter.id === 'laravel' && parseLaravelStatus(raw).tableMissing
    if (result.task.exitCode !== 0 && !missingLaravelTable) {
      return finalize({ status: 'unknown', reason: 'command-failed', statusMessage: 'Migration status could not be confirmed.', rawOutput: raw, primaryAction: 'view-details', databaseId: identity.databaseId, engine: identity.engine, target, actionId: result.task.id })
    }
    const parsed = adapter.id === 'laravel' ? parseLaravelStatus(raw) : adapter.id === 'codeigniter' ? parseCodeIgniterStatus(raw) : parsePrismaStatus(raw)
    if (!parsed.recognized) {
      return finalize({ status: 'unknown', reason: 'parse-failed', statusMessage: 'Migration status could not be confirmed.', rawOutput: raw, primaryAction: 'view-details', databaseId: identity.databaseId, engine: identity.engine, target, actionId: result.task.id })
    }
    let allItems = parsed.items
    let pendingItems = parsed.items.filter(item => !item.ran)
    let pendingCount = parsed.pendingCount
    let statusMessage
    if (parsed.tableMissing) {
      pendingItems = await this.scanMigrationFiles(project, adapter)
      allItems = pendingItems
      pendingCount = pendingItems.length
      statusMessage = pendingCount ? `${pendingCount} migration${pendingCount === 1 ? '' : 's'} pending — migrations have not been run for this project yet.` : 'No pending migrations were reported by the project framework.'
    } else {
      statusMessage = pendingCount ? `${pendingCount} migration${pendingCount === 1 ? '' : 's'} pending` : 'No pending migrations were reported by the project framework.'
    }
    return finalize({
      status: pendingCount ? 'pending' : 'current',
      pendingCount, pendingItems: pendingItems.map(migrationItem), items: allItems.map(migrationItem), rawOutput: raw, target,
      databaseId: identity.databaseId, engine: identity.engine, adapterId: adapter.id,
      statusMessage, actionId: result.task.id,
    })
  }

  async status(project, { force = false } = {}) {
    const cached = this.store.getMigrationSummary(project.id)
    const age = cached ? Date.now() - new Date(cached.lastCheckedAt).getTime() : Infinity
    if (cached && !force && !cached.stale && age < 15000) return cached
    return this.refreshStatus(project)
  }

  async createSafetyBackup(project, triggeringType) {
    const identity = await this.databaseIdentity(project)
    if (!identity) throw new Error('Safety backup could not be created. Migrations were not run.')
    const dir = path.join(this.store.root, 'migrations-safety', project.id)
    await fs.mkdir(dir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const extension = identity.engine === 'SQLite' ? 'sqlite' : identity.engine === 'PostgreSQL' ? 'dump' : 'sql'
    const target = path.join(dir, `${identity.engine.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${timestamp}-${triggeringType}.${extension}`)
    let size = 0
    try {
      if (identity.engine === 'SQLite') size = (await this.databaseManager.backup(project, target)).size
      else size = (await this.databaseServices.dump(project, target)).size
    } catch (error) {
      await fs.rm(target, { force: true })
      throw new Error(`Safety backup could not be created. Migrations were not run. ${error.message}`)
    }
    // A newly created SQLite file is a valid empty database before its first migration.
    if (!size && identity.engine !== 'SQLite') {
      await fs.rm(target, { force: true })
      throw new Error('Safety backup could not be created. Migrations were not run.')
    }
    const record = { id: crypto.randomUUID(), projectId: project.id, databaseId: identity.databaseId, engine: identity.engine, file: target, size, createdAt: new Date().toISOString(), kind: 'migration-safety', triggeringType }
    this.store.addMigrationBackup(record)
    await this.pruneBackups(project.id, identity.databaseId)
    return record
  }

  async pruneBackups(projectId, databaseId, keep = 10) {
    const records = this.store.listMigrationBackups(projectId, databaseId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    const excess = records.slice(keep)
    if (!excess.length) return
    await Promise.all(excess.map(record => fs.rm(record.file, { force: true }).catch(() => null)))
    this.store.removeMigrationBackups(excess.map(record => record.id))
  }

  async restoreBackup(project, backupId, confirmation) {
    const record = this.store.listMigrationBackups(project.id).find(item => item.id === backupId)
    if (!record) throw new Error('The selected safety backup could not be found.')
    const identity = await this.databaseIdentity(project)
    if (!identity) throw new Error('This project no longer has a configured database.')
    const result = identity.engine === 'SQLite' ? await this.databaseManager.restore(project, record.file, confirmation) : await this.databaseServices.restore(project, record.file, confirmation)
    this.invalidate(project.id)
    return result
  }

  async executeSchemaAction(project, { type, requiresBackup, command }) {
    if (this.locks.has(project.id)) throw new Error('Another database action is already running for this project.')
    this.locks.add(project.id)
    const startedAt = new Date().toISOString()
    try {
      const identity = await this.databaseIdentity(project)
      if (identity?.engine && identity.engine !== 'SQLite' && project.database?.managed !== false) await this.databaseServices.start(identity.engine === 'PostgreSQL' ? 'postgres' : 'mariadb')
      const status = await this.refreshStatus(project)
      if (status.status === 'unsupported') throw new Error('This project does not expose a supported migration workflow yet.')
      if (status.status === 'unknown') throw new Error(status.statusMessage || 'Migration status could not be confirmed. Resolve the underlying issue before running migrations.')
      if (status.targetClassification === 'remote') throw new Error('This database does not appear to be local. Review the project database settings before running migrations.')
      if (type === 'seed' && status.status === 'pending') throw new Error('Apply the pending migrations before running a seeder. For a fresh CodeIgniter database, use “Migrate & Run Seeder”.')
      if (type === 'migrate' && status.status === 'current') return { skipped: true, message: 'Database is already up to date.', summary: status }
      let backup = null
      if (requiresBackup) backup = await this.createSafetyBackup(project, type)
      const executionItems = type === 'migrate' ? status.pendingItems || [] : []
      let executionIndex = executionItems.length ? 0 : -1
      const executionResults = []
      if (executionItems.length) this.emit('migration', { ...status, execution: { index: 1, total: executionItems.length, migration: executionItems[0].name, status: 'running', results: [] } })
      const result = await this.processManager.runCommand(project, command.action, command.spec, { onOutput: message => {
        if (!executionItems.length) return
        const matchedIndex = executionItems.findIndex(item => String(message).includes(item.name))
        if (matchedIndex < 0) return
        while (executionResults.length < matchedIndex) executionResults.push({ name: executionItems[executionResults.length].name, order: executionResults.length + 1, status: 'applied', rawOutput: '' })
        executionIndex = matchedIndex
        this.emit('migration', { ...status, execution: { index: matchedIndex + 1, total: executionItems.length, migration: executionItems[matchedIndex].name, status: 'running', results: executionResults } })
      } })
      const raw = `${result.stdout}${result.stderr}`
      const success = result.task.status === 'Completed' && !frameworkCommandFailed(project, raw)
      const record = {
        id: crypto.randomUUID(),
        projectId: project.id,
        databaseId: status.databaseId,
        type,
        adapterId: status.adapterId,
        commandDisplay: result.task.command,
        startedAt, completedAt: new Date().toISOString(),
        result: result.task.status === 'Cancelled' ? 'cancelled' : success ? 'success' : 'failed',
        exitCode: result.task.exitCode,
        backupId: backup?.id || null,
        pendingBefore: status.pendingCount,
        rawLogRef: result.task.id,
        databaseTarget: { engine: status.engine, host: project.database?.host || null, database: project.database?.database || project.database?.relativePath || null },
        rawOutput: raw,
      }
      if (!success) {
        // Never automatically retry or re-derive status after a failure — the
        // command may have left the database partially updated, and the
        // Failed state must stick until the user reviews it (spec 5.3/8.2).
        const failedMigration = executionItems[executionIndex]?.name || null
        record.failedMigration = failedMigration
        record.pendingAfter = status.pendingCount
        this.store.addMigrationHistory(record)
        const failedSummary = this.finalizeSummary(project, {
          status: 'failed', reason: 'action-failed',
          statusMessage: `${failedMigration ? `${failedMigration} failed.` : 'Migration stopped with an error.'} The database may be partially updated.`,
          primaryAction: 'view-failure', rawOutput: raw,
          databaseId: status.databaseId, engine: status.engine, adapterId: status.adapterId,
          pendingCount: status.pendingCount, pendingItems: status.pendingItems, actionId: record.id,
          items: (status.items || []).map(item => item.name === failedMigration ? { ...item, status: 'failed' } : item),
        })
        const finalSummary = { ...failedSummary, latestSafetyBackupId: backup?.id || failedSummary.latestSafetyBackupId, lastRunAt: record.completedAt }
        this.store.setMigrationSummary(project.id, finalSummary)
        const failedExecution = executionItems.length ? { index: executionIndex + 1, total: executionItems.length, migration: failedMigration, status: 'failed', results: [...executionResults, ...(failedMigration ? [{ name: failedMigration, order: executionIndex + 1, status: 'failed', rawOutput: raw }] : [])] } : null
        if (failedExecution) { finalSummary.execution = failedExecution; this.store.setMigrationSummary(project.id, finalSummary); this.emit('migration', finalSummary) }
        return { success: false, record, summary: finalSummary, rawOutput: raw, failureStage: 'command', failedMigration }
      }
      this.invalidate(project.id)
      const refreshed = await this.refreshStatus(project)
      record.pendingAfter = refreshed.pendingCount
      this.store.addMigrationHistory(record)
      const finalSummary = { ...refreshed, latestSafetyBackupId: backup?.id || refreshed.latestSafetyBackupId, lastRunAt: record.completedAt, lastSuccessfulActionId: record.id }
      if (executionItems.length) {
        finalSummary.execution = { index: executionItems.length, total: executionItems.length, migration: executionItems.at(-1).name, status: 'completed', results: executionItems.map((item, index) => ({ name: item.name, order: index + 1, status: 'applied', rawOutput: '' })) }
      }
      this.store.setMigrationSummary(project.id, finalSummary)
      this.emit('migration', finalSummary)
      return { success: true, record, summary: finalSummary, rawOutput: raw }
    } finally {
      this.locks.delete(project.id)
    }
  }

  async run(project, { skipBackup = false } = {}) {
    const adapter = adapterFor(project)
    if (adapter?.supportsIndividual) {
      const status = await this.status(project, { force: true })
      if (status.status === 'pending' && status.pendingItems.length) return this.runSelected(project, status.pendingItems.map(item => item.name), { skipBackup })
    }
    const spec = commandFor(project, 'migrate')
    if (!spec) throw new Error('This project does not expose a supported migration workflow.')
    if (project.migrationFolder && adapterFor(project)?.id === 'laravel') spec[1].push(`--path=${project.migrationFolder}`, '--realpath')
    return this.executeSchemaAction(project, { type: 'migrate', requiresBackup: !skipBackup, command: { action: 'migrate', spec } })
  }

  async runSelected(project, names, { skipBackup = false } = {}) {
    const adapter = adapterFor(project)
    if (!adapter?.supportsIndividual) throw new Error(`${adapter?.name || 'This migration system'} does not support running individual migrations safely.`)
    if (this.locks.has(project.id)) throw new Error('Another database action is already running for this project.')
    this.locks.add(project.id)
    const startedAt = new Date().toISOString()
    let backup = null
    try {
      const identity = await this.databaseIdentity(project)
      if (identity?.engine && identity.engine !== 'SQLite' && project.database?.managed !== false) await this.databaseServices.start(identity.engine === 'PostgreSQL' ? 'postgres' : 'mariadb')
      let status = await this.refreshStatus(project)
      if (status.status !== 'pending') {
        if (status.status === 'current') return { skipped: true, message: 'Database is already up to date.', summary: status }
        throw new Error(status.statusMessage || 'Migration status could not be confirmed.')
      }
      if (status.targetClassification === 'remote') throw new Error('This database does not appear to be local. Review the project database settings before running migrations.')
      const requested = [...new Set((names || []).map(String))]
      const pendingByName = new Map(status.pendingItems.map(item => [item.name, item]))
      const ordered = status.pendingItems.filter(item => requested.includes(item.name))
      if (!ordered.length) throw new Error('Select at least one pending migration.')
      const unknown = requested.filter(name => !pendingByName.has(name))
      if (unknown.length) throw new Error(`These migrations are not pending: ${unknown.join(', ')}.`)
      if (!skipBackup) backup = await this.createSafetyBackup(project, 'migrate-selected')
      const results = []
      for (let index = 0; index < ordered.length; index += 1) {
        const migration = ordered[index]
        const execution = { index: index + 1, total: ordered.length, migration: migration.name, status: 'running', results }
        this.emit('migration', { ...status, projectId: project.id, execution })
        const relativeFile = migration.file || `${migration.name}.php`
        if (path.basename(relativeFile) !== relativeFile || /[\\/]/.test(relativeFile) || !relativeFile.endsWith('.php')) throw new Error('The migration filename is outside the selected migrations folder.')
        const spec = ['php', ['artisan', 'migrate', `--path=${path.join(adapter.migrationFolder, relativeFile)}`, ...(path.isAbsolute(adapter.migrationFolder) ? ['--realpath'] : []), '--force']]
        const result = await this.processManager.runCommand(project, 'migrate-one', spec)
        const raw = `${result.stdout}${result.stderr}`
        const success = result.task.status === 'Completed'
        const migrationResult = { name: migration.name, order: index + 1, status: success ? 'applied' : 'failed', command: result.task.command, exitCode: result.task.exitCode, rawOutput: raw }
        results.push(migrationResult)
        if (!success) {
          const record = { id: crypto.randomUUID(), projectId: project.id, databaseId: status.databaseId, type: 'migrate', adapterId: adapter.id, commandDisplay: result.task.command, startedAt, completedAt: new Date().toISOString(), result: 'failed', exitCode: result.task.exitCode, backupId: backup?.id || null, pendingBefore: status.pendingCount + index, pendingAfter: status.pendingCount, rawLogRef: result.task.id, databaseTarget: { engine: status.engine, host: project.database?.host || null, database: project.database?.database || project.database?.relativePath || null }, rawOutput: raw, migrationResults: results, failedMigration: migration.name }
          this.store.addMigrationHistory(record)
          const remaining = status.pendingCount
          const failedSummary = this.finalizeSummary(project, { status: 'failed', reason: 'action-failed', statusMessage: `${migration.name} failed. ${remaining} migration${remaining === 1 ? '' : 's'} remain pending.`, primaryAction: 'view-failure', rawOutput: raw, databaseId: status.databaseId, engine: status.engine, adapterId: adapter.id, pendingCount: record.pendingAfter, pendingItems: status.pendingItems, items: status.items.map(item => item.name === migration.name ? { ...item, status: 'failed' } : item), actionId: record.id, execution: { index: index + 1, total: ordered.length, migration: migration.name, status: 'failed', results } })
          return { success: false, record, summary: failedSummary, rawOutput: raw, failedMigration: migration.name, results, failureStage: 'command' }
        }
        this.invalidate(project.id)
        status = await this.refreshStatus(project)
        this.emit('migration', { ...status, projectId: project.id, execution: { index: index + 1, total: ordered.length, migration: migration.name, status: 'completed', results } })
      }
      const record = { id: crypto.randomUUID(), projectId: project.id, databaseId: status.databaseId, type: 'migrate', adapterId: adapter.id, commandDisplay: `${ordered.length} migrations run sequentially`, startedAt, completedAt: new Date().toISOString(), result: 'success', exitCode: 0, backupId: backup?.id || null, pendingBefore: ordered.length + (status.pendingCount || 0), pendingAfter: status.pendingCount, rawLogRef: null, databaseTarget: { engine: status.engine, host: project.database?.host || null, database: project.database?.database || project.database?.relativePath || null }, rawOutput: results.map(item => item.rawOutput).join('\n'), migrationResults: results }
      this.store.addMigrationHistory(record)
      const finalSummary = { ...status, latestSafetyBackupId: backup?.id || status.latestSafetyBackupId, lastRunAt: record.completedAt, lastSuccessfulActionId: record.id, execution: { index: ordered.length, total: ordered.length, migration: ordered.at(-1).name, status: 'completed', results } }
      this.store.setMigrationSummary(project.id, finalSummary)
      this.emit('migration', finalSummary)
      return { success: true, record, summary: finalSummary, results }
    } finally {
      this.locks.delete(project.id)
    }
  }

  async initialize(project, { seeder = null, skipBackup = false } = {}) {
    const migration = await this.run(project, { skipBackup })
    if (migration.success === false) return { success: false, stage: 'migrations', migration }
    if (!seeder) return { success: true, migration, seed: null }
    const seed = await this.runSeeder(project, seeder, { withBackup: false })
    return { success: seed.success !== false, stage: seed.success === false ? 'seed' : 'complete', migration, seed }
  }

  async rollback(project, { mode = 'batch' } = {}) {
    const adapter = adapterFor(project)
    if (!adapter) throw new Error('This project does not expose a supported migration workflow.')
    if (mode === 'step' && !adapter.supportsRollbackStep) throw new Error('Rolling back a single migration is not supported for this framework.')
    const action = mode === 'step' ? 'migrate-rollback-step' : 'migrate-rollback-batch'
    const spec = commandFor(project, action)
    if (!spec) throw new Error('This project does not expose a supported rollback command.')
    return this.executeSchemaAction(project, { type: 'rollback', requiresBackup: true, command: { action, spec } })
  }

  async listSeeders(project) {
    const adapter = adapterFor(project)
    if (!adapter?.seedFolder) return []
    try {
      const entries = await fs.readdir(path.join(project.path, adapter.seedFolder), { withFileTypes: true })
      return entries.filter(entry => entry.isFile() && entry.name.endsWith('.php')).map(entry => entry.name.replace(/\.php$/, ''))
    } catch { return [] }
  }

  async runSeeder(project, name = null, { withBackup = false } = {}) {
    const adapter = adapterFor(project)
    if (!adapter) throw new Error('This project does not expose a supported migration workflow.')
    if (name && !/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Invalid seeder name.')
    let spec
    if (adapter.id === 'laravel') spec = name ? ['php', ['artisan', 'db:seed', `--class=${name}`]] : ['php', ['artisan', 'db:seed']]
    else {
      if (!name) throw new Error('Select a seeder to run for this project type.')
      spec = ['php', ['spark', 'db:seed', name]]
    }
    return this.executeSchemaAction(project, { type: 'seed', requiresBackup: withBackup, command: { action: 'seed', spec } })
  }

  history(projectId) { return this.store.listMigrationHistory(projectId) }

  backups(projectId) { return this.store.listMigrationBackups(projectId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) }
}

module.exports = { MigrationManager, adapterFor, supportsMigrations, parseLaravelStatus, parseCodeIgniterStatus, parsePrismaStatus, frameworkCommandFailed, classifyDatabaseTarget, ADAPTERS }
