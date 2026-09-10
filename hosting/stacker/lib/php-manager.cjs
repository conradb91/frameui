const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')
const { downloadVerified, extractArchive } = require('./verified-archive.cjs')
const { directorySize } = require('./disk-usage.cjs')
const { versionOf, systemExecutable } = require('./runtime-manager.cjs')

const DIST_BASE = 'https://dl.static-php.dev/static-php-cli/bulk'

// Curated managed-PHP catalog. Each build is a real, statically-linked PHP
// CLI binary from crazywhalecc/static-php-cli's public "bulk" distribution
// (MIT-licensed build tooling; PHP itself is PHP-licensed and free to
// redistribute). Every sha256 below was computed by Stacker's authors from a
// direct download of the listed file. The bulk host does not publish its own
// signed checksum manifest the way nodejs.org does, so — unlike the Node.js
// catalog — this only protects against corruption/tampering in transit, not
// independently verified upstream provenance.
// The 8.3 entry is pinned to patch 8.3.20 rather than the newer 8.3.32: the
// 8.3.32 bulk build's bundled curl/ngtcp2 (HTTP/3) stack crashes with
// "ngtcp2_settings.c:96 ngtcp2_settingslen_version: Unreachable" on an
// ordinary HTTPS GET (verified by actually running `composer create-project`
// against it — it aborted before writing a single file). The 8.4.22 and
// 8.4.23 builds were subsequently found to have the same crash and were
// removed from the trusted catalog. PHP 8.4.20 is the newest 8.4 build that
// completed `composer create-project laravel/laravel` and SQLite
// `artisan migrate`. A full
// `composer create-project laravel/laravel` plus its post-install
// `artisan migrate` against a real SQLite database was run end-to-end
// against 8.3.20 and completed successfully.
// Extensions bundled: apcu,
// bcmath, bz2, calendar, ctype, curl, dba, dom, event, exif, fileinfo,
// filter, ftp, gd, gmp, iconv, imagick, imap, intl, mbstring, mbregex,
// mysqli, mysqlnd, opcache, pcntl, pdo, pdo_mysql, pgsql, phar, posix,
// readline, redis, session, shmop, simplexml, soap, sockets, sodium,
// sqlite3, swoole, sysvmsg/sem/shm, tokenizer, xml/xmlreader/xmlwriter/xsl,
// zip, zlib. `pdo_sqlite` and `pdo_pgsql` are NOT in this list — but they
// work anyway: this build compiles them directly into PDO's driver registry
// without registering them as separately-loaded extensions, so
// PDO::getAvailableDrivers() reports mysql/pgsql/sqlite even though
// get_loaded_extensions() does not list pdo_mysql's siblings by name. Verify
// actual availability with PDO::getAvailableDrivers(), not get_loaded_extensions()/`php -m`.
const CATALOG = [
  { version: '8.1.34', x64: { file: 'php-8.1.34-cli-macos-x86_64.tar.gz', sha256: '5fe69256365f96a270e34208ec574be7012c8c08a23bdf52948d0d16d4d8ec6a' }, arm64: { file: 'php-8.1.34-cli-macos-aarch64.tar.gz', sha256: 'b721271659d6e3448c29c0dc5755ffc4b8a1498c4709e1aba6602cfb584a84e4' } },
  { version: '8.2.32', x64: { file: 'php-8.2.32-cli-macos-x86_64.tar.gz', sha256: '6af04840b043391716ec15020d14147bae4aadcdf3608e8ddbfcf46558f82257' }, arm64: { file: 'php-8.2.32-cli-macos-aarch64.tar.gz', sha256: '3c1c359fe943aaaeb1168933b8e4b1597120c106d33bd66395fac403b6ab3ace' } },
  { version: '8.3.20', x64: { file: 'php-8.3.20-cli-macos-x86_64.tar.gz', sha256: '6628a1f4935421da270869e985614ae53bc9170943ceea52db7d1158d440508a' }, arm64: { file: 'php-8.3.20-cli-macos-aarch64.tar.gz', sha256: 'a3961e48a0a81e7c5c5e2229658d7b238e3ead604a86d439e9778d9e222cbb52' } },
  { version: '8.4.20', x64: { file: 'php-8.4.20-cli-macos-x86_64.tar.gz', sha256: 'f62d27a649fbedda292bb0e1c63213fa10ef598775f5a2eb9c8b25583be1a43c' }, arm64: { file: 'php-8.4.20-cli-macos-aarch64.tar.gz', sha256: '824c917c31675b2fb44df4b7be349c92313b1de6cffee3887a0df4c6080b394a' } },
]

const KNOWN_BROKEN_VERSIONS = new Set(['8.4.22', '8.4.23'])

const BUNDLED_EXTENSIONS = ['apcu', 'bcmath', 'bz2', 'calendar', 'ctype', 'curl', 'dba', 'dom', 'event', 'exif', 'fileinfo', 'filter', 'ftp', 'gd', 'gmp', 'iconv', 'imagick', 'imap', 'intl', 'mbstring', 'mbregex', 'mysqli', 'mysqlnd', 'opcache', 'pcntl', 'pdo', 'pdo_mysql', 'pdo_pgsql', 'pdo_sqlite', 'pgsql', 'phar', 'posix', 'readline', 'redis', 'session', 'shmop', 'simplexml', 'soap', 'sockets', 'sodium', 'sqlite3', 'tokenizer', 'xml', 'xmlreader', 'xmlwriter', 'xsl', 'zip', 'zlib']
// Historically this listed pdo_sqlite/pdo_pgsql as unavailable based on the
// build's documented extension recipe. A real end-to-end test (Laravel
// create-project + artisan migrate against SQLite) proved they work — see
// the CATALOG comment above. Kept as an empty, extensible list rather than
// removed outright in case a future catalog entry has a genuine gap.
const KNOWN_MISSING_EXTENSIONS = []

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
  return 0
}

function matchesPhpConstraint(version, constraint) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false
  if (!constraint) return true
  const actual = version.split('.').map(Number)
  const compare = (left, right) => { for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]; return 0 }
  const parse = value => value.replace(/^v/, '').split('.').map(Number)
  const padded = value => { const parts = parse(value); return [parts[0], parts[1] || 0, parts[2] || 0] }
  function matchesToken(token) {
    const match = token.match(/^(>=|<=|!=|==|>|<|=|\^|~)?(v?\d+(?:\.(?:\d+|[xX*])){0,2}|[xX*])$/)
    if (!match) return false
    const [, operator = '=', value] = match
    if (/^[xX*]$/.test(value)) return operator === '=' || operator === '=='
    if (/[xX*]/.test(value)) {
      if (!['=', '==', '!='].includes(operator)) return false
      const parts = value.replace(/^v/, '').split('.')
      const wildcard = parts.findIndex(part => /^[xX*]$/.test(part))
      if (parts.slice(wildcard).some(part => !/^[xX*]$/.test(part))) return false
      const matches = parts.slice(0, wildcard).every((part, index) => Number(part) === actual[index])
      return operator === '!=' ? !matches : matches
    }
    const required = padded(value), relation = compare(actual, required)
    if (operator === '>=') return relation >= 0
    if (operator === '<=') return relation <= 0
    if (operator === '>') return relation > 0
    if (operator === '<') return relation < 0
    if (operator === '!=') return relation !== 0
    if (operator === '^' || operator === '~') {
      const upper = [...required]
      const index = operator === '~' ? (parse(value).length >= 3 ? 1 : 0) : (required.findIndex(part => part !== 0) < 0 ? 2 : required.findIndex(part => part !== 0))
      upper[index]++; for (let i = index + 1; i < 3; i++) upper[i] = 0
      return relation >= 0 && compare(actual, upper) < 0
    }
    return relation === 0
  }
  return String(constraint).split(/\|\|?/).some(branch => {
    const normalized = branch.trim().replace(/@(dev|alpha|beta|RC|stable)\b/gi, '').replace(/(>=|<=|!=|==|>|<|=|\^|~)\s+/g, '$1')
    const range = normalized.match(/^(v?\d+(?:\.\d+){0,2})\s+-\s+(v?\d+(?:\.\d+){0,2})$/)
    if (range) {
      const upper = padded(range[2]), count = parse(range[2]).length
      if (count < 3) { upper[count - 1]++; for (let i = count; i < 3; i++) upper[i] = 0 }
      return compare(actual, padded(range[1])) >= 0 && (count < 3 ? compare(actual, upper) < 0 : compare(actual, upper) <= 0)
    }
    const tokens = normalized.split(/[\s,]+/).filter(Boolean)
    return tokens.length > 0 && tokens.every(matchesToken)
  })
}

function versionAtLeast(version, minimum) {
  if (!minimum) return true
  const left = String(version).split('.').map(Number)
  const right = String(minimum).split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0)
  }
  return true
}

function compatiblePhpRuntime(version, project) {
  return matchesPhpConstraint(version, project?.runtime?.constraint) && versionAtLeast(version, project?.runtime?.installedMinimum)
}

async function verifyPhpExecutable(binary, version, architecture) {
      const { execFile } = require('node:child_process')
      const description = await new Promise((resolve, reject) => execFile('/usr/bin/file', [binary], (error, stdout) => error ? reject(error) : resolve(stdout)))
      if (!description.includes('Mach-O') || !description.includes(architecture === 'arm64' ? 'arm64' : 'x86_64')) throw new Error('The PHP executable has the wrong operating system or architecture.')
      const reported = await versionOf(binary, ['-r', 'echo PHP_VERSION;'])
      if (reported !== version) throw new Error('The PHP executable did not report the expected version.')
    }

class PhpManager {
  constructor(root, emit = () => {}, getDefault = () => null) {
    this.root = root
    this.emit = emit
    this.getDefault = getDefault
    this.windows = new (require('./windows-php.cjs').WindowsPhpManager)(root,emit,compatiblePhpRuntime)
  }

  get arch() { return process.arch === 'arm64' ? 'arm64' : 'x64' }

  async catalog() {
    if (process.platform === 'win32') return this.windows.catalog()
    const installed = new Set((await this.list()).map(item => item.version))
    return CATALOG.map(entry => ({ type: 'PHP', version: entry.version, architecture: this.arch, extensions: BUNDLED_EXTENSIONS, missingExtensions: KNOWN_MISSING_EXTENSIONS, installed: installed.has(entry.version) }))
  }

  async list() {
    if (process.platform === 'win32') return this.windows.list()
    const phpRoot = path.join(this.root, 'php')
    const versions = await fs.readdir(phpRoot, { withFileTypes: true }).catch(() => [])
    const result = []
    for (const entry of versions) {
      if (!entry.isDirectory()) continue
      const binary = path.join(phpRoot, entry.name, this.arch, 'bin', 'php')
      const stat = await fs.stat(binary).catch(() => null)
      if (stat) result.push({ type: 'PHP', version: entry.name, architecture: this.arch, path: path.dirname(binary), installedAt: stat.birthtime.toISOString(), size: await directorySize(path.join(phpRoot, entry.name, this.arch)), broken: KNOWN_BROKEN_VERSIONS.has(entry.name) })
    }
    return result.sort((a, b) => compareVersions(a.version, b.version))
  }

  async listAll() {
    const managed = (await this.list()).map(item => ({ ...item, managed: true }))
    const phpExecutable = systemExecutable('php')
    const composerExecutable = systemExecutable('composer')
    const [php, composer] = await Promise.all([phpExecutable ? versionOf(phpExecutable, ['-r', 'echo PHP_VERSION;']) : null, composerExecutable ? versionOf(composerExecutable) : null])
    const external = []
    if (php) external.push({ type: 'PHP', version: php, architecture: this.arch, managed: false, source: 'Detected from PATH', path: path.dirname(phpExecutable), executable: phpExecutable })
    if (composer) external.push({ type: 'Composer', version: composer.replace(/^Composer version\s+/i, '').split(' ')[0], architecture: this.arch, managed: false, source: 'Detected from PATH', path: path.dirname(composerExecutable), executable: composerExecutable })
    return [...managed, ...external]
  }

  async install(version) {
    if (process.platform === 'win32') return this.windows.install(version)
    if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('No approved PHP build is available for this operating system and architecture.')
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid PHP runtime version.')
    const entry = CATALOG.find(item => item.version === version)
    if (!entry) throw new Error('This PHP release is not in the trusted runtime catalog.')
    const build = entry[this.arch]
    const target = path.join(this.root, 'php', version, this.arch)
    const testBinary = binary => verifyPhpExecutable(binary, version, this.arch)
    try { await testBinary(path.join(target, 'bin', 'php')); return { installed: true, version, path: target } } catch { await fs.rm(target, { recursive: true, force: true }) }
    const archive = path.join(this.root, 'downloads', process.platform, this.arch, build.file)
    let failure
    for (let attempt = 0; attempt < 3; attempt++) {
      const staging = `${target}.installing-${require('crypto').randomUUID()}`
      try {
        this.emit('runtime', { version, runtimeType: 'php', status: 'Downloading', progress: 0 })
        await downloadVerified({ urls: [`${DIST_BASE}/${build.file}`, `https://static-php-cli.fra1.digitaloceanspaces.com/static-php-cli/bulk/${build.file}`], archive, checksum: build.sha256,
          onProgress: (received, total) => this.emit('runtime', { version, runtimeType: 'php', status: 'Downloading', progress: total ? Math.min(68, Math.round(received / total * 68)) : null }) })
        this.emit('runtime', { version, runtimeType: 'php', status: 'Extracting', progress: 78 })
        await extractArchive(archive, path.join(staging, 'bin'))
        const binary = path.join(staging, 'bin', 'php')
        await fs.chmod(binary, 0o755)
        await testBinary(binary)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.rename(staging, target)
        this.emit('runtime', { version, runtimeType: 'php', status: 'Complete', progress: 100 })
        return { installed: true, version, path: target }
      } catch (error) {
        failure = error
        await Promise.all([fs.rm(archive, { force: true }), fs.rm(staging, { recursive: true, force: true })])
        if (attempt < 2) {
          this.emit('runtime', { version, runtimeType: 'php', status: 'Retrying download', progress: 0, detail: error.message })
          await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
        }
      }
    }
    this.emit('runtime', { version, runtimeType: 'php', status: 'Failed', progress: null, error: failure.message })
    throw failure
  }

  async remove(version, inUse = false) {
    if (inUse) throw new Error('Stop every project using this PHP runtime before removing it.')
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid PHP runtime version.')
    await fs.rm(path.join(this.root, 'php', ...(process.platform === 'win32' ? ['win32'] : []), version), { recursive: true, force: true })
    return true
  }

  async executablePath(project) {
    const installed = await this.list()
    // The pinned 8.4 build is unsafe for Composer network downloads, but its
    // PHP CLI is valid for already-installed applications and is required by
    // projects whose lockfile platform check requires PHP 8.4.
    const usable = installed.filter(item => !item.broken || project.dependenciesInstalled)
    const preferred = project.runtimeSelection || this.getDefault()
    const selected = preferred
      ? usable.find(item => item.version === preferred && compatiblePhpRuntime(item.version, project)) || usable.find(item => compatiblePhpRuntime(item.version, project))
      : usable.find(item => compatiblePhpRuntime(item.version, project))
    if (selected) return selected.path
    const system = (await this.listAll()).find(item => item.type === 'PHP' && !item.managed && compatiblePhpRuntime(item.version, project))
    return system?.path || null
  }

  cachedPath(project) {
    if (process.platform === 'win32') { const managed = this.windows.cachedPath(project); if (managed) return managed }
    try {
      const phpRoot = path.join(this.root, 'php')
      const versions = fssync.readdirSync(phpRoot).filter(version => !KNOWN_BROKEN_VERSIONS.has(version) || project.dependenciesInstalled).sort(compareVersions)
      const preferred = project.runtimeSelection || this.getDefault()
      const selected = preferred
        ? versions.find(version => version === preferred && compatiblePhpRuntime(version, project)) || versions.find(version => compatiblePhpRuntime(version, project))
        : versions.find(version => compatiblePhpRuntime(version, project))
      if (selected) {
        const bin = path.join(phpRoot, selected, this.arch, 'bin')
        if (fssync.existsSync(path.join(bin, 'php'))) return bin
      }
    } catch {}
    const executable = systemExecutable('php')
    if (!executable) return null
    try {
      const version = require('child_process').execFileSync(executable, ['-r', 'echo PHP_VERSION;'], { timeout: 2500, encoding: 'utf8' }).trim()
      return compatiblePhpRuntime(version, project) ? path.dirname(executable) : null
    } catch { return null }
  }

  async test(version) {
    const runtime = (await this.list()).find(item => item.version === version)
    if (!runtime) throw new Error('Only Stacker-managed PHP runtimes can be tested here.')
    const executable = path.join(runtime.path, process.platform === 'win32' ? 'php.exe' : 'php')
    const reported = await versionOf(executable, ['-r', 'echo PHP_VERSION;'])
    if (!reported) throw new Error(`PHP ${version} did not start successfully.`)
    return { ok: true, version: reported, executable }
  }

  async extensionsFor(project) {
    const bin = this.cachedPath(project)
    if (!bin) return null
    const executable = path.join(bin,process.platform === 'win32' ? 'php.exe' : 'php')
    const extensions = await new Promise((resolve,reject)=>require('node:child_process').execFile(executable,['-r','echo json_encode(get_loaded_extensions());'],{timeout:10000},(error,stdout)=>{if(error)return reject(error);try{resolve(JSON.parse(stdout).map(name=>name.toLowerCase()))}catch(error){reject(error)}}))
    const missing = (project.runtime?.requiredExtensions || []).filter(name => !extensions.includes(name.toLowerCase()))
    return { managed: path.resolve(bin).startsWith(path.resolve(this.root)+path.sep), extensions, missing }
  }
}

module.exports = { PhpManager, verifyPhpExecutable, compareVersions, matchesPhpConstraint, versionAtLeast, compatiblePhpRuntime, BUNDLED_EXTENSIONS, KNOWN_MISSING_EXTENSIONS, KNOWN_BROKEN_VERSIONS, CATALOG }
