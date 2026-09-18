const fs = require('fs/promises')
const { constants } = require('fs')
const path = require('path')

const SQLITE_CANDIDATES = ['server/database/database.sqlite', 'database/database.sqlite', 'writable/database.sqlite', 'prisma/dev.db', 'data/database.sqlite', 'database.sqlite', 'db.sqlite', 'dev.db']

function containedPath(root, relative) {
  const resolved = path.resolve(root, relative)
  const prefix = path.resolve(root) + path.sep
  if (!resolved.startsWith(prefix)) throw new Error('Database path must stay inside the project folder.')
  return resolved
}

class DatabaseManager {
  constructor() { this.destructiveOperations = new Set() }
  async info(project) {
    if (project.database?.engine && project.database.engine !== 'SQLite') return { ...project.database, password: undefined, status: 'Ready', managed: project.database.managed !== false, service: project.database.service !== false }
    if (project.database?.engine === 'SQLite' && project.database.file) {
      const file = path.resolve(project.database.file)
      const stat = await fs.stat(file).catch(() => null)
      return { ...project.database, engine: 'SQLite', file: stat?.isFile() ? file : null, status: stat?.isFile() ? 'Ready' : 'Unavailable', service: false, size: stat?.size || 0 }
    }
    for (const relative of SQLITE_CANDIDATES) {
      const file = containedPath(project.path, relative)
      const stat = await fs.stat(file).catch(() => null)
      if (stat?.isFile()) return { engine: 'SQLite', status: 'Ready', file, relativePath: relative, size: stat.size, updatedAt: stat.mtime.toISOString(), managed: true }
    }
    if (project.database?.engine) return { ...project.database, password: undefined, status: 'Ready', managed: project.database.managed !== false, service: project.database.service !== false }
    return { engine: project.databaseHints?.[0] || 'None detected', status: 'Not configured', file: null, managed: false }
  }

  async createSqlite(project, relativePath = 'database/database.sqlite') {
    const target = containedPath(project.path, relativePath)
    if (!/\.(sqlite|sqlite3|db)$/i.test(target)) throw new Error('SQLite files must use a .sqlite, .sqlite3, or .db extension.')
    await fs.mkdir(path.dirname(target), { recursive: true })
    const handle = await fs.open(target, 'wx', 0o600).catch(error => {
      if (error.code === 'EEXIST') throw new Error('The SQLite database already exists.')
      throw error
    })
    await handle.close()
    return { engine: 'SQLite', status: 'Ready', file: target, relativePath: path.relative(project.path, target), size: 0, managed: true, service: false }
  }

  async backup(project, destination) {
    const database = await this.info(project)
    if (!database.file) throw new Error('No project SQLite database was detected.')
    const resolved = path.resolve(destination)
    if (resolved === database.file) throw new Error('Choose a different location for the backup.')
    await fs.copyFile(database.file, resolved, constants.COPYFILE_EXCL).catch(async error => {
      if (error.code === 'EEXIST') throw new Error('A file already exists at the selected backup path.')
      throw error
    })
    return { destination: resolved, size: (await fs.stat(resolved)).size }
  }

  async restore(project, source, confirmation) {
    if (confirmation !== project.name) throw new Error(`Type “${project.name}” to confirm the restore.`)
    if (this.destructiveOperations.has(project.path)) throw new Error('Another destructive database action is already running for this project.')
    this.destructiveOperations.add(project.path)
    try {
    const database = await this.info(project)
    if (!database.file) throw new Error('No project SQLite database was detected.')
    const sourcePath = path.resolve(source)
    const sourceStat = await fs.stat(sourcePath)
    if (!sourceStat.isFile()) throw new Error('The selected backup is not a file.')
    const safetyCopy = `${database.file}.before-restore-${Date.now()}`
    await fs.copyFile(database.file, safetyCopy)
    await fs.copyFile(sourcePath, database.file)
    return { restored: true, safetyCopy }
    } finally { this.destructiveOperations.delete(project.path) }
  }

  async reset(project, confirmation) {
    if (confirmation !== project.name) throw new Error(`Type “${project.name}” to confirm the reset.`)
    if (this.destructiveOperations.has(project.path)) throw new Error('Another destructive database action is already running for this project.')
    this.destructiveOperations.add(project.path)
    try {
    const database = await this.info(project)
    if (!database.file) throw new Error('No project SQLite database was detected.')
    const safetyCopy = `${database.file}.before-reset-${Date.now()}`
    await fs.copyFile(database.file, safetyCopy)
    await fs.truncate(database.file, 0)
    return { reset: true, safetyCopy }
    } finally { this.destructiveOperations.delete(project.path) }
  }
}

module.exports = { DatabaseManager, containedPath, SQLITE_CANDIDATES }
