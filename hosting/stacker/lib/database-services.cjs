const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFile, spawn } = require('child_process')
const { existingDatabaseConnection } = require('./environment.cjs')

const COMMON_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
const POSTGRES_DIRS = ['/Applications/Postgres.app/Contents/Versions/latest/bin', '/opt/homebrew/opt/postgresql@18/bin', '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin']
const MARIA_DIRS = ['/opt/homebrew/opt/mariadb/bin', '/usr/local/opt/mariadb/bin', '/opt/homebrew/bin', '/usr/local/bin']

function safeIdentifier(value) {
  const result = String(value).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
  if (!result) throw new Error('A safe database identifier could not be created.')
  return result
}

function projectDatabaseIdentifier(project, limit = 48) {
  const suffix = crypto.createHash('sha256').update(String(project.id || project.path)).digest('hex').slice(0, 8)
  const base = String(project.name || 'project').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'project'
  return `${base.slice(0, limit - 9)}_${suffix}`
}

function mysqlProjectSql(database, user, password) {
  const escapedPassword = String(password).replace(/\\/g, '\\\\').replace(/'/g, "''")
  const accounts = ['127.0.0.1', 'localhost']
  return [
    `CREATE DATABASE IF NOT EXISTS \`${database}\``,
    ...accounts.flatMap(host => [
      `CREATE USER IF NOT EXISTS '${user}'@'${host}' IDENTIFIED BY '${escapedPassword}'`,
      `ALTER USER '${user}'@'${host}' IDENTIFIED BY '${escapedPassword}'`,
      `GRANT ALL ON \`${database}\`.* TO '${user}'@'${host}'`,
    ]),
    'FLUSH PRIVILEGES',
  ].join('; ') + ';'
}

function findExecutable(name, directories) {
  return directories.map(directory => path.join(directory, name + (process.platform === 'win32' ? '.exe' : ''))).find(file => fssync.existsSync(file)) || null
}

function execute(file, args, options = {}) {
  return new Promise((resolve, reject) => execFile(file, args, { maxBuffer: 4 * 1024 * 1024, timeout: 60_000, ...options }, (error, stdout, stderr) => error ? reject(Object.assign(new Error(stderr.trim().replace(/IDENTIFIED BY '(?:[^']|'')*'/gi, 'IDENTIFIED BY [REDACTED]') || `${path.basename(file)} failed (${error.code || 'unknown error'}).`), { code: error.code })) : resolve(stdout.trim())))
}

function executeWithInput(file, args, inputFile, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4 * 1024 * 1024) })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(true) : reject(new Error(stderr.trim() || `Database command exited with code ${code}.`)))
    const input = fssync.createReadStream(inputFile)
    input.once('error', error => { child.kill(); reject(error) })
    child.stdin.on('error', error => { input.destroy(); child.kill(); reject(new Error(`Database input failed: ${error.code || 'stream closed'}.`)) })
    input.pipe(child.stdin)
  })
}

async function executeToFile(file, args, outputFile, options = {}) {
  const handle = await fs.open(outputFile, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('A file already exists at the selected backup path.')
    throw error
  })
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(file, args, { ...options, stdio: ['ignore', handle.fd, 'pipe'] })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4 * 1024 * 1024) })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve(true) : reject(new Error(stderr.trim() || `Database command exited with code ${code}.`)))
    })
  } catch (error) {
    await fs.rm(outputFile, { force: true })
    throw error
  } finally {
    await handle.close()
  }
}

class DatabaseServices {
  constructor(root, keychain, emit = () => {}, dbRuntimeManager = null) {
    this.root = root
    this.keychain = keychain
    this.emit = emit
    this.dbRuntimeManager = dbRuntimeManager
    this.children = new Map()
    this.starting = new Map()
    this.destructiveOperations = new Set()
    this.ports = { postgres: 55433, mariadb: 53307 }
  }

  binaries(engine) {
    const managed = this.dbRuntimeManager?.binDir(engine)
    if (engine === 'postgres') {
      const pgCtl = findExecutable('pg_ctl', [...(managed ? [managed.dir] : []), ...POSTGRES_DIRS, ...COMMON_PATH])
      if (!pgCtl) return null
      const binaries = {
        pgCtl,
        initdb: findExecutable('initdb', [path.dirname(pgCtl)]),
        createdb: findExecutable('createdb', [path.dirname(pgCtl)]),
        dropdb: findExecutable('dropdb', [path.dirname(pgCtl)]),
        psql: findExecutable('psql', [path.dirname(pgCtl)]),
        pgDump: findExecutable('pg_dump', [path.dirname(pgCtl)]),
        pgRestore: findExecutable('pg_restore', [path.dirname(pgCtl)]),
        variant: 'postgres',
        managed: Boolean(managed && path.dirname(pgCtl) === managed.dir),
      }
      return Object.values(binaries).every(value => value !== null && value !== undefined) ? binaries : null
    }
    // Managed builds are real MySQL Community Server binaries (mysqld/mysql/
    // mysqladmin/mysqldump) — MariaDB does not publish official macOS
    // tarballs. Locally-installed MariaDB (mariadbd/mariadb/...) is still
    // detected as a fallback so an existing Homebrew/system install keeps
    // working exactly as before.
    if (managed) {
      const server = findExecutable('mysqld', [managed.dir])
      if (server) {
        const binaries = {
          server,
          install: null,
          client: findExecutable('mysql', [managed.dir]),
          admin: findExecutable('mysqladmin', [managed.dir]),
          dump: findExecutable('mysqldump', [managed.dir]),
          variant: 'mysql',
          managed: true,
          basedir: path.dirname(managed.dir),
        }
        if (binaries.client && binaries.admin && binaries.dump) return binaries
      }
    }
    const server = findExecutable('mariadbd', [...MARIA_DIRS, ...COMMON_PATH])
    if (!server) return null
    const binaries = {
      server,
      install: findExecutable('mariadb-install-db', [path.dirname(server)]),
      client: findExecutable('mariadb', [path.dirname(server)]),
      admin: findExecutable('mariadb-admin', [path.dirname(server)]),
      dump: findExecutable('mariadb-dump', [path.dirname(server)]),
      variant: 'mariadb',
      managed: false,
    }
    return [binaries.install, binaries.client, binaries.admin, binaries.dump].every(Boolean) ? binaries : null
  }

  dataDir(engine) { return path.join(this.root, engine, 'data') }
  logFile(engine) { return path.join(this.root, engine, `${engine}.log`) }

  async status(engine) {
    const bin = this.binaries(engine)
    if (!bin) return { engine, available: false, initialized: false, running: false, port: this.ports[engine], message: `${engine === 'postgres' ? 'PostgreSQL' : 'MariaDB/MySQL'} binaries were not found. Install the managed version from Databases, or install compatible binaries locally.` }
    const dataDir = this.dataDir(engine)
    const initialized = engine === 'postgres' ? fssync.existsSync(path.join(dataDir, 'PG_VERSION')) : fssync.existsSync(path.join(dataDir, 'mysql'))
    let running = false
    if (initialized && engine === 'postgres') running = await execute(bin.pgCtl, ['status', '-D', dataDir]).then(() => true).catch(() => false)
    if (initialized && engine === 'mariadb') {
      running = await execute(bin.admin, ['--protocol=TCP', '--connect-timeout=1', '-h', '127.0.0.1', '-P', String(this.ports[engine]), '-u', 'root', 'ping']).then(() => true).catch(() => false)
    }
    return { engine, available: true, initialized, running, port: this.ports[engine], dataDir, logFile: this.logFile(engine), binaryDir: path.dirname(engine === 'postgres' ? bin.pgCtl : bin.server), variant: bin.variant, managed: Boolean(bin.managed) }
  }

  async list() { return Promise.all(['postgres', 'mariadb'].map(engine => this.status(engine))) }

  async ensureAvailable(engine) {
    if (!['postgres', 'mariadb'].includes(engine)) throw new Error('Unsupported managed database engine.')
    let status = await this.status(engine)
    if (status.available) return status
    if (!this.dbRuntimeManager) throw new Error(status.message)
    this.emit('database', { engine, status: 'Installing managed runtime' })
    await this.dbRuntimeManager.install(engine)
    status = await this.status(engine)
    if (!status.available) throw new Error(`The managed ${engine === 'postgres' ? 'PostgreSQL' : 'MySQL'} runtime finished installing, but its binaries could not be verified.`)
    return status
  }

  async password(engine) {
    let password = await this.keychain.get(`database.${engine}`, 'stacker')
    if (!password) { password = crypto.randomBytes(24).toString('base64url'); await this.keychain.set(`database.${engine}`, 'stacker', password) }
    return password
  }

  async initialize(engine) {
    const status = await this.status(engine)
    if (!status.available) throw new Error(status.message)
    if (status.initialized) return status
    const bin = this.binaries(engine)
    await fs.mkdir(path.dirname(this.dataDir(engine)), { recursive: true })
    const password = await this.password(engine)
    this.emit('database', { engine, status: 'Initializing' })
    if (engine === 'postgres') {
      const passwordFile = path.join(path.dirname(this.dataDir(engine)), '.init-password')
      await fs.writeFile(passwordFile, password, { mode: 0o600 })
      try { await execute(bin.initdb, ['-D', this.dataDir(engine), '--username=stacker', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', `--pwfile=${passwordFile}`]) }
      finally { await fs.rm(passwordFile, { force: true }) }
    } else if (bin.variant === 'mysql') {
      await execute(bin.server, ['--no-defaults', '--initialize-insecure', `--datadir=${this.dataDir(engine)}`, `--basedir=${bin.basedir}`])
    } else {
      await execute(bin.install, [`--datadir=${this.dataDir(engine)}`, '--auth-root-authentication-method=normal', '--skip-test-db'])
    }
    this.emit('database', { engine, status: 'Initialized' })
    return this.status(engine)
  }

  async start(engine) {
    const pending = this.starting.get(engine)
    if (pending) return pending
    const operation = this.startEngine(engine)
    this.starting.set(engine, operation)
    try { return await operation }
    finally { if (this.starting.get(engine) === operation) this.starting.delete(engine) }
  }

  async startEngine(engine) {
    let status = await this.status(engine)
    if (!status.initialized) { await this.initialize(engine); status = await this.status(engine) }
    if (status.running) return status
    const bin = this.binaries(engine)
    this.emit('database', { engine, status: 'Starting' })
    if (engine === 'postgres') {
      await execute(bin.pgCtl, ['start', '-D', this.dataDir(engine), '-l', this.logFile(engine), '-o', `-p ${this.ports[engine]} -h 127.0.0.1`, '-w'])
    } else {
      const serviceRoot = path.dirname(this.dataDir(engine))
      await fs.mkdir(serviceRoot, { recursive: true })
      // macOS limits Unix socket paths to 103 bytes, including long user-data paths.
      let socketRoot = serviceRoot
      if (process.platform !== 'win32' && Buffer.byteLength(path.join(socketRoot, 'mariadb.sock')) > 100) {
        const suffix = crypto.createHash('sha256').update(serviceRoot).digest('hex').slice(0, 20)
        socketRoot = path.join('/tmp', `stacker-db-${suffix}`)
        await fs.mkdir(socketRoot, { recursive: true, mode: 0o700 })
      }
      const args = [`--datadir=${this.dataDir(engine)}`, `--port=${this.ports[engine]}`, '--bind-address=127.0.0.1', ...(process.platform === 'win32' ? [] : [`--socket=${path.join(socketRoot, 'mariadb.sock')}`]), `--pid-file=${path.join(serviceRoot, 'mariadb.pid')}`]
      if (bin.variant === 'mysql') args.unshift('--no-defaults', `--basedir=${bin.basedir}`, '--mysqlx=OFF')
      const output = fssync.openSync(this.logFile(engine), 'a')
      let child
      try { child = spawn(bin.server, args, { detached: false, stdio: ['ignore', output, output] }) }
      finally { fssync.closeSync(output) }
      child.once('exit', () => { if (this.children.get(engine) === child) this.children.delete(engine); this.emit('database', { engine, status: 'Stopped' }) })
      this.children.set(engine, child)
    }
    // A fixed delay made setup report failure on slower launches even though
    // mysqld became ready moments later. Poll the actual admin endpoint and
    // allow initialization/recovery work to complete before deciding.
    const deadline = Date.now() + 15000
    let verified = await this.status(engine)
    while (!verified.running && Date.now() < deadline) {
      const child = this.children.get(engine)
      if (child && child.exitCode !== null) break
      await new Promise(resolve => setTimeout(resolve, 120))
      verified = await this.status(engine)
    }
    if (!verified.running) throw new Error(`${engine === 'postgres' ? 'PostgreSQL' : 'MariaDB/MySQL'} did not start. Review the database service log for details.`)
    this.emit('database', { engine, status: 'Running' })
    return verified
  }

  async stop(engine) {
    const status = await this.status(engine)
    if (!status.running) return status
    const bin = this.binaries(engine)
    if (engine === 'postgres') await execute(bin.pgCtl, ['stop', '-D', this.dataDir(engine), '-m', 'fast', '-w'])
    else {
      const child = this.children.get(engine)
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Database shutdown timed out. Review the service log before retrying.')), 15000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
          child.kill('SIGTERM')
        })
      }
      else await execute(bin.admin, ['--protocol=TCP', '-h', '127.0.0.1', '-P', String(this.ports[engine]), '-u', 'root', 'shutdown']).catch(() => null)
      this.children.delete(engine)
      const started = Date.now()
      while ((await this.status(engine)).running && Date.now() - started < 4000) await new Promise(resolve => setTimeout(resolve, 80))
    }
    this.emit('database', { engine, status: 'Stopped' })
    return this.status(engine)
  }

  async createForProject(engine, project) {
    await this.ensureAvailable(engine)
    await this.start(engine)
    const bin = this.binaries(engine)
    const database = projectDatabaseIdentifier(project)
    const password = await this.password(engine)
    if (engine === 'postgres') {
      await execute(bin.createdb, ['-h', '127.0.0.1', '-p', String(this.ports[engine]), '-U', 'stacker', database], { env: { ...process.env, PGPASSWORD: password } }).catch(error => { if (!/already exists/i.test(error.message)) throw error })
      return { engine: 'PostgreSQL', host: '127.0.0.1', port: this.ports[engine], database, username: 'stacker', password, url: `postgresql://stacker:${password}@127.0.0.1:${this.ports[engine]}/${database}` }
    }
    const user = projectDatabaseIdentifier(project, 28)
    // Retrying setup must not rotate the credential behind an existing MySQL
    // account. Reuse Keychain's value and explicitly synchronize both local
    // account forms so TCP clients cannot be rejected as user@localhost.
    let projectPassword = await this.keychain.get(`project.${project.id}.mariadb`, user)
    if (!projectPassword) projectPassword = crypto.randomBytes(18).toString('base64url')
    const sql = mysqlProjectSql(database, user, projectPassword)
    await execute(bin.client, ['--protocol=TCP', '-h', '127.0.0.1', '-P', String(this.ports[engine]), '-u', 'root', '-e', sql])
    await this.keychain.set(`project.${project.id}.mariadb`, user, projectPassword)
    return { engine: 'MariaDB/MySQL', host: '127.0.0.1', port: this.ports[engine], database, username: user, password: projectPassword, url: `mysql://${user}:${projectPassword}@127.0.0.1:${this.ports[engine]}/${database}` }
  }

  engineForProject(project) {
    if (project.database?.engine === 'PostgreSQL') return 'postgres'
    if (project.database?.engine === 'MariaDB/MySQL') return 'mariadb'
    throw new Error('This project does not have a Stacker-managed service database.')
  }

  async projectConnection(project) {
    const engine = this.engineForProject(project)
    const connection = project.database
    if (connection.credentialSource === 'environment') {
      const configured = await existingDatabaseConnection(project)
      if (!configured) throw new Error('The project database environment is missing. Review Environment and reconnect the database.')
      if (configured.host !== connection.host || configured.database !== connection.database || configured.engine !== connection.engine || configured.port !== connection.port || configured.username !== connection.username) throw new Error('Database environment details changed. Reconnect the existing database to refresh its saved configuration.')
      return { engine, connection, password: configured.password, binaries: this.binaries(engine) }
    }
    const password = engine === 'postgres'
      ? await this.keychain.get('database.postgres', 'stacker')
      : await this.keychain.get(`project.${project.id}.mariadb`, connection.username)
    if (!password) throw new Error('The database credential could not be found in macOS Keychain.')
    return { engine, connection, password, binaries: this.binaries(engine) }
  }

  async dump(project, destination) {
    const { engine, connection, password, binaries } = await this.projectConnection(project)
    if (!binaries) throw new Error('The compatible database tools are no longer available.')
    const status = connection.managed === false ? { running: true } : await this.start(engine)
    if (!status.running) throw new Error('The database service could not be started.')
    const target = path.resolve(destination)
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (engine === 'postgres') {
      await executeToFile(binaries.pgDump, ['-h', connection.host, '-p', String(connection.port), '-U', connection.username, '-Fc', connection.database], target, { env: { ...process.env, PGPASSWORD: password } })
    } else {
      await executeToFile(binaries.dump, ['--protocol=TCP', '-h', connection.host, '-P', String(connection.port), '-u', connection.username, '--single-transaction', connection.database], target, { env: { ...process.env, MYSQL_PWD: password } })
    }
    return { destination: target, size: (await fs.stat(target)).size, engine }
  }

  async restore(project, source, confirmation) {
    if (confirmation !== project.name) throw new Error(`Type “${project.name}” to confirm the restore.`)
    if (this.destructiveOperations.has(project.id)) throw new Error('Another destructive database action is already running for this project.')
    this.destructiveOperations.add(project.id)
    try {
    const { engine, connection, password, binaries } = await this.projectConnection(project)
    if (!binaries) throw new Error('The compatible database tools are no longer available.')
    const sourcePath = path.resolve(source)
    const sourceStat = await fs.stat(sourcePath)
    if (!sourceStat.isFile()) throw new Error('The selected database backup is not a file.')
    if (connection.managed !== false) await this.start(engine)
    const backupDir = path.join(this.root, 'backups', project.id)
    await fs.mkdir(backupDir, { recursive: true })
    const suffix = engine === 'postgres' ? 'dump' : 'sql'
    const safetyCopy = path.join(backupDir, `before-restore-${Date.now()}.${suffix}`)
    await this.dump(project, safetyCopy)
    try {
      if (engine === 'postgres') {
        const environment = { ...process.env, PGPASSWORD: password }
        if (/\.sql$/i.test(sourcePath)) await execute(binaries.psql, ['-h', connection.host, '-p', String(connection.port), '-U', connection.username, '-v', 'ON_ERROR_STOP=1', '-d', connection.database, '-f', sourcePath], { env: environment })
        else await execute(binaries.pgRestore, ['-h', connection.host, '-p', String(connection.port), '-U', connection.username, '--clean', '--if-exists', '--no-owner', '-d', connection.database, sourcePath], { env: environment })
      } else {
        await executeWithInput(binaries.client, ['--protocol=TCP', '-h', connection.host, '-P', String(connection.port), '-u', connection.username, connection.database], sourcePath, { env: { ...process.env, MYSQL_PWD: password } })
      }
    } catch (error) {
      throw new Error(`Restore failed. The current database may be partially changed; its pre-restore backup is at ${safetyCopy}. ${error.message}`)
    }
    return { restored: true, safetyCopy, engine }
    } finally { this.destructiveOperations.delete(project.id) }
  }

  async testConnection(project) {
    const { engine, connection, password, binaries } = await this.projectConnection(project)
    if (!binaries) throw new Error('The compatible database tools are no longer available.')
    if (connection.managed !== false) await this.start(engine)
    const startedAt = Date.now()
    if (engine === 'postgres') await execute(binaries.psql, ['-h', connection.host, '-p', String(connection.port), '-U', connection.username, '-d', connection.database, '-tAc', 'SELECT 1'], { timeout: 10_000, env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: '5' } })
    else await execute(binaries.client, ['--protocol=TCP', '-h', connection.host, '-P', String(connection.port), '-u', connection.username, '--connect-timeout=5', '-Nse', 'SELECT 1', connection.database], { timeout: 10_000, env: { ...process.env, MYSQL_PWD: password } })
    return { connected: true, latencyMs: Date.now() - startedAt, engine }
  }

  async reset(project, confirmation) {
    if (confirmation !== project.name) throw new Error(`Type “${project.name}” to confirm the reset.`)
    if (this.destructiveOperations.has(project.id)) throw new Error('Another destructive database action is already running for this project.')
    this.destructiveOperations.add(project.id)
    try {
    const { engine, connection, password, binaries } = await this.projectConnection(project)
    if (!binaries) throw new Error('The compatible database tools are no longer available.')
    if (connection.managed !== false) await this.start(engine)
    const backupDir = path.join(this.root, 'backups', project.id)
    await fs.mkdir(backupDir, { recursive: true })
    const safetyCopy = path.join(backupDir, `before-reset-${Date.now()}.${engine === 'postgres' ? 'dump' : 'sql'}`)
    await this.dump(project, safetyCopy)
    if (engine === 'postgres') {
      const environment = { ...process.env, PGPASSWORD: password }
      await execute(binaries.dropdb, ['-h', connection.host, '-p', String(connection.port), '-U', connection.username, '--force', '--if-exists', connection.database], { env: environment })
      await execute(binaries.createdb, ['-h', connection.host, '-p', String(connection.port), '-U', connection.username, connection.database], { env: environment })
    } else {
      const database = safeIdentifier(connection.database)
      const user = safeIdentifier(connection.username).slice(0, 28)
      const sql = `DROP DATABASE IF EXISTS \`${database}\`; CREATE DATABASE \`${database}\`; GRANT ALL ON \`${database}\`.* TO '${user}'@'127.0.0.1'; FLUSH PRIVILEGES;`
      await execute(binaries.client, ['--protocol=TCP', '-h', connection.host, '-P', String(connection.port), '-u', 'root', '-e', sql])
    }
    return { reset: true, safetyCopy, engine }
    } finally { this.destructiveOperations.delete(project.id) }
  }

  async shutdown() { await Promise.all(['postgres', 'mariadb'].map(engine => this.stop(engine).catch(() => null))) }
}

module.exports = { projectDatabaseIdentifier, DatabaseServices, safeIdentifier, mysqlProjectSql, findExecutable, executeWithInput, executeToFile }
