const fs = require('node:fs/promises')
const { createReadStream, createWriteStream } = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const crypto = require('node:crypto')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { createGunzip, createBrotliDecompress, createInflate } = require('node:zlib')
const { execFile } = require('node:child_process')
const { verifyTar, zipArchive, extractPortable, MAX_BYTES } = require('./portable-archive.cjs')

function run(command, args) {
  return new Promise((resolve, reject) => execFile(command, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)))
}
// Node's HTTP streams preserve the wire bytes. fetch transparently decodes
// Content-Encoding, which is unsafe when a distribution labels its .gz file
// as gzip encoded. Archive decoding belongs exclusively to validation/extraction.
function responseFor(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many download redirects.'))
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return reject(new Error('Unsupported download protocol.'))
    const request = (parsed.protocol === 'https:' ? https : http).get(parsed, { headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'FrameUI' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume()
        if (!response.headers.location) return reject(new Error('Download redirect has no destination.'))
        const next = new URL(response.headers.location, parsed)
        if (parsed.protocol === 'https:' && next.protocol !== 'https:') return reject(new Error('Insecure runtime redirect.'))
        resolve(responseFor(next.href, redirects + 1)); return
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Runtime download returned HTTP ${response.statusCode}.`)); return }
      if (/text\/|json|xml/i.test(response.headers['content-type'] || '')) { response.resume(); reject(new Error('Runtime source returned an error document.')); return }
      resolve(response)
    })
    request.setTimeout(30000, () => request.destroy(new Error('Runtime download timed out.')))
    request.once('error', reject)
  })
}
async function formatOf(file) {
  const handle = await fs.open(file, 'r')
  try {
    const bytes = Buffer.alloc(512); const { bytesRead } = await handle.read(bytes, 0, 512, 0)
    if (bytesRead >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 8) return 'gzip'
    if (bytes.readUInt32LE(0) === 0x04034b50 || bytes.readUInt32LE(0) === 0x06054b50) return 'zip'
    if (bytesRead === 512 && bytes.toString('ascii', 257, 262) === 'ustar') return 'tar'
    const stat = await handle.stat()
    if (stat.size >= 512) { await handle.read(bytes, 0, 512, stat.size - 512); if (bytes.toString('ascii', 0, 4) === 'koly') return 'dmg' }
    throw new Error('The runtime download is not a supported archive.')
  } finally { await handle.close() }
}
async function verifyArchive(file, checksum) {
  const format = await formatOf(file)
  const hash = crypto.createHash(checksum?.length === 128 ? 'sha512' : 'sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (!/^(?:[a-f0-9]{64}|[a-f0-9]{128})$/i.test(checksum || '') || hash.digest('hex') !== checksum.toLowerCase()) throw new Error('Runtime checksum verification failed.')
  // Listing validates archive structure; gzip is additionally fully decoded so
  // truncated tails and CRC errors cannot be ignored by a lenient tar reader.
  if (format === 'gzip') {
    const { Writable } = require('node:stream')
    let bytes = 0
    await pipeline(createReadStream(file), createGunzip(), new Writable({ write(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > MAX_BYTES ? new Error('The runtime archive exceeds extraction limits.') : null) } }))
  }
  if (format === 'dmg') { await run('/usr/bin/hdiutil', ['verify', file]); return format }
  if (format === 'zip') await zipArchive(file)
  else await verifyTar(file)
  return format
}
async function downloadVerifiedUnshared({ urls, archive, checksum, attempts = 3, delay = 500, onProgress = () => {} }) {
  await fs.mkdir(path.dirname(archive), { recursive: true })
  for (const name of await fs.readdir(path.dirname(archive))) if (name.startsWith(path.basename(archive) + '.') && name.endsWith('.part')) await fs.rm(path.join(path.dirname(archive), name), { force: true })
  try { return { archive, format: await verifyArchive(archive, checksum), cached: true } } catch { await fs.rm(archive, { force: true }) }
  let failure
  for (let attempt = 0; attempt < attempts; attempt++) {
    const temporary = `${archive}.${crypto.randomUUID()}.part`
    try {
      const response = await responseFor(urls[attempt % urls.length])
      let received = 0
      const total = Number(response.headers['content-length']) || 0
      response.on('data', chunk => { received += chunk.length; onProgress(received, total) })
      await pipeline(response, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
      if (total && received !== total) throw new Error('The runtime download was interrupted.')
      let format
      try { format = await verifyArchive(temporary, checksum) }
      catch (original) {
        // Some servers wrap the archive in a genuine transport encoding;
        // others merely mislabel the archive. Accept raw bytes first, then
        // decode transport once only if the trusted checksum proves it.
        const decoders = { gzip: createGunzip, br: createBrotliDecompress, deflate: createInflate }
        const decoder = decoders[String(response.headers['content-encoding'] || '').toLowerCase()]
        if (!decoder) throw original
        const decoded = `${temporary}.decoded`
        try {
          await pipeline(createReadStream(temporary), decoder(), createWriteStream(decoded, { flags: 'wx', mode: 0o600 }))
          format = await verifyArchive(decoded, checksum)
          await fs.rename(decoded, temporary)
        } finally { await fs.rm(decoded, { force: true }) }
      }
      await fs.rename(temporary, archive)
      return { archive, format, cached: false }
    } catch (error) { failure = error; await fs.rm(temporary, { force: true }) }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delay * 2 ** attempt))
  }
  throw failure
}
const downloadsInFlight = new Map()
async function downloadVerified(options) {
  const key = path.resolve(options.archive)
  if (downloadsInFlight.has(key)) return downloadsInFlight.get(key)
  const operation = downloadVerifiedUnshared(options)
  downloadsInFlight.set(key, operation)
  try { return await operation } finally { downloadsInFlight.delete(key) }
}
async function extractArchive(archive, destination, strip = 0, excludedTopLevel = []) {
  const format = await formatOf(archive)
  await fs.mkdir(destination, { recursive: true })
  await extractPortable(archive, destination, format, strip, excludedTopLevel)
}
module.exports = { responseFor, downloadVerified, verifyArchive, formatOf, extractArchive }
