import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureRuntime, readRuntime, runtimeAddress, runtimeAllowed, verifyRuntime } from '../../src/main/security/runtimePolicy'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-runtime-'))
const originalFetch = globalThis.fetch
let counter = 0
const project = () => `project-${++counter}`
afterEach(() => { globalThis.fetch = originalFetch })
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }))

test('local capture requires an imported project and rejects unsafe URLs', () => {
  expect(runtimeAllowed(root, 'p', 'http://localhost:3000/dashboard')).toBe(true)
  expect(runtimeAllowed(root, undefined, 'http://localhost:3000')).toBe(false)
  for (const url of ['file:///tmp/test', 'https://user:password@app.example.com', 'http://app.example.com', 'https://localhost.evil.example']) expect(runtimeAllowed(root, 'p', url)).toBe(false)
  expect(() => runtimeAddress('javascript:alert(1)')).toThrow()
})
test('explicit app connections are scoped to project and exact origin; ownership is optional', async () => {
  const id = project()
  const connection = configureRuntime(root, id, 'https://app.example.com/dashboard', 'staging')
  expect(runtimeAllowed(root, id, connection.url)).toBe(true)
  globalThis.fetch = (async (url, options) => {
    expect(String(url)).toBe('https://app.example.com/.well-known/frameui-verification.txt')
    expect(options?.redirect).toBe('error')
    return new Response(connection.token + '\n')
  }) as typeof fetch
  await verifyRuntime(root, id)
  expect(readRuntime(root, id)?.verifiedAt).toBeTruthy()
  expect(runtimeAllowed(root, id, 'https://app.example.com/other')).toBe(true)
  for (const url of ['https://other.example.com', 'https://app.example.com:444', 'https://sub.app.example.com']) expect(runtimeAllowed(root, id, url)).toBe(false)
  expect(runtimeAllowed(root, project(), connection.url)).toBe(false)
  expect(configureRuntime(root, id, 'https://app.example.com/another', 'production').verifiedAt).toBeTruthy()
  const changed = configureRuntime(root, id, 'https://new.example.com', 'production')
  expect(changed.verifiedAt).toBeUndefined()
  expect(changed.token).not.toBe(connection.token)
})
test('wrong tokens, oversized bodies and changed configuration cannot verify', async () => {
  const id = project()
  const connection = configureRuntime(root, id, 'https://app.example.com', 'production')
  for (const body of ['wrong', 'x'.repeat(5000)]) {
    globalThis.fetch = (async () => new Response(body)) as typeof fetch
    await expect(verifyRuntime(root, id)).rejects.toThrow()
    expect(runtimeAllowed(root, id, connection.url)).toBe(true)
  }
  globalThis.fetch = (async () => {
    configureRuntime(root, id, 'https://changed.example.com', 'production')
    return new Response(connection.token)
  }) as typeof fetch
  await expect(verifyRuntime(root, id)).rejects.toThrow('Runtime changed')
})
test('source choice must match runtime type', () => {
  expect(() => configureRuntime(root, project(), 'https://app.example.com', 'local')).toThrow()
  expect(() => configureRuntime(root, project(), 'http://localhost:3000', 'production')).toThrow()
})
test('optional ownership failures explain recovery without blocking connected-app capture', async () => {
  const id = project()
  const connection = configureRuntime(root, id, 'https://app.example.com', 'production')
  for (const [status, message] of [[404, 'Deploy frameui-verification.txt'], [403, 'publicly readable'], [500, 'HTTP 500']] as const) {
    globalThis.fetch = (async () => new Response('error', { status })) as typeof fetch
    await expect(verifyRuntime(root, id)).rejects.toThrow(message)
    expect(runtimeAllowed(root, id, connection.url)).toBe(true)
  }
  globalThis.fetch = (async () => { throw new Error('network error') }) as typeof fetch
  await expect(verifyRuntime(root, id)).rejects.toThrow('without redirects')
  expect(runtimeAllowed(root, id, connection.url)).toBe(true)
})

test('normal remote connection needs no verification request or public file',()=>{
 const id=project();globalThis.fetch=(()=>{throw new Error('normal connection must not fetch an ownership file')}) as typeof fetch;
 const connection=configureRuntime(root,id,'https://private.example.com/app','staging');expect(connection.connectedAt).toBeTruthy();expect(connection.verifiedAt).toBeUndefined();expect(runtimeAllowed(root,id,connection.url)).toBe(true);expect(runtimeAllowed(root,id,'https://private.example.com.evil.test')).toBe(false);
});
