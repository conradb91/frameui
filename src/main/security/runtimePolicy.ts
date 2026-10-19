import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJsonFile, writeJsonFileAtomic } from '@core/workspace/atomicJson'
import type { RuntimeConnection, RuntimeSource } from '@shared/types/project'

export function runtimeAddress(value: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS Runtime URL without embedded credentials.')
  if (!isLocalRuntime(url) && url.protocol !== 'https:') throw new Error('Staging and production runtimes require HTTPS.')
  return url
}
export function isLocalRuntime(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost')
}
function file(root: string, projectId: string): string {
  return path.join(root, 'runtime-connections', `${encodeURIComponent(projectId)}.json`)
}
export function readRuntime(root: string, projectId: string): RuntimeConnection | null {
  return readJsonFile<RuntimeConnection | null>(file(root, projectId), null)
}
export function configureRuntime(root: string, projectId: string, value: string, source: RuntimeSource): RuntimeConnection {
  const url = runtimeAddress(value)
  if ((source === 'local') !== isLocalRuntime(url)) throw new Error('Choose Local development for localhost, or Staging / Production for a remote domain.')
  const previous = readRuntime(root, projectId)
  const sameOrigin = previous?.origin === url.origin
  const connection: RuntimeConnection = { url: url.href, origin: url.origin, source, token: sameOrigin ? previous.token : randomUUID(), connectedAt: new Date().toISOString(), verifiedAt: sameOrigin ? previous.verifiedAt : undefined }
  fs.mkdirSync(path.dirname(file(root, projectId)), { recursive: true })
  writeJsonFileAtomic(file(root, projectId), connection)
  return connection
}
export function runtimeAllowed(root: string, projectId: string | undefined, value: string): boolean {
  try {
    const url = runtimeAddress(value)
    if (!projectId) return false
    if (isLocalRuntime(url)) return true
    const connection = readRuntime(root, projectId)
    return connection?.origin === url.origin && !!(connection.connectedAt || connection.verifiedAt)
  } catch { return false }
}
export async function verifyRuntime(root: string, projectId: string): Promise<RuntimeConnection> {
  const connection = readRuntime(root, projectId)
  if (!connection) throw new Error('Save a Runtime URL first.')
  if (!isLocalRuntime(runtimeAddress(connection.url))) {
    let response: Response
    try { response = await fetch(`${connection.origin}/.well-known/frameui-verification.txt`, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Cache-Control': 'no-cache' } }) }
    catch { throw new Error('Could not reach the verification file. Check your connection and ensure the verification URL opens publicly over HTTPS without redirects, then try again.') }
    if (response.status === 404) throw new Error('Verification file not found (404). Deploy frameui-verification.txt at the address shown in setup, then select Verify domain again.')
    if (response.status === 401 || response.status === 403) throw new Error('The verification file requires access. Make this file publicly readable without signing in, then try again.')
    if (!response.ok || !response.body) throw new Error(`The server could not serve the verification file (HTTP ${response.status}). Check the verification URL and try again.`)
    const reader = response.body.getReader()
    let body = ''
    const decoder = new TextDecoder()
    try {
      let part = await reader.read()
      while (!part.done) {
        body += decoder.decode(part.value, { stream: true })
        if (body.length > 4096) throw new Error('Verification file is too large.')
        part = await reader.read()
      }
      body += decoder.decode()
    } finally { await reader.cancel() }
    if (body.trim() !== connection.token) throw new Error('The file was found, but its contents do not match this project. Replace its contents with only the token shown in setup, then verify again.')
  }
  const current = readRuntime(root, projectId)
  if (current?.origin !== connection.origin || current.token !== connection.token) throw new Error('Runtime changed during verification. Try again.')
  const verified = { ...current, verifiedAt: new Date().toISOString() }
  writeJsonFileAtomic(file(root, projectId), verified)
  return verified
}
