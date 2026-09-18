const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { downloadVerified: verifiedDownload, extractArchive } = require('./verified-archive.cjs')

// PostgreSQL comes from Postgres.app's official release DMG — a genuinely
// relocatable, universal2 (x86_64 + arm64 in one file) bundle: every dylib
// dependency uses @loader_path-relative references, verified by copying
// Contents/Versions/17 to an arbitrary path and running initdb/pg_ctl/psql
// against it directly. One download covers both Mac architectures.
const POSTGRES_CATALOG = [
  { version: '17.11', appVersion: '17', product: 'PostgreSQL', file: 'Postgres-2.9.6-17.dmg', url: 'https://github.com/PostgresApp/PostgresApp/releases/download/v2.9.6/Postgres-2.9.6-17.dmg', sha256: 'b38bb00b8c8702a568270aab85995c550f7f93d1503b818efdc5ff9a519b7168', universal: true },
]

// The "mariadb" engine slot is served by real, official MySQL Community
// Server tarballs (MariaDB itself does not publish official macOS binaries —
// only Windows, Linux, and source — so there is no equivalent portable
// upstream artifact to use). MySQL's tarball is also genuinely relocatable
// (@loader_path-relative dylibs, `--basedir` support), verified by copying it
// to an arbitrary path, running `mysqld --initialize-insecure`, starting the
// server, and executing real queries over TCP. Stacker reports the real
// detected product/version (e.g. "MySQL 8.4.11") rather than calling it
// MariaDB, since that would misrepresent what's actually running.
const MARIADB_CATALOG = [
  { version: '8.4.11', product: 'MySQL Community Server', x64: { file: 'mysql-8.4.11-macos15-x86_64.tar.gz', url: 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.11-macos15-x86_64.tar.gz', sha256: '90e8aea10698d01b978f0179e72e8d5e2cbe9f9bd5771e88b0b75d7c82244d3f' }, arm64: { file: 'mysql-8.4.11-macos15-arm64.tar.gz', url: 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.11-macos15-arm64.tar.gz', sha256: 'b96e00493bc3499b9ffd7f08d65c5d64933af0383a8287d9873b64f94c2d6009' } },
]

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false })
    let stderr = ''
    child.stderr?.on('data', chunk => stderr += chunk)
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${executable} exited with ${code}`)))
  })
}

async function validRuntime(binary, version) {
  return new Promise(resolve => execFile(binary, ['--version'], { timeout: 10000, maxBuffer: 1024 * 1024 }, (error,stdout) => resolve(!error && new RegExp(`\\b${version.replace(/\./g, '\\.')}(?:\\b|$)`).test(stdout))))
}
async function publishRuntime(staging, target) {
  const previous = target + '.replacing-' + require('node:crypto').randomUUID()
  const existed = await fs.rename(target, previous).then(() => true).catch(error => error.code === 'ENOENT' ? false : Promise.reject(error))
  try { await fs.rename(staging, target) }
  catch (error) { if (existed) await fs.rename(previous,target); throw error }
  if (existed) await fs.rm(previous,{recursive:true,force:true,maxRetries:3})
}

async function downloadVerified(url, sha256, archive, onProgress) {
  return verifiedDownload({ urls: [url], checksum: sha256, archive, onProgress: (received, total) => onProgress(total ? Math.round(received / total * 100) : null) })
}

class DatabaseRuntimeManager {
  constructor(root, emit = () => {}) {
    this.root = root
    this.emit = emit
    this.windows = process.platform === 'win32' ? new (require('./windows-database-runtime.cjs').WindowsDatabaseRuntime)(root,emit) : null
  }

  get arch() { return process.arch === 'arm64' ? 'arm64' : 'x64' }

  catalog(engine) {
    if (this.windows) return this.windows.catalog(engine)
    const list = engine === 'postgres' ? POSTGRES_CATALOG : MARIADB_CATALOG
    const installedVersions = new Set(this.installedVersions(engine))
    return list.map(entry => ({ engine, version: entry.version, product: entry.product, universal: Boolean(entry.universal), installed: installedVersions.has(entry.version) }))
  }

  installedVersions(engine) {
    if (this.windows) return this.windows.installedVersions(engine)
    try { return fssync.readdirSync(path.join(this.root, engine)).filter(name => !name.includes('.installing') && !name.includes('.replacing')) } catch { return [] }
  }

  binDir(engine) {
    if (this.windows) return this.windows.binDir(engine)
    const versions = this.installedVersions(engine).sort().reverse()
    for (const version of versions) {
      const dir = engine === 'postgres' ? path.join(this.root, engine, version, 'bin') : path.join(this.root, engine, version, this.arch, 'bin')
      const marker = engine === 'postgres' ? 'postgres' : 'mysqld'
      if (fssync.existsSync(path.join(dir, marker))) return { dir, version, variant: engine === 'postgres' ? 'postgres' : 'mysql' }
    }
    return null
  }

  async install(engine, recovery = 0) {
    if (this.windows) return this.windows.install(engine)
    if (process.platform !== 'darwin') throw new Error('Managed database builds are not available for this operating system.')
    const entry = (engine === 'postgres' ? POSTGRES_CATALOG : MARIADB_CATALOG)[0]
    if (!entry) throw new Error(`No managed catalogue entry is available for ${engine}.`)
    try { return await (engine === 'postgres' ? this.installPostgres(entry) : this.installMariadb(entry)) }
    catch (error) { if (recovery >= 2) throw error; await new Promise(resolve => setTimeout(resolve, 500 * 2 ** recovery)); return this.install(engine, recovery + 1) }
  }

  async installPostgres(entry) {
    const target = path.join(this.root, 'postgres', entry.version)
    if (await validRuntime(path.join(target, 'bin', 'postgres'), entry.version)) return { installed: true, version: entry.version, path: target }
    const downloads = path.join(this.root, 'downloads')
    await fs.mkdir(downloads, { recursive: true })
    const archive = path.join(downloads, entry.file)
    const mountPoint = path.join(downloads, `postgres-mount-${Date.now()}`)
    const staging = target + '.installing-' + require('node:crypto').randomUUID()
    try {
      this.emit('database-runtime', { engine: 'postgres', version: entry.version, status: 'Downloading', progress: 0 })
      await downloadVerified(entry.url, entry.sha256, archive, progress => this.emit('database-runtime', { engine: 'postgres', version: entry.version, status: 'Downloading', progress }))
      this.emit('database-runtime', { engine: 'postgres', version: entry.version, status: 'Installing', progress: 100 })
      await fs.mkdir(mountPoint, { recursive: true })
      await run('/usr/bin/hdiutil', ['attach', archive, '-nobrowse', '-mountpoint', mountPoint, '-quiet'])
      try {
        await fs.mkdir(path.dirname(target), { recursive: true })
        await run('/bin/cp', ['-R', path.join(mountPoint, 'Postgres.app', 'Contents', 'Versions', entry.appVersion), staging])
        if (!(await validRuntime(path.join(staging,'bin','postgres'),entry.version))) throw new Error('The installed PostgreSQL runtime did not pass verification.')
        await publishRuntime(staging,target)
      } finally {
        await run('/usr/bin/hdiutil', ['detach', mountPoint, '-quiet']).catch(() => null)
      }
      await fs.rm(archive, { force: true })
      this.emit('database-runtime', { engine: 'postgres', version: entry.version, status: 'Installed', progress: 100 })
      return { installed: true, version: entry.version, path: target }
    } catch (error) {
      await Promise.allSettled([fs.rm(archive, { force: true }), fs.rm(staging, { recursive: true, force: true, maxRetries:3 }), fs.rm(mountPoint, { recursive: true, force: true })])
      this.emit('database-runtime', { engine: 'postgres', version: entry.version, status: 'Failed', progress: null, error: error.message })
      throw error
    }
  }

  async installMariadb(entry) {
    const build = entry[this.arch]
    if (!build) throw new Error(`No managed build is available for this Mac's architecture.`)
    const target = path.join(this.root, 'mariadb', entry.version, this.arch)
    if (await validRuntime(path.join(target, 'bin', 'mysqld'), entry.version)) return { installed: true, version: entry.version, path: target }
    const downloads = path.join(this.root, 'downloads')
    await fs.mkdir(downloads, { recursive: true })
    const archive = path.join(downloads, build.file)
    const staging = path.join(this.root, 'mariadb', `${entry.version}.installing-${Date.now()}`)
    try {
      this.emit('database-runtime', { engine: 'mariadb', version: entry.version, status: 'Downloading', progress: 0 })
      await downloadVerified(build.url, build.sha256, archive, progress => this.emit('database-runtime', { engine: 'mariadb', version: entry.version, status: 'Downloading', progress }))
      this.emit('database-runtime', { engine: 'mariadb', version: entry.version, status: 'Installing', progress: 100 })
      await fs.mkdir(staging, { recursive: true })
      await extractArchive(archive, staging, 1)
      if (!(await validRuntime(path.join(staging,'bin','mysqld'),entry.version))) throw new Error('The installed MySQL runtime did not pass verification.')
      await fs.mkdir(path.dirname(target), { recursive: true })
      await publishRuntime(staging, target)
      await fs.rm(archive, { force: true })
      this.emit('database-runtime', { engine: 'mariadb', version: entry.version, status: 'Installed', progress: 100 })
      return { installed: true, version: entry.version, path: target }
    } catch (error) {
      await Promise.allSettled([fs.rm(archive, { force: true }), fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })])
      this.emit('database-runtime', { engine: 'mariadb', version: entry.version, status: 'Failed', progress: null, error: error.message })
      throw error
    }
  }

  async remove(engine, version, inUse = false) {
    if (inUse) throw new Error('Stop the database service before removing its managed binaries.')
    if (this.windows) return this.windows.remove(engine,version)
    await fs.rm(path.join(this.root, engine, version), { recursive: true, force: true })
    return true
  }
}

module.exports = { validRuntime, publishRuntime, DatabaseRuntimeManager, POSTGRES_CATALOG, MARIADB_CATALOG }
