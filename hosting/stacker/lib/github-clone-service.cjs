const { spawn } = require('child_process')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

function repositoryDetails(value) {
  const repositoryUrl = String(value || '').trim()
  let pathname = ''
  if (/^git@github\.com:/i.test(repositoryUrl)) pathname = repositoryUrl.replace(/^git@github\.com:/i, '')
  else {
    let parsed
    try { parsed = new URL(repositoryUrl) } catch { throw new Error('Paste a valid GitHub repository URL.') }
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') throw new Error('Use an HTTPS github.com repository URL or a GitHub SSH URL.')
    if (parsed.username || parsed.password) throw new Error('Use a GitHub repository URL without embedded credentials.')
    pathname = parsed.pathname.replace(/^\//, '')
  }
  const segments = pathname.replace(/\/$/, '').split('/').filter(Boolean)
  if (segments.length !== 2) throw new Error('Use a GitHub repository URL in the form github.com/owner/repository.git.')
  const name = segments[1].replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) || name === '.' || name === '..') throw new Error('The repository URL does not contain a safe local folder name.')
  return { repositoryUrl, name }
}

function localDestination(value) {
  const selected = String(value || '').trim()
  if (!selected) throw new Error('Choose a local folder for the cloned repository.')
  const expanded = selected === '~' ? os.homedir() : selected.startsWith('~/') ? path.join(os.homedir(), selected.slice(2)) : selected
  return path.resolve(expanded)
}

function cleanOutput(value) {
  return String(value || '')
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/\r(?=.)/g, '\n')
}

function clonePercent(message) {
  const matches = [...String(message).matchAll(/(?:Receiving objects|Resolving deltas|Updating files):\s+(\d{1,3})%/gi)]
  return matches.length ? Math.min(100, Number(matches.at(-1)[1])) : null
}

class GitHubCloneService {
  constructor(gitExecutable = '/usr/bin/git') {
    this.gitExecutable = gitExecutable
    this.active = null
  }

  run(args, cwd, onOutput) {
    return new Promise((resolve, reject) => {
      const operation = this.active
      const child = spawn(this.gitExecutable, args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' },
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
      operation.child = child
      let recentOutput = ''
      const capture = chunk => {
        const message = cleanOutput(chunk)
        recentOutput = `${recentOutput}${message}`.slice(-4000)
        onOutput?.(message)
      }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        operation.child = null
        if (operation.cancelled) return reject(Object.assign(new Error('Repository cloning was cancelled.'), { code: 'CLONE_CANCELLED' }))
        if (code === 0) return resolve()
        const suffix = recentOutput.trim() ? `\n\n${recentOutput.trim()}` : ''
        reject(new Error(`Git ${signal ? `was stopped by ${signal}` : `exited with code ${code}`}.${suffix}`))
      })
    })
  }

  async clone({ repositoryUrl, destination }, onProgress = () => {}) {
    if (this.active) throw new Error('Another repository clone is already running.')
    const repository = repositoryDetails(repositoryUrl)
    const parent = localDestination(destination)
    const target = path.join(parent, repository.name)
    const operation = { child: null, cancelled: false, createdTarget: false, target }
    this.active = operation
    const progress = (stage, status, detail, percent = null) => onProgress({ stage, status, detail, progress: percent })
    const assertActive = () => {
      if (operation.cancelled) throw Object.assign(new Error('Repository cloning was cancelled.'), { code: 'CLONE_CANCELLED' })
    }
    try {
      const parentStat = await fs.stat(parent).catch(() => null)
      if (!parentStat?.isDirectory()) throw new Error('The selected local folder does not exist.')
      if (await fs.access(target).then(() => true).catch(() => false)) throw new Error(`A folder named ${repository.name} already exists in that location.`)

      progress('checking', 'running', 'Checking repository access…', 0)
      await this.run(['ls-remote', '--exit-code', repository.repositoryUrl, 'HEAD'], parent)
      assertActive()
      progress('checking', 'completed', 'Repository is available.', 100)

      progress('folder', 'running', `Creating ${repository.name}…`, 0)
      await fs.mkdir(target, { mode: 0o700 })
      operation.createdTarget = true
      progress('folder', 'completed', 'Local project folder created.', 100)
      assertActive()

      progress('cloning', 'running', 'Downloading project files…', 0)
      await this.run(['clone', '--progress', '--', repository.repositoryUrl, '.'], target, message => {
        const percent = clonePercent(message)
        progress('cloning', 'running', message.trim().split(/\n/).filter(Boolean).at(-1) || 'Downloading project files…', percent)
      })
      assertActive()
      progress('cloning', 'completed', 'Project files downloaded.', 100)

      progress('preparing', 'running', 'Finishing clone…', 0)
      const gitDirectory = await fs.stat(path.join(target, '.git')).catch(() => null)
      if (!gitDirectory?.isDirectory()) throw new Error('Git finished without creating a valid repository checkout.')
      progress('preparing', 'completed', 'Local project folder is ready for detection.', 100)
      return { localProjectPath: target, repositoryName: repository.name }
    } catch (error) {
      if (operation.createdTarget) await fs.rm(target, { recursive: true, force: true }).catch(() => null)
      throw error
    } finally {
      if (this.active === operation) this.active = null
    }
  }

  cancel() {
    const operation = this.active
    if (!operation) return { cancelled: false }
    operation.cancelled = true
    if (operation.child) {
      try {
        if (process.platform !== 'win32') process.kill(-operation.child.pid, 'SIGTERM')
        else operation.child.kill('SIGTERM')
      } catch { operation.child.kill('SIGTERM') }
    }
    return { cancelled: true, target: operation.target }
  }
}

module.exports = { GitHubCloneService, repositoryDetails, localDestination, clonePercent, cleanOutput }
