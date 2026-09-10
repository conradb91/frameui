// Archives may contain .asar files; treat them as bytes, not Electron virtual filesystems.
const fileSystem = process.versions.electron ? require('original-fs') : require('node:fs')
const fs = fileSystem.promises
const { createWriteStream } = fileSystem
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Transform, Writable } = require('node:stream')
const tar = require('tar')
const yauzl = require('yauzl')
const crc32 = require('buffer-crc32')
const MAX_BYTES = 8 * 1024 ** 3
const MAX_ENTRIES = 200000

function safeName(name) {
  if (!name || name.includes('\0') || /^[\\/]|^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes('..')) throw new Error('The runtime archive contains unsafe paths.')
  if (process.platform === 'win32' && name.split(/[\\/]/).filter(part => part && part !== '.').some(part => /[:]|[. ]$|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('The runtime archive contains an unsupported Windows path.')
  return name.replace(/\\/g, '/')
}
async function verifyTar(file) {
  let failure, entries = 0, bytes = 0
  await tar.t({ file, strict: true, onReadEntry(entry) {
    try {
      const name = safeName(entry.path)
      if (++entries > MAX_ENTRIES || (bytes += entry.size) > MAX_BYTES) throw new Error('The runtime archive exceeds extraction limits.')
      if (!['File','Directory','SymbolicLink','Link','OldFile','ContiguousFile'].includes(entry.type)) throw new Error('The runtime archive contains unsupported entries.')
      if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
        if (/^[\\/]|^[A-Za-z]:/.test(entry.linkpath)) throw new Error('The runtime archive contains unsafe links.')
        const target = path.posix.normalize(path.posix.join(entry.type === 'SymbolicLink' ? path.posix.dirname(name) : '', entry.linkpath.replace(/\\/g, '/')))
        safeName(target)
      }
    } catch (error) { failure ??= error }
  } })
  if (failure) throw failure
  if (!entries) throw new Error('The runtime archive is empty.')
}
async function safeDirectory(root, relative) {
  let directory = root
  for (const part of ['', ...relative.split('/').filter(Boolean)]) {
    directory = part ? path.join(directory, part) : directory
    await fs.mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error })
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The extraction folder contains unsafe links.')
  }
}
async function zipArchive(file, destination = null, strip = 0) {
  const zip = await new Promise((resolve,reject) => yauzl.open(file, {lazyEntries:true, strictFileNames:true}, (error,value) => error ? reject(error) : resolve(value)))
  let entries = 0, bytes = 0
  await new Promise((resolve,reject) => {
    const fail = error => { zip.close(); reject(error) }
    zip.once('error', fail)
    zip.once('end', () => entries ? resolve() : reject(new Error('The runtime archive is empty.')))
    zip.on('entry', entry => { (async () => {
      const name = safeName(entry.fileName)
      if (++entries > MAX_ENTRIES || (bytes += entry.uncompressedSize) > MAX_BYTES) throw new Error('The runtime archive exceeds extraction limits.')
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP symbolic links are not supported.')
      const relative = name.split('/').slice(strip).join('/')
      if (name.endsWith('/')) { if (destination && relative) await safeDirectory(destination, relative); zip.readEntry(); return }
      const stream = await new Promise((resolve,reject) => zip.openReadStream(entry,(error,value) => error ? reject(error) : resolve(value)))
      let checksum = 0
      const check = new Transform({transform(chunk,_encoding,callback) { checksum = crc32.unsigned(chunk,checksum); callback(null,chunk) }})
      let output = new Writable({write(_chunk,_encoding,callback) { callback() }})
      if (destination && relative) {
        await safeDirectory(destination, path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative))
        output = createWriteStream(path.join(destination,relative),{flags:'wx',mode:0o600})
      }
      await pipeline(stream,check,output)
      if (checksum !== entry.crc32) throw new Error('ZIP integrity verification failed.')
      zip.readEntry()
    })().catch(fail) })
    zip.readEntry()
  })
}
async function extractPortable(file, destination, format, strip) {
  if (!Number.isInteger(strip) || strip < 0) throw new Error('Invalid archive directory depth.')
  if (format === 'zip') return zipArchive(file,destination,strip)
  await verifyTar(file)
  // Extract data before links: node-tar rejects even safe symlink chains.
  // Resolve every link against completed files inside the extraction root.
  const links = []
  await tar.x({file,cwd:destination,strip,strict:true,preservePaths:false,preserveOwner:false,chmod:true,filter(_name,entry) {
    if (entry.type !== 'SymbolicLink' && entry.type !== 'Link') return true
    const relative = entry.path.split('/').slice(strip).join('/')
    if (relative) links.push({relative, target:entry.linkpath, symbolic:entry.type === 'SymbolicLink'})
    return false
  }})
  const root = await fs.realpath(destination)
  let pending = links
  while (pending.length) {
    const next = []
    for (const link of pending) {
      safeName(link.relative)
      const target = link.symbolic ? path.resolve(root,path.dirname(link.relative),link.target) : path.resolve(root,link.target.split('/').slice(strip).join('/'))
      if (!target.startsWith(root + path.sep)) throw new Error('The runtime archive contains unsafe links after removing its wrapper folder.')
      const real = await fs.realpath(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (!real) { next.push(link); continue }
      if (!real.startsWith(root + path.sep)) throw new Error('The runtime archive contains unsafe links.')
      await safeDirectory(root,path.posix.dirname(link.relative) === '.' ? '' : path.posix.dirname(link.relative))
      const output = path.join(root,link.relative)
      if (link.symbolic) await fs.symlink(path.relative(path.dirname(output),real),output)
      else await fs.link(real,output)
    }
    if (next.length === pending.length) throw new Error('The runtime archive contains unresolved or circular links.')
    pending = next
  }
}
module.exports = { verifyTar, zipArchive, extractPortable, MAX_BYTES }
