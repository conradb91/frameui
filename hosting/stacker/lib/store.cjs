const fs = require('fs')
const path = require('path')
const os = require('os')

const DEFAULT_SETTINGS = {
  defaultProjectDirectory: path.join(os.homedir(), 'Projects'),
  browserOnStart: true,
  defaultDatabaseEngine: 'sqlite',
  defaultNodeVersion: 'lts',
  defaultPhpVersion: 'latest',
  logRetentionDays: 14,
  maxLogSizeMb: 10,
  clipboardClearSeconds: 60,
  supportExportRecords: 250,
  tooltips: true,
  advancedDetails: false,
  checkForUpdates: false,
  keepServicesRunning: false,
  orientationComplete: false,
}

function stripTerminalFormatting(value) {
  return String(value || '')
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B[()][A-Z0-9]/g, '')
    .replace(/\r(?=.)/g, '\n')
}

class Store {
  constructor(root) {
    this.root = root
    this.file = path.join(root, 'state.json')
    this.logsRoot = path.join(root, 'logs')
    fs.mkdirSync(this.logsRoot, { recursive: true })
    this.state = this.read()
    this.logWrites = 0
    this.pruneAllLogs()
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return { projects: [], tasks: [], migrationSummaries: {}, migrationHistory: [], migrationBackups: [], processRegistry: {}, ...parsed, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) } }
    } catch {
      return { projects: [], tasks: [], migrationSummaries: {}, migrationHistory: [], migrationBackups: [], processRegistry: {}, settings: { ...DEFAULT_SETTINGS } }
    }
  }

  write() {
    fs.mkdirSync(this.root, { recursive: true })
    const temporary = `${this.file}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, this.file)
  }

  listProjects() {
    return [...this.state.projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.lastActivity) - new Date(a.lastActivity))
  }

  getProject(id) {
    return this.state.projects.find(project => project.id === id) || null
  }

  upsertProject(project) {
    const index = this.state.projects.findIndex(item => item.id === project.id)
    if (index === -1) this.state.projects.push(project)
    else this.state.projects[index] = { ...this.state.projects[index], ...project }
    this.write()
    return this.getProject(project.id)
  }

  removeProject(id) {
    this.state.projects = this.state.projects.filter(project => project.id !== id)
    this.write()
  }

  addTask(task) {
    this.state.tasks.unshift(task)
    this.state.tasks = this.state.tasks.slice(0, 200)
    this.write()
  }

  updateTask(id, patch) {
    const task = this.state.tasks.find(item => item.id === id)
    if (task) Object.assign(task, patch)
    this.write()
    return task
  }

  listTasks(projectId) {
    return this.state.tasks.filter(task => !projectId || task.projectId === projectId)
  }

  getSettings() { return { ...this.state.settings } }

  updateSettings(patch) {
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS))
    const next = { ...this.state.settings }
    for (const [key, value] of Object.entries(patch || {})) if (allowed.has(key)) next[key] = value
    next.logRetentionDays = Math.max(1, Math.min(365, Number(next.logRetentionDays) || DEFAULT_SETTINGS.logRetentionDays))
    next.maxLogSizeMb = Math.max(1, Math.min(500, Number(next.maxLogSizeMb) || DEFAULT_SETTINGS.maxLogSizeMb))
    next.clipboardClearSeconds = Math.max(0, Math.min(3600, Number(next.clipboardClearSeconds) || 0))
    next.supportExportRecords = Math.max(50, Math.min(2000, Number(next.supportExportRecords) || DEFAULT_SETTINGS.supportExportRecords))
    if (!['none', 'sqlite', 'postgres', 'mariadb'].includes(next.defaultDatabaseEngine)) next.defaultDatabaseEngine = DEFAULT_SETTINGS.defaultDatabaseEngine
    this.state.settings = next
    this.write()
    this.pruneAllLogs()
    return this.getSettings()
  }

  appendLog(projectId, source, level, message) {
    const record = { timestamp: new Date().toISOString(), source, level, message: stripTerminalFormatting(message) }
    fs.appendFileSync(path.join(this.logsRoot, `${projectId}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 })
    this.logWrites += 1
    if (this.logWrites % 100 === 0) this.pruneLogFile(path.join(this.logsRoot, `${projectId}.jsonl`), true)
    return record
  }

  pruneLogFile(file, force = false) {
    try {
      const maximum = this.state.settings.maxLogSizeMb * 1024 * 1024
      const cutoff = Date.now() - this.state.settings.logRetentionDays * 24 * 60 * 60 * 1000
      const stat = fs.statSync(file)
      if (!force && stat.size < maximum && stat.mtimeMs >= cutoff) return
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      let kept = lines.filter(line => {
        try { return new Date(JSON.parse(line).timestamp).getTime() >= cutoff } catch { return false }
      })
      while (Buffer.byteLength(`${kept.join('\n')}\n`) > maximum && kept.length > 1) kept = kept.slice(Math.max(1, Math.floor(kept.length * 0.1)))
      fs.writeFileSync(file, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 })
    } catch {}
  }

  pruneAllLogs() {
    try { for (const file of fs.readdirSync(this.logsRoot)) if (file.endsWith('.jsonl')) this.pruneLogFile(path.join(this.logsRoot, file), true) } catch {}
  }

  readLogs(projectId, limit = 500) {
    try {
      const lines = fs.readFileSync(path.join(this.logsRoot, `${projectId}.jsonl`), 'utf8').trim().split('\n').slice(-Math.min(limit, 2000))
      return lines.map(line => JSON.parse(line))
    } catch {
      return []
    }
  }

  registerProcess(projectId, info) {
    this.state.processRegistry[projectId] = { ...info, projectId }
    this.write()
  }

  unregisterProcess(projectId) {
    delete this.state.processRegistry[projectId]
    this.write()
  }

  listProcessRegistry() {
    return Object.values(this.state.processRegistry)
  }

  getMigrationSummary(projectId) {
    return this.state.migrationSummaries[projectId] || null
  }

  setMigrationSummary(projectId, summary) {
    this.state.migrationSummaries[projectId] = summary
    this.write()
    return summary
  }

  invalidateMigrationSummary(projectId) {
    const current = this.state.migrationSummaries[projectId]
    if (current) this.state.migrationSummaries[projectId] = { ...current, stale: true }
    this.write()
  }

  addMigrationHistory(record) {
    this.state.migrationHistory.unshift(record)
    this.state.migrationHistory = this.state.migrationHistory.slice(0, 300)
    this.write()
    return record
  }

  listMigrationHistory(projectId, limit = 100) {
    return this.state.migrationHistory.filter(record => record.projectId === projectId).slice(0, limit)
  }

  addMigrationBackup(record) {
    this.state.migrationBackups.unshift(record)
    this.write()
    return record
  }

  listMigrationBackups(projectId, databaseId = null) {
    return this.state.migrationBackups.filter(record => record.projectId === projectId && (!databaseId || record.databaseId === databaseId))
  }

  removeMigrationBackups(ids) {
    const removeSet = new Set(ids)
    this.state.migrationBackups = this.state.migrationBackups.filter(record => !removeSet.has(record.id))
    this.write()
  }

  readGlobalLogs(limit = 1000) {
    const projectNames = new Map(this.state.projects.map(project => [project.id, project.name]))
    const records = []
    try {
      for (const file of fs.readdirSync(this.logsRoot)) {
        if (!file.endsWith('.jsonl')) continue
        const projectId = file.slice(0, -'.jsonl'.length)
        for (const record of this.readLogs(projectId, Math.min(limit, 500))) records.push({ ...record, projectId, projectName: projectNames.get(projectId) || (projectId === 'global' ? 'Stacker' : 'Removed project') })
      }
    } catch {}
    return records.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp)).slice(0, Math.min(limit, 2000))
  }
}

module.exports = { Store, DEFAULT_SETTINGS, stripTerminalFormatting }
