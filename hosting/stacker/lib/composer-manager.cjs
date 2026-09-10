const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

const INSTALLER_URL = 'https://getcomposer.org/installer'
const SIGNATURE_URL = 'https://composer.github.io/installer.sig'

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 300000, ...spawnOptions } = options
    const child = spawn(executable, args, { shell: false, ...spawnOptions })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Composer installation timed out.')) }, timeoutMs)
    child.once('close', () => clearTimeout(timer))
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => stdout += chunk)
    child.stderr?.on('data', chunk => stderr += chunk)
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `Composer installer exited with ${code}.`)))
  })
}

// Managed Composer follows Composer's own documented secure manual-install
// method: download the small bootstrap installer script, verify its SHA-384
// against the hash Composer publishes at composer.github.io/installer.sig
// (a simple, well-known hex comparison), then execute that trusted installer
// through a real PHP interpreter — it performs its own additional signature
// verification of the composer.phar it downloads. Stacker never re-implements
// phar signature verification itself; it relies on Composer's own code for
// that, exactly as the official installation instructions describe.
class ComposerManager {
  constructor(root, emit = () => {}) {
    this.root = root
    this.emit = emit
  }

  get pharPath() { return path.join(this.root, 'composer.phar') }

  cachedPath() {
    return fssync.existsSync(this.pharPath) ? this.pharPath : null
  }

  async info(phpBinary) {
    const installed = this.cachedPath()
    if (!installed || !phpBinary) return { installed: Boolean(installed), version: null }
    try {
      const output = await run(phpBinary, [installed, '--version'], { timeoutMs: 10000 })
      const version = output.match(/Composer version ([^\s]+)/)?.[1] || null
      return { installed: true, version }
    } catch { return { installed: true, version: null } }
  }

  async install(phpBinary) {
    if (!phpBinary) throw new Error('A PHP interpreter is required to install Composer. Install a managed PHP runtime first.')
    if (this.installing) return this.installing
    this.installing = this.installVerified(phpBinary)
    try { return await this.installing } finally { this.installing = null }
  }

  async installVerified(phpBinary) {
    await fs.mkdir(this.root, { recursive: true })
    let failure
    for (let attempt = 0; attempt < 3; attempt++) {
      const suffix = crypto.randomUUID()
      const installerPath = path.join(this.root, `installer-${suffix}.php`)
      const pendingName = `composer-${suffix}.phar.installing`
      const pending = path.join(this.root, pendingName)
      try {
        this.emit('runtime', { runtimeType: 'composer', status: attempt ? 'Retrying download' : 'Downloading', progress: 0 })
        const [installerResponse, signatureResponse] = await Promise.all([
          fetch(INSTALLER_URL, { signal: AbortSignal.timeout(30000) }),
          fetch(SIGNATURE_URL, { signal: AbortSignal.timeout(30000) }),
        ])
        if (!installerResponse.ok || !signatureResponse.ok) throw new Error('The official Composer installer could not be retrieved.')
        const installerText = await installerResponse.text()
        const expected = (await signatureResponse.text()).trim()
        const actual = crypto.createHash('sha384').update(installerText).digest('hex')
        if (!/^[a-f0-9]{96}$/i.test(expected) || actual !== expected.toLowerCase()) throw new Error('Composer installer checksum verification failed. Composer was not installed.')
        this.emit('runtime', { runtimeType: 'composer', status: 'Verifying download', progress: 55 })
        await fs.writeFile(installerPath, installerText, { mode: 0o600, flag: 'wx' })
        await run(phpBinary, [installerPath, '--install-dir=' + this.root, '--filename=' + pendingName])
        this.emit('runtime', { runtimeType: 'composer', status: 'Testing executable', progress: 90 })
        const output = await run(phpBinary, [pending, '--version'], { timeoutMs: 10000 })
        const version = output.match(/Composer version ([^\s]+)/)?.[1]
        if (!version) throw new Error('Composer was downloaded but its executable test failed.')
        await fs.rename(pending, this.pharPath)
        this.emit('runtime', { runtimeType: 'composer', status: 'Complete', progress: 100, version })
        return { installed: true, version, path: this.pharPath }
      } catch (error) { failure = error }
      finally { await Promise.all([fs.rm(installerPath, { force: true }), fs.rm(pending, { force: true })]) }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
    }
    this.emit('runtime', { runtimeType: 'composer', status: 'Failed', progress: null, error: failure.message })
    throw failure
  }

  async remove() {
    await fs.rm(this.pharPath, { force: true })
    return true
  }
}

module.exports = { ComposerManager }
