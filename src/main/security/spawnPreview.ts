import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type PreviewStatus = 'idle' | 'running' | 'stopped' | 'error'

export interface PreviewProcessEvents {
  onOutput: (line: string, stream: 'stdout' | 'stderr') => void
  onStatus: (status: PreviewStatus, detail?: string) => void
  /** Fires once when a `http://localhost:PORT` (or 127.0.0.1) URL is seen
   * in the process's own output — never guessed or constructed. */
  onUrlDetected: (url: string) => void
}

const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|[a-z0-9.-]+\.localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\])(?::\d+)?[^\s'")]*/i
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')

/** Finder-launched macOS apps inherit a very small PATH and therefore
 * cannot normally find npm/pnpm/yarn/bun/php even though the same command
 * works in the user's terminal. Build a deterministic executable search
 * path from standard tool locations without invoking a shell. */
export function previewSearchPath(cwd: string, environment: NodeJS.ProcessEnv = process.env, home = os.homedir()): string[] {
  const candidates = [
    path.join(cwd, 'node_modules', '.bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'Library', 'pnpm'),
    path.join(home, 'Library', 'Application Support', 'Herd', 'bin'),
    path.join(home, '.config', 'herd-lite', 'bin'),
    '/Applications/XAMPP/xamppfiles/bin',
    '/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    ...(environment.PATH ?? '').split(path.delimiter),
  ]
  const versionRoots = [
    path.join(home, '.nvm', 'versions', 'node'),
    path.join(home, '.asdf', 'installs', 'nodejs'),
    path.join(home, '.asdf', 'installs', 'php'),
    path.join(home, '.local', 'share', 'mise', 'installs', 'node'),
    path.join(home, '.local', 'share', 'mise', 'installs', 'php'),
    path.join(home, '.phpenv', 'versions'),
    '/Applications/MAMP/bin/php',
  ]
  for (const root of versionRoots) {
    try { for (const version of fs.readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) candidates.push(path.join(root, version, 'bin')) } catch { /* optional runtime manager */ }
  }
  const stackerRuntimes = path.join(home, 'Library', 'Application Support', 'stacker', 'Stacker', 'runtimes')
  for (const runtime of ['node', 'php']) {
    const runtimeRoot = path.join(stackerRuntimes, runtime)
    try {
      for (const version of fs.readdirSync(runtimeRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
        const versionRoot = path.join(runtimeRoot, version)
        const preferredArchitecture = process.arch === 'arm64' ? 'arm64' : 'x64'
        const architectures = fs.readdirSync(versionRoot).sort((a, b) => Number(b === preferredArchitecture) - Number(a === preferredArchitecture))
        for (const architecture of architectures) candidates.push(path.join(versionRoot, architecture, 'bin'))
      }
    } catch { /* optional bundled runtime */ }
  }
  return [...new Set(candidates.filter(Boolean))]
}

export function resolvePreviewExecutable(command: string, cwd: string, environment: NodeJS.ProcessEnv = process.env): { executable: string; env: NodeJS.ProcessEnv } | null {
  const searchPath = previewSearchPath(cwd, environment)
  const env = { ...environment, PATH: searchPath.join(path.delimiter) }
  const direct = path.isAbsolute(command) ? command : command.includes(path.sep) ? path.resolve(cwd, command) : null
  if (direct) {
    try { fs.accessSync(direct, fs.constants.X_OK); return { executable: direct, env } } catch { return null }
  }
  for (const directory of searchPath) {
    const candidate = path.join(directory, command)
    try { fs.accessSync(candidate, fs.constants.X_OK); return { executable: candidate, env } } catch { /* try next PATH entry */ }
  }
  return null
}

function optionValue(args: string[], name: string, fallback: string): string {
  const exact = args.indexOf(name)
  if (exact >= 0 && args[exact + 1]) return args[exact + 1]
  const assigned = args.find((arg) => arg.startsWith(`${name}=`))
  return assigned ? assigned.slice(name.length + 1) : fallback
}

function isCodeIgniterServe(command: string, args: string[]): boolean {
  const executable = path.basename(command).toLowerCase()
  return (executable === 'php' || executable.startsWith('php')) && args[0] === 'spark' && args[1] === 'serve'
}

function localCodeIgniterBaseUrl(cwd: string): URL | null {
  let content: string
  try { content = fs.readFileSync(path.join(cwd, '.env'), 'utf-8') } catch { return null }
  const match = content.match(/^\s*app\.baseURL\s*=\s*([^\r\n#]+)/m)
  if (!match) return null
  const raw = match[1].trim().replace(/^(['"])(.*)\1$/, '$2')
  try {
    const url = new URL(raw)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname.endsWith('.localhost')
    return local && url.protocol === 'http:' && !!url.port ? url : null
  } catch { return null }
}

/** Align Spark with an explicit local app.baseURL even when the persisted
 * project index predates this behavior. This also keeps CI-generated auth
 * redirects on the same origin as the embedded preview. */
export function codeIgniterServeArgs(command: string, args: string[], cwd: string): string[] {
  if (!isCodeIgniterServe(command, args)) return args
  const configured = localCodeIgniterBaseUrl(cwd)
  if (!configured) return args
  const cleaned: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--host' || arg === '--port') { index++; continue }
    if (arg.startsWith('--host=') || arg.startsWith('--port=')) continue
    cleaned.push(arg)
  }
  return [...cleaned, '--host', configured.hostname, '--port', configured.port]
}

/**
 * CI4 reads `app.baseURL` from the project .env and uses it for absolute
 * redirects. A custom local domain or production URL would otherwise send
 * the embedded browser away from the Spark process FrameUI just started.
 * Override only the child process, using the exact host/port Spark will
 * bind to; no repository file or application auth rule is changed.
 */
export function previewEnvironment(command: string, args: string[], environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!isCodeIgniterServe(command, args)) return environment
  const requestedHost = optionValue(args, '--host', 'localhost')
  const host = requestedHost === '0.0.0.0' || requestedHost === '::' || requestedHost === '[::]' ? 'localhost' : requestedHost
  const port = optionValue(args, '--port', '8080')
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return { ...environment, 'app.baseURL': `http://${urlHost}:${port}/` }
}

/**
 * Spawns the ONE approved local preview command for the active project.
 * `command`/`args` come pre-split from the indexer's detected devCommand —
 * never a shell string, never eval'd (spec §23/27.2: `spawn(cmd, argvArray,
 * {shell:false})`, and only after the user explicitly starts it here).
 */
export class PreviewProcess {
  private child: ChildProcess | null = null
  private lastStatus: PreviewStatus = 'idle'
  private lastUrl: string | null = null

  get isRunning(): boolean {
    return this.child !== null
  }

  /** Lets a late subscriber (e.g. Capture Session opened after Preview was
   * already started elsewhere) learn current state without waiting for a
   * push event that already fired before it was listening. */
  getSnapshot(): { status: PreviewStatus; url: string | null } {
    return { status: this.lastStatus, url: this.lastUrl }
  }

  start(command: string, args: string[], cwd: string, events: PreviewProcessEvents): { ok: true } | { ok: false; message: string } {
    if (this.child) {
      return { ok: false, message: 'A preview process is already running.' }
    }

    const resolved = resolvePreviewExecutable(command, cwd)
    if (!resolved) {
      const message = `Could not find “${command}”. Install it or edit the Run App command in Application.`
      this.lastStatus = 'error'
      events.onStatus('error', message)
      return { ok: false, message }
    }

    let child: ChildProcess
    try {
      const launchArgs = codeIgniterServeArgs(command, args, cwd)
      child = spawn(resolved.executable, launchArgs, { cwd, shell: false, env: previewEnvironment(command, launchArgs, resolved.env) })
    } catch (err) {
      this.lastStatus = 'error'
      const message = err instanceof Error ? err.message : String(err)
      events.onStatus('error', message)
      return { ok: false, message }
    }
    this.child = child
    this.lastStatus = 'running'
    this.lastUrl = null
    events.onStatus('running')

    let urlAlreadyDetected = false
    const handleChunk = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = data.toString('utf-8').replace(ANSI_PATTERN, '')
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue
        events.onOutput(line, stream)
        if (!urlAlreadyDetected) {
          const match = LOCAL_URL_PATTERN.exec(line)
          if (match) {
            urlAlreadyDetected = true
            const detectedUrl = match[0].replace('://0.0.0.0', '://localhost').replace('://[::]', '://localhost')
            this.lastUrl = detectedUrl
            events.onUrlDetected(detectedUrl)
          }
        }
      }
    }

    child.stdout?.on('data', handleChunk('stdout'))
    child.stderr?.on('data', handleChunk('stderr'))

    child.on('exit', (code) => {
      this.child = null
      this.lastStatus = code === 0 || code === null ? 'stopped' : 'error'
      events.onStatus(this.lastStatus, code !== null ? `exit code ${code}` : undefined)
    })
    child.on('error', (err) => {
      this.child = null
      this.lastStatus = 'error'
      events.onStatus('error', err.message)
    })
    return { ok: true }
  }

  stop(): void {
    if (!this.child) return
    this.child.kill()
    this.child = null
    this.lastStatus = 'stopped'
  }
}

/** One project runtime per FrameUI process. Shared by preview controls and
 * project close/removal so no orphan dev server survives its project. */
export const previewProcess = new PreviewProcess()
