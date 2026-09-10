import { test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'
const require = createRequire(import.meta.url)
const { downloadVerified, verifyArchive, extractArchive } = require('../../../hosting/stacker/lib/verified-archive.cjs')
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex')
let root: string, gzip: Buffer, zip: Buffer, tar: Buffer, base: string, server: http.Server
const hits = new Map<string, number>()
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-archive-test-'))
  await fs.writeFile(path.join(root, 'php'), 'fixture executable')
  execFileSync('tar', ['-czf', path.join(root, 'valid.gz'), '-C', root, 'php'])
  execFileSync('tar', ['-cf', path.join(root, 'valid.tar'), '-C', root, 'php'])
  execFileSync('zip', ['-q', path.join(root, 'valid.zip'), 'php'], { cwd: root })
  gzip = await fs.readFile(path.join(root, 'valid.gz')); zip = await fs.readFile(path.join(root, 'valid.zip')); tar = await fs.readFile(path.join(root, 'valid.tar'))
  server = http.createServer((req, res) => {
    const url = req.url!; const count = (hits.get(url) ?? 0) + 1; hits.set(url, count)
    if (url === '/redirect') { res.writeHead(302, { Location: '/gzip' }); res.end(); return }
    if (url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>Error</html>'); return }
    if (url === '/status') { res.writeHead(503); res.end('unavailable'); return }
    if (url === '/interrupted' && count === 1) { res.writeHead(200, { 'Content-Length': gzip.length }); res.write(gzip.subarray(0, 10)); setTimeout(() => res.destroy(), 5); return }
    if (url === '/transport') { res.setHeader('Content-Encoding', 'gzip'); res.end(gzipSync(gzip)); return }
    if (url === '/encoded') res.setHeader('Content-Encoding', 'gzip')
    const bytes = url === '/zip' ? zip : url === '/truncated' ? gzip.subarray(0, gzip.length - 8) : url === '/tar' ? tar : gzip
    res.end(bytes)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }) })
const download = (endpoint: string, checksum?: string, archive?: string) => downloadVerified({ urls: [base + endpoint], archive: archive ?? path.join(root, crypto.randomUUID()), checksum: checksum ?? hash(gzip), delay: 1 })
test('valid gzip is verified and extracted', async () => {
  const value = await download('/gzip'); expect(value.format).toBe('gzip')
  const out = path.join(root, 'extracted'); await extractArchive(value.archive, out)
  expect(await fs.readFile(path.join(out, 'php'), 'utf8')).toBe('fixture executable')
})
test('valid ZIP uses ZIP extraction', async () => { const value = await download('/zip', hash(zip)); expect(value.format).toBe('zip'); await extractArchive(value.archive, path.join(root, 'unzipped')); expect(await fs.readFile(path.join(root, 'unzipped/php'), 'utf8')).toBe('fixture executable') })
test('valid tar is recognized by bytes', async () => { expect((await download('/tar', hash(tar))).format).toBe('tar') })
test('truncated archive is rejected even with matching checksum', async () => { await expect(download('/truncated', hash(gzip.subarray(0, gzip.length - 8)))).rejects.toThrow() })
test('HTML error response is rejected', async () => { await expect(download('/html')).rejects.toThrow('error document') })
test('HTTP failure is rejected', async () => { await expect(download('/status')).rejects.toThrow('HTTP 503') })
test('redirect preserves binary content', async () => { expect((await download('/redirect')).format).toBe('gzip') })
test('network interruption is automatically retried', async () => { await download('/interrupted'); expect(hits.get('/interrupted')).toBe(2) })
test('incorrect checksum is rejected and temporary files removed', async () => { const cache = path.join(root, 'bad-checksum'); await expect(download('/gzip', '0'.repeat(64), cache)).rejects.toThrow('checksum'); expect((await fs.readdir(root)).filter(name => name.startsWith('bad-checksum'))).toEqual([]) })
test('existing corrupt cache is replaced', async () => { const cache = path.join(root, 'corrupt'); await fs.writeFile(cache, '<html>bad</html>'); const value = await download('/gzip', undefined, cache); expect(value.cached).toBe(false); await verifyArchive(cache, hash(gzip)) })
test('existing valid cache needs no network', async () => { const cache = path.join(root, 'cached'); await fs.writeFile(cache, gzip); const before = hits.get('/gzip'); expect((await download('/gzip', undefined, cache)).cached).toBe(true); expect(hits.get('/gzip')).toBe(before) })
test('Content-Encoding gzip does not cause double decompression', async () => { const value = await download('/encoded'); expect(await fs.readFile(value.archive)).toEqual(gzip) })
test('gzip integrity is validated independently of checksum', async () => { const bad = Buffer.from(gzip); bad[bad.length - 8] ^= 0xff; const file = path.join(root, 'crc'); await fs.writeFile(file, bad); await expect(verifyArchive(file, hash(bad))).rejects.toThrow() })
test('failed extraction does not register a runtime', async () => { const file = path.join(root, 'not-tar.gz'); await fs.writeFile(file, gzipSync('not an archive')); await expect(extractArchive(file, path.join(root, 'failed'))).rejects.toThrow() })
test('unsupported OS cannot install a macOS PHP binary', async () => {
  const { PhpManager } = require('../../../hosting/stacker/lib/php-manager.cjs')
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  try { Object.defineProperty(process, 'platform', { value: 'freebsd' }); await expect(new PhpManager(root).install('8.4.20')).rejects.toThrow('operating system and architecture') } finally { Object.defineProperty(process, 'platform', descriptor) }
})
test('occupied ports and empty AirPlay-like 403 responses are not ready applications', async () => {
  const { portAvailable, routeResponds } = require('../../../hosting/stacker/lib/health.cjs')
  const listener = http.createServer((_req,res) => { res.writeHead(403); res.end() })
  await new Promise<void>(resolve => listener.listen(0,'127.0.0.1',resolve))
  const port = (listener.address() as {port:number}).port
  try { expect(await portAvailable(port)).toBe(false); expect((await routeResponds(port)).ok).toBe(false) }
  finally { await new Promise<void>(resolve => listener.close(() => resolve())) }
})

test('genuine transport gzip is decoded once and checked against the archive checksum', async () => { const value = await download('/transport'); expect(await fs.readFile(value.archive)).toEqual(gzip) })

test('an executable that reports the version but has the wrong binary architecture is rejected', async () => {
  const { verifyPhpExecutable } = require('../../../hosting/stacker/lib/php-manager.cjs')
  const binary = path.join(root, 'wrong-architecture')
  await fs.writeFile(binary, '#!/bin/sh\nprintf 8.4.20\n', { mode: 0o755 })
  await expect(verifyPhpExecutable(binary, '8.4.20', 'arm64')).rejects.toThrow('operating system or architecture')
})
test('interrupted cache files are removed on recovery', async () => {
  const cache = path.join(root, 'interrupted-cache')
  await fs.writeFile(`${cache}.previous.part`, gzip.subarray(0, 8))
  await download('/gzip', undefined, cache)
  expect(await fs.stat(`${cache}.previous.part`).catch(() => null)).toBeNull()
})
test('safe library symlink chains survive extraction and wrapper stripping', async () => {
  const folder = path.join(root, 'links'); await fs.mkdir(path.join(folder, 'wrapper/lib'), { recursive: true })
  await fs.writeFile(path.join(folder, 'wrapper/lib/actual'), 'library')
  await fs.symlink('actual', path.join(folder, 'wrapper/lib/version'))
  await fs.symlink('version', path.join(folder, 'wrapper/lib/current'))
  const archive = path.join(root, 'links.tar.gz')
  await require('tar').c({ cwd: folder, file: archive, gzip: true }, ['wrapper'])
  const output = path.join(root, 'links-output'); await extractArchive(archive, output, 1)
  expect(await fs.readFile(path.join(output, 'lib/current'), 'utf8')).toBe('library')
  expect(await fs.realpath(path.join(output, 'lib/current'))).toBe(await fs.realpath(path.join(output, 'lib/actual')))
})
test('wrapper stripping cannot turn an archive-relative link into an escape', async () => {
  const folder = path.join(root, 'escape-links'); await fs.mkdir(path.join(folder, 'wrapper'), { recursive: true })
  await fs.writeFile(path.join(folder, 'outside'), 'outside')
  await fs.symlink('../outside', path.join(folder, 'wrapper/link'))
  const archive = path.join(root, 'escape-links.tar.gz')
  await require('tar').c({ cwd: folder, file: archive, gzip: true }, ['wrapper'])
  await expect(extractArchive(archive, path.join(root, 'escape-output'), 1)).rejects.toThrow('unsafe links')
})
test('runtime ZIP extraction can omit bundled management apps while retaining server files and licenses',async()=>{
 const fixture=path.join(root,'optional-tools');await fs.mkdir(path.join(fixture,'wrapper/bin'),{recursive:true});await fs.mkdir(path.join(fixture,'wrapper/pgAdmin 4'),{recursive:true})
 await fs.writeFile(path.join(fixture,'wrapper/bin/server.exe'),'server');await fs.writeFile(path.join(fixture,'wrapper/server_license.txt'),'license');await fs.writeFile(path.join(fixture,'wrapper/pgAdmin 4/default_app.asar'),'optional')
 const archive=path.join(root,'optional-tools.zip');execFileSync('zip',['-qr',archive,'wrapper'],{cwd:fixture})
 const output=path.join(root,'optional-output');await extractArchive(archive,output,1,['pgAdmin 4'])
 expect(await fs.readFile(path.join(output,'bin/server.exe'),'utf8')).toBe('server')
 expect(await fs.readFile(path.join(output,'server_license.txt'),'utf8')).toBe('license')
 expect(await fs.stat(path.join(output,'pgAdmin 4')).then(()=>true).catch(()=>false)).toBe(false)
})
