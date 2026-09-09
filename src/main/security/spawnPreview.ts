import { spawn, type ChildProcess } from 'node:child_process'

export type PreviewStatus = 'idle' | 'running' | 'stopped' | 'error'

export interface PreviewProcessEvents {
  onOutput: (line: string, stream: 'stdout' | 'stderr') => void
  onStatus: (status: PreviewStatus, detail?: string) => void
  /** Fires once when a `http://localhost:PORT` (or 127.0.0.1) URL is seen
   * in the process's own output — never guessed or constructed. */
  onUrlDetected: (url: string) => void
}

const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s'")]*/

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

  start(command: string, args: string[], cwd: string, events: PreviewProcessEvents): void {
    if (this.child) {
      events.onStatus('error', 'A preview process is already running.')
      return
    }

    let child: ChildProcess
    try {
      child = spawn(command, args, { cwd, shell: false, env: process.env })
    } catch (err) {
      this.lastStatus = 'error'
      events.onStatus('error', err instanceof Error ? err.message : String(err))
      return
    }
    this.child = child
    this.lastStatus = 'running'
    this.lastUrl = null
    events.onStatus('running')

    let urlAlreadyDetected = false
    const handleChunk = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = data.toString('utf-8')
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue
        events.onOutput(line, stream)
        if (!urlAlreadyDetected) {
          const match = LOCAL_URL_PATTERN.exec(line)
          if (match) {
            urlAlreadyDetected = true
            this.lastUrl = match[0]
            events.onUrlDetected(match[0])
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
  }

  stop(): void {
    if (!this.child) return
    this.child.kill()
    this.child = null
    this.lastStatus = 'stopped'
  }
}
