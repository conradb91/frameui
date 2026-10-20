import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import { redactSecrets } from './repoAccess'

// Run Anthropic's installed, unmodified executable. Never read OAuth credentials.
export function findClaudeCode(env = process.env): string | null {
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const dirs = [...(env.PATH ?? '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue
    const candidate = path.join(dir, name)
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate } catch { /* Try the next installation. */ }
  }
  return null
}

type CliEvent = Record<string, any>
export function cliErrorDetail(text: string): string {
  // ANSI escape removal is intentional: terminal output may include colour codes.
  // eslint-disable-next-line no-control-regex
  return redactSecrets(text.replace(/\x1b\[[0-9;]*m/g, ''))
    .replace(/https?:\/\/[^\s<>"']+/g, '[link omitted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email omitted]')
    .replace(/((?:token|code|state|session|cookie)[\w-]*\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .trim().slice(0, 1400)
}
export function runClaudeCode(executable: string, args: string[], options: { cwd?: string; input?: string; signal?: AbortSignal; timeout?: number; onEvent?: (event: CliEvent) => void; finishOnEvent?: (event: CliEvent) => boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Claude task cancelled.')); return }
    const child = spawn(executable, args, { cwd: options.cwd ?? os.tmpdir(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', pending = '', stderr = '', failure = '', completed = false, killTimer: ReturnType<typeof setTimeout> | undefined
    const terminate = () => { child.kill(); killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1500) }
    const stop = (message: string) => { if (failure) return; failure = message; terminate() }
    const abort = () => stop('Claude task cancelled.')
    const timer = setTimeout(() => stop('Claude Code timed out. Complete sign-in in your browser or try again.'), options.timeout ?? 20_000)
    options.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort) }
    const consume = (line: string) => {
      if (!line.trim() || completed || failure) return
      try {
        const event = JSON.parse(line)
        options.onEvent?.(event)
        if (options.finishOnEvent?.(event)) { completed = true; terminate() }
      } catch { stop('Claude Code returned an invalid stream response. Update Claude Code and retry.') }
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      if (output.length > 12_000_000) { stop('Claude Code response exceeded the safe size limit.'); return }
      if (options.onEvent || options.finishOnEvent) {
        pending += chunk.toString()
        let boundary: number
        while ((boundary = pending.indexOf('\n')) !== -1) { const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1); consume(line) }
      }
    })
    // Auth output is never shown. Task failures expose only a bounded, redacted diagnostic.
    child.stderr.on('data', chunk => { if (args.includes('-p')) stderr = (stderr + chunk.toString()).slice(-8000) })
    child.stdin.on('error', () => {})
    child.on('error', () => { cleanup(); reject(new Error('Could not start Claude Code. Install the official Claude Code CLI and retry.')) })
    child.on('close', code => {
      if (pending && (options.onEvent || options.finishOnEvent)) consume(pending)
      cleanup()
      if (failure) reject(new Error(failure))
      else if (code !== 0 && !completed) reject(new Error('Claude Code could not complete the request.' + (cliErrorDetail(stderr) ? '\n' + cliErrorDetail(stderr) : ' Check your Claude Code sign-in and usage limits.')))
      else resolve(output.trim())
    })
    if (options.finishOnEvent) child.stdin.write(options.input ?? '')
    else child.stdin.end(options.input ?? '')
  })
}

const streamArgs = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--setting-sources', '', '--settings', JSON.stringify({ disableAllHooks: true }), '--disable-slash-commands', '--no-chrome', '--no-session-persistence']
export async function claudeCodeModels(executable: string): Promise<import('@shared/types/ai').ClaudeStatus['models']> {
  let models:import('@shared/types/ai').ClaudeStatus['models'] = []
  await runClaudeCode(executable, [...streamArgs, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], {
    input: JSON.stringify({ type:'control_request', request_id:'frameui-models', request:{ subtype:'initialize' } }) + '\n',
    finishOnEvent: event => {
      if (event.type !== 'control_response' || event.response?.request_id !== 'frameui-models') return false
      const available = event.response?.response?.models
      if (Array.isArray(available)) models = available.filter(m=>typeof m.value === 'string' && typeof m.displayName === 'string').map(m=>({id:m.value, name:m.value==='default' ? `Default · ${m.description?.split(' · ')[0] ?? 'Claude Code'}` : m.displayName, description:typeof m.description==='string'?m.description:undefined,effortLevels:Array.isArray(m.supportedEffortLevels)?m.supportedEffortLevels.filter((v:unknown)=>['low','medium','high','xhigh','max'].includes(String(v))):[]}))
      return true
    },
  })
  if (!models.length) throw new Error('Claude Code did not return its model list. Update Claude Code and retry.')
  return models
}

export async function claudeCodeAuthenticated(executable: string): Promise<boolean> {
  try { const status = JSON.parse(await runClaudeCode(executable, ['auth', 'status'])); return status.loggedIn === true } catch { return false }
}

export interface BridgeTool { name: string; description: string; input_schema: unknown }
export async function startDesignBridge(tools: BridgeTool[], execute: (name: string, input: unknown) => Promise<unknown>, signal: AbortSignal) {
  const secret = randomBytes(32).toString('hex')
  let queue = Promise.resolve()
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${secret}` || req.headers.origin || req.url !== '/mcp') { res.writeHead(403).end(); return }
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    let raw = ''
    try {
      for await (const chunk of req) { raw += chunk.toString(); if (raw.length > 1_000_000) { res.writeHead(413).end(); return } }
      const message = JSON.parse(raw)
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') { res.writeHead(400).end(); return }
      if (message.id === undefined) { res.writeHead(202).end(); return }
      let result: unknown
      if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'frameui', version: '1.0.0' } }
      else if (message.method === 'ping') result = {}
      else if (message.method === 'tools/list') result = { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) }
      else if (message.method === 'tools/call') {
        // Serialize calls because the design document is mutable.
        const task = queue.then(async () => {
          signal.throwIfAborted()
          if (!tools.some(t => t.name === message.params?.name)) return { isError: true, content: [{ type: 'text', text: 'Unknown FrameUI tool.' }] }
          return execute(message.params.name, message.params.arguments ?? {})
        })
        queue = task.then(() => {}, () => {})
        result = await task
      } else { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })); return }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    } catch { if (!res.headersSent) res.writeHead(400); res.end() }
  })
  server.requestTimeout = 120_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
  const address = server.address() as import('node:net').AddressInfo
  return {
    config: { mcpServers: { frameui: { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: `Bearer ${secret}` } } } },
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await queue },
  }
}

export async function runDesignWithClaudeCode(options: { system: string; content: unknown[]; model: string; effort?:import('@shared/types/ai').ClaudeEffort; tools: BridgeTool[]; execute: (name: string, input: unknown) => Promise<unknown>; signal: AbortSignal; onText?: (text: string) => void }): Promise<string> {
  const executable = findClaudeCode()
  if (!executable) throw new Error('Install the official Claude Code CLI, then reconnect in FrameUI.')
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-claude-'))
  const bridge = await startDesignBridge(options.tools, options.execute, options.signal)
  try {
    const configFile = path.join(cwd, 'mcp.json')
    fs.writeFileSync(configFile, JSON.stringify(bridge.config), { mode: 0o600 })
    const args = [...streamArgs, '--include-partial-messages', '--allowedTools', 'mcp__frameui__*', '--strict-mcp-config', '--mcp-config', configFile, '--max-turns', '48', '--system-prompt', options.system]
    if (options.model !== 'default') args.push('--model', options.model)
    if(options.effort&&options.effort!=='default')args.push('--effort',options.effort)
    let result: CliEvent | undefined
    try {
      await runClaudeCode(executable, args, { cwd, signal: options.signal, timeout: 600_000, input: JSON.stringify({ type: 'user', message: { role: 'user', content: options.content } }) + '\n', onEvent: event => {
        if (event.type === 'result') result = event
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') options.onText?.(event.event.delta.text)
      } })
    } catch (error) {
      if (!options.signal.aborted && result?.subtype === 'error_max_turns') return 'Draft paused at the task limit. Review the completed work, then ask Claude to continue the remaining screens or interactions.'
      if (!options.signal.aborted && result?.is_error) throw new Error('Claude Code: ' + cliErrorDetail(result.errors?.join('\n') || result.result || result.subtype))
      throw error
    }
    if (result?.subtype === 'error_max_turns') return 'Draft paused at the task limit. Review the completed work, then ask Claude to continue the remaining screens or interactions.'
    if (!result || result.is_error || result.subtype !== 'success' || typeof result.result !== 'string') throw new Error('Claude Code did not finish this task. ' + cliErrorDetail(result?.errors?.join('\n') || result?.result || result?.subtype || 'No completion was received.'))
    return result.result
  } finally { await bridge.close(); fs.rmSync(cwd, { recursive: true, force: true }) }
}
