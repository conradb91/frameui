const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { downloadVerified, extractArchive } = require('./verified-archive.cjs')
const { execFile, execFileSync } = require('child_process')
const { directorySize } = require('./disk-usage.cjs')

const { nodePlatform, executableEnvironment, findExecutable, nodeCommand } = require('./runtime-platform.cjs')
const NODE_DIST = 'https://nodejs.org/dist'

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i += 1) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
  return 0
}

function matchesConstraint(version, constraint) {
  try { return require('semver').satisfies(version, constraint || '*') } catch { return false }
}

async function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false })
    let stderr = ''
    child.stderr.on('data', chunk => stderr += chunk)
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `${executable} exited with ${code}`)))
  })
}

function versionOf(command, args = ['--version']) {
  const env = executableEnvironment()
  return new Promise(resolve => execFile(command, args, { env, timeout: 2500 }, (error, stdout) => resolve(error ? null : stdout.trim().split(/\r?\n/)[0])))
}

function systemExecutable(command) { return findExecutable(command) }

class RuntimeManager {
  constructor(root, emit = () => {}, getDefault = () => null) {
    this.root = root
    this.emit = emit
    this.getDefault = getDefault
    this.dotnet = new (require('./dotnet-manager.cjs').DotnetManager)(root, emit)
    this.catalogCache = null
  }

  get arch() { return process.arch }
  get layout() { return nodePlatform() }
  get nodeRoot() { return process.platform === 'darwin' ? path.join(this.root,'node') : path.join(this.root,'node',process.platform) }

  async catalog() {
    if (this.catalogCache && Date.now() - this.catalogCache.time < 15 * 60 * 1000) return this.catalogCache.items
    const response = await fetch(`${NODE_DIST}/index.json`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`The Node.js runtime catalog returned HTTP ${response.status}.`)
    const releases = await response.json()
    const requiredFile = this.layout.catalogFile
    const items = releases.filter(item => item.lts && item.files.includes(requiredFile)).map(item => ({ type: 'Node.js', version: item.version, lts: item.lts, npm: item.npm, date: item.date, architecture: this.arch, installed: false }))
    const installed = new Set((await this.list()).map(item => item.version))
    items.forEach(item => { item.installed = installed.has(item.version) })
    this.catalogCache = { time: Date.now(), items }
    return items
  }

  async list() {
    const nodeRoot = this.nodeRoot
    const versions = await fs.readdir(nodeRoot, { withFileTypes: true }).catch(() => [])
    const result = []
    for (const entry of versions) {
      if (!entry.isDirectory()) continue
      const binary = path.join(nodeRoot, entry.name, this.arch, this.layout.bin, this.layout.executable)
      const stat = await fs.stat(binary).catch(() => null)
      if (stat) result.push({ type: 'Node.js', version: entry.name, architecture: this.arch, path: path.dirname(binary), installedAt: stat.birthtime.toISOString(), size: await directorySize(path.join(nodeRoot, entry.name, this.arch)) })
    }
    return result.sort((a, b) => compareVersions(a.version, b.version))
  }

  async listAll() {
    const managed = (await this.list()).map(item => ({ ...item, managed: true }))
    const executable = systemExecutable('node')
    const node = executable ? await versionOf(executable) : null
    const external = []
    if (node) external.push({ type: 'Node.js', version: node, architecture: this.arch, managed: false, source: 'Detected from PATH', path: path.dirname(executable), executable })
    return [...managed, ...external]
  }

  async install(version, recovery = 0) {
    if (/^\d+\.\d+\.\d+$/.test(version)) return this.dotnet.install(version)
    const layout = this.layout
    if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Node.js runtime version.')
    const catalog = await this.catalog()
    if (!catalog.some(item => item.version === version)) throw new Error('This Node.js release is not in the trusted runtime catalog.')
    const filename = `node-${version}-${layout.distribution}-${this.arch}.${layout.extension}`
    const target = path.join(this.nodeRoot, version, this.arch)
    if (await versionOf(path.join(target, layout.bin, layout.executable)) === version && await versionOf(path.join(target, layout.bin, layout.executable), ['-p', 'process.platform + ":" + process.arch']) === `${process.platform}:${this.arch}`) return { installed: true, version, path: target }
    await fs.rm(target, { recursive: true, force: true })
    const downloads = path.join(this.root, 'downloads')
    const staging = path.join(this.nodeRoot, `${version}.installing-${require('crypto').randomUUID()}`)
    const archive = path.join(downloads, filename)
    await fs.mkdir(downloads, { recursive: true })
    await fs.mkdir(staging, { recursive: true })
    try {
      this.emit('runtime', { version, runtimeType: 'node', status: 'Preparing', progress: 2 })
      this.emit('runtime', { version, status: 'Downloading', progress: 0 })
      const checksumResponse = await fetch(`${NODE_DIST}/${version}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30000) })
      if (!checksumResponse.ok) throw new Error('The official Node.js checksum manifest could not be retrieved.')
      const checksums = await checksumResponse.text()
      const expected = checksums.split('\n').find(line => line.endsWith(`  ${filename}`))?.split(/\s+/)[0]
      if (!expected) throw new Error('The runtime checksum is missing from the official release manifest.')
      await downloadVerified({ urls: [`${NODE_DIST}/${version}/${filename}`], archive, checksum: expected,
        onProgress: (received, total) => this.emit('runtime', { version, runtimeType: 'node', status: 'Downloading', progress: total ? Math.round(received / total * 68) : null }) })
      this.emit('runtime', { version, runtimeType: 'node', status: 'Extracting', progress: 78 })
      await extractArchive(archive, staging, 1)
      if (await versionOf(path.join(staging, layout.bin, layout.executable), ['-p', 'process.platform + ":" + process.arch']) !== `${process.platform}:${this.arch}`) throw new Error('The Node.js executable has the wrong platform or architecture.')
      // Node's bundled corepack can create real pnpm/yarn shims right in this
      // same bin directory (they're just symlinks to corepack's own scripts),
      // so project-isolated pnpm/Yarn work with zero changes elsewhere —
      // process-manager.cjs already puts this bin dir on PATH for JS projects.
      await run(...nodeCommand('corepack', ['enable', '--install-directory', path.join(staging, layout.bin)], path.join(staging, layout.bin))).catch(() => null)
      if (await versionOf(path.join(staging, layout.bin, layout.executable)) !== version) throw new Error('The extracted Node.js executable did not report the expected version.')
      this.emit('runtime', { version, runtimeType: 'node', status: 'Registering runtime', progress: 90 })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.rename(staging, target)
      this.emit('runtime', { version, runtimeType: 'node', status: 'Testing executable', progress: 96 })
      const testedVersion = await versionOf(path.join(target, layout.bin, layout.executable))
      if (testedVersion !== version) throw new Error(`The installed Node.js executable reported ${testedVersion || 'no version'} instead of ${version}.`)
      this.catalogCache = null
      this.emit('runtime', { version, runtimeType: 'node', status: 'Complete', progress: 100 })
      return { installed: true, version, path: target }
    } catch (error) {
      await Promise.all([fs.rm(archive, { force: true }), fs.rm(staging, { recursive: true, force: true }), fs.rm(target, { recursive: true, force: true })])
      if (recovery < 2) { await new Promise(resolve => setTimeout(resolve, 500 * 2 ** recovery)); return this.install(version, recovery + 1) }
      this.emit('runtime', { version, status: 'Failed', progress: null, error: error.message })
      throw error
    }
  }

  async remove(version, inUse = false) {
    if (inUse) throw new Error('Stop every project using this runtime before removing it.')
    if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid runtime version.')
    await fs.rm(path.join(this.nodeRoot, version), { recursive: true, force: true })
    this.catalogCache = null
    return true
  }

  async executablePath(project) {
    if (project.runtime?.type === '.NET') return this.dotnet.cachedPath(project)
    const installed = await this.list()
    const preferred = project.runtimeSelection || this.getDefault()
    const selected = preferred
      ? installed.find(item => item.version === preferred && matchesConstraint(item.version, project.runtime?.constraint)) || installed.find(item => matchesConstraint(item.version, project.runtime?.constraint))
      : installed.find(item => matchesConstraint(item.version, project.runtime?.constraint))
    if (selected) return selected.path
    const system = (await this.listAll()).find(item => !item.managed && matchesConstraint(item.version, project.runtime?.constraint))
    return system?.path || null
  }

  cachedPath(project) {
    if (project.runtime?.type === '.NET') return this.dotnet.cachedPath(project)
    try {
      const nodeRoot = this.nodeRoot
      const versions = fssync.readdirSync(nodeRoot).sort(compareVersions)
      const preferred = project.runtimeSelection || this.getDefault()
      const selected = preferred
        ? versions.find(version => version === preferred && matchesConstraint(version, project.runtime?.constraint)) || versions.find(version => matchesConstraint(version, project.runtime?.constraint))
        : versions.find(version => matchesConstraint(version, project.runtime?.constraint))
      if (selected) {
        const bin = path.join(nodeRoot, selected, this.arch, this.layout.bin)
        if (fssync.existsSync(path.join(bin, this.layout.executable))) return bin
      }
    } catch {}
    const executable = systemExecutable('node')
    if (!executable) return null
    try {
      const version = execFileSync(executable, ['--version'], { timeout: 2500, encoding: 'utf8' }).trim()
      return matchesConstraint(version, project.runtime?.constraint) ? path.dirname(executable) : null
    } catch { return null }
  }

  async test(version) {
    const runtime = (await this.list()).find(item => item.version === version)
    if (!runtime) throw new Error('Only Stacker-managed Node.js runtimes can be tested here.')
    const executable = path.join(runtime.path, this.layout.executable)
    const reported = await versionOf(executable)
    if (!reported) throw new Error(`Node.js ${version} did not start successfully.`)
    return { ok: true, version: reported, executable }
  }
}

module.exports = { RuntimeManager, compareVersions, matchesConstraint, versionOf, systemExecutable }
