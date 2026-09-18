const fs = require('node:fs/promises')
const sync = require('node:fs')
const path = require('node:path')
const {execFileSync} = require('node:child_process')
const {downloadVerified,extractArchive} = require('./verified-archive.cjs')
const BASE = 'https://downloads.php.net/~windows/releases/'
function windowsBuilds(metadata, architecture = process.arch) {
  return Object.values(metadata).flatMap(release => Object.entries(release).flatMap(([name,build]) => {
    if (!name.startsWith('nts-') || !name.endsWith('-'+architecture) || !/^8\.\d+\.\d+$/.test(release.version) || !/^php-[a-zA-Z0-9.-]+\.zip$/.test(build?.zip?.path || '') || !/^[a-f0-9]{64}$/i.test(build?.zip?.sha256 || '')) return []
    return [{version:release.version,file:build.zip.path,sha256:build.zip.sha256,architecture}]
  })).sort((a,b) => b.version.localeCompare(a.version,undefined,{numeric:true}))
}
async function verifyWindowsPhp(binary, architecture) {
  const file = await fs.open(binary,'r')
  try {
    const header = Buffer.alloc(64); await file.read(header,0,64,0)
    if (header.toString('ascii',0,2) !== 'MZ') throw new Error('The executable is not a Windows binary.')
    const pe = Buffer.alloc(6); const offset = header.readUInt32LE(60)
    const {bytesRead} = await file.read(pe,0,6,offset)
    if (bytesRead !== 6 || pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== ({x64:0x8664,arm64:0xaa64}[architecture])) throw new Error('The executable has the wrong Windows architecture.')
  } finally { await file.close() }
}
function probe(binary) { try { return execFileSync(binary,['-r','echo PHP_VERSION;'],{timeout:10000,encoding:'utf8',windowsHide:true}).trim() } catch { return null } }
function configuration(directory) {
  return `extension_dir="${path.join(directory,'ext').replace(/\\/g,'/')}"\ndate.timezone=UTC\n` + ['curl','fileinfo','mbstring','openssl','intl','pdo_mysql','pdo_pgsql','pdo_sqlite','sqlite3','zip','sodium','gd'].filter(name => sync.existsSync(path.join(directory,'ext',`php_${name}.dll`))).map(name=>`extension=${name}`).join('\n')+'\n'
}
class WindowsPhpManager {
  constructor(root,emit,compatible) { this.root = path.join(root,'php','win32'); this.downloads = path.join(root,'downloads','win32'); this.emit = emit; this.compatible = compatible; this.builds = [] }
  async catalog() {
    const response = await fetch(BASE+'releases.json',{signal:AbortSignal.timeout(30000)})
    if (!response.ok) throw new Error('The official Windows PHP catalog could not be retrieved.')
    this.builds = windowsBuilds(await response.json())
    const installed = new Set((await this.list()).map(item=>item.version))
    return this.builds.map(build=>({type:'PHP',version:build.version,architecture:process.arch,installed:installed.has(build.version),extensions:[],missingExtensions:[]}))
  }
  async list() {
    const versions = await fs.readdir(this.root).catch(()=>[])
    return versions.filter(version=>/^\d+\.\d+\.\d+$/.test(version)).flatMap(version=>{
      const bin = path.join(this.root,version,process.arch,'bin')
      return sync.existsSync(path.join(bin,'php.exe')) ? [{type:'PHP',version,architecture:process.arch,path:bin,managed:true}] : []
    }).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}))
  }
  cachedPath(project) {
    try {
      const versions = sync.readdirSync(this.root).filter(version=>this.compatible(version,project)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))
      if (versions.includes(project.runtimeSelection)) versions.unshift(project.runtimeSelection)
      for (const version of versions) { const bin = path.join(this.root,version,process.arch,'bin'); if (probe(path.join(bin,'php.exe')) === version) return bin }
    } catch {}
    return null
  }
  async install(version) {
    await this.catalog()
    const build = this.builds.find(build=>build.version===version)
    if (!build) throw new Error('No approved Windows PHP build matches this version and architecture.')
    const target = path.join(this.root,version,process.arch), binary = path.join(target,'bin','php.exe')
    if (probe(binary) === version) { await verifyWindowsPhp(binary,process.arch); return {installed:true,version,path:target} }
    const archive = path.join(this.downloads,process.arch,build.file)
    let failure
    for (let attempt=0;attempt<3;attempt++) {
      const staging = target+'.installing-'+require('node:crypto').randomUUID(), bin = path.join(staging,'bin')
      try {
        this.emit('runtime',{runtimeType:'php',version,status:'Downloading'})
        await downloadVerified({urls:[BASE+build.file],archive,checksum:build.sha256})
        await extractArchive(archive,bin)
        await verifyWindowsPhp(path.join(bin,'php.exe'),process.arch)
        await require('./windows-crt.cjs').installLocalCrt(bin)
        await fs.writeFile(path.join(bin,'php.ini'),configuration(bin))
        if (probe(path.join(bin,'php.exe')) !== version) throw new Error('Windows PHP could not launch. Its Microsoft Visual C++ runtime prerequisite may be missing.')
        const ini = configuration(bin).replace(bin.replace(/\\/g,'/'),path.join(target,'bin').replace(/\\/g,'/'))
        await fs.writeFile(path.join(bin,'php.ini'),ini)
        await fs.mkdir(path.dirname(target),{recursive:true}); await fs.rm(target,{recursive:true,force:true}); await fs.rename(staging,target)
        this.emit('runtime',{runtimeType:'php',version,status:'Complete'}); return {installed:true,version,path:target}
      } catch(error) { failure = error; await fs.rm(archive,{force:true}); if(attempt<2) await new Promise(resolve=>setTimeout(resolve,500*2**attempt)) }
      finally { await fs.rm(staging,{recursive:true,force:true}) }
    }
    throw failure
  }
}
module.exports = {WindowsPhpManager,windowsBuilds,verifyWindowsPhp}
