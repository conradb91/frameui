import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'
import type { ZipFile, Entry } from 'yauzl'

const MAX_BYTES = 128 * 1024 * 1024
const servers = new Map<string, { url: string; server: http.Server }>()
const mime: Record<string,string> = {'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon'}

/** Data-only extraction. Never installs packages or executes archive commands. */
export async function unpackPrototype(file: string, destination: string, signal?:AbortSignal, progress?:(completed:number,total:number,file:string)=>void) {
  signal?.throwIfAborted()
  if ((await fs.stat(file)).size > MAX_BYTES) throw new Error('Choose a prototype smaller than 128 MB.')
  await fs.mkdir(destination, {recursive:true})
  if (/\.html?$/i.test(file)) { await fs.copyFile(file,path.join(destination,path.basename(file))); signal?.throwIfAborted();progress?.(1,1,path.basename(file)); return }
  if (!/\.zip$/i.test(file)) throw new Error('Choose an HTML file or ZIP prototype.')
  const yauzl = createRequire(__filename)('yauzl') as typeof import('yauzl')
  const crc32=createRequire(__filename)('buffer-crc32') as {unsigned(data:Buffer,previous?:number):number}
  // yauzl validates decoded names and actual streamed sizes, in addition to our limits.
  const zip = await new Promise<ZipFile>((resolve,reject)=>yauzl.open(file,{lazyEntries:true,strictFileNames:true},(e,z)=>e||!z?reject(e||new Error('Invalid ZIP prototype.')):resolve(z)))
  let count=0,total=0
  await new Promise<void>((resolve,reject)=>{
    const fail=(e:unknown)=>{zip.close();reject(e)}
    let activeStream:Readable|undefined,entryWork:Promise<void>|undefined
    const abort=()=>{activeStream?.destroy(new Error('Import stopped'));if(!entryWork)fail(signal?.reason??new Error('Import stopped'))}
    signal?.addEventListener('abort',abort,{once:true})
    zip.on('error',fail);zip.on('end',()=>{signal?.removeEventListener('abort',abort);resolve()});zip.on('close',()=>signal?.removeEventListener('abort',abort))
    if(signal?.aborted){abort();return}
    zip.on('entry',(entry:Entry)=>{entryWork=(async()=>{
      signal?.throwIfAborted()
      const name=entry.fileName as string
      progress?.(count,zip.entryCount,name)
      if (++count>2000 || (total+=entry.uncompressedSize)>MAX_BYTES) throw new Error('Prototype exceeds 2,000 files or 128 MB unpacked.')
      if (/^[\\/]|^[A-Za-z]:/.test(name)||name.includes('\0')||name.split(/[\\/]/).some(p=>p==='..')||((entry.externalFileAttributes>>>16)&0xf000)===0xa000) throw new Error('Prototype contains unsafe paths or symbolic links.')
      if (name.startsWith('__MACOSX/')||name.split('/').includes('.DS_Store')) {zip.readEntry();return}
      const target=path.resolve(destination,name)
      if (!target.startsWith(path.resolve(destination)+path.sep)) throw new Error('Unsafe prototype path.')
      if (name.endsWith('/')) await fs.mkdir(target,{recursive:true})
      else {
        await fs.mkdir(path.dirname(target),{recursive:true})
        signal?.throwIfAborted()
        const stream=await new Promise<Readable>((r,j)=>zip.openReadStream(entry,(e,s)=>e||!s?j(e||new Error('Unreadable ZIP entry.')):r(s)))
        activeStream=stream
        let bytes=0,checksum=0
        await pipeline(stream,new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;checksum=crc32.unsigned(chunk,checksum);callback(bytes>MAX_BYTES?new Error('Prototype file too large.'):null,chunk)}}),createWriteStream(target,{flags:'wx',mode:0o600}),{signal})
        if(checksum!==entry.crc32)throw new Error('The prototype ZIP is damaged. Export it again and retry.')
      }
      signal?.throwIfAborted()
      progress?.(count,zip.entryCount,name)
      zip.readEntry()
    })();void entryWork.catch(fail).finally(()=>{activeStream=undefined;entryWork=undefined})})
    zip.readEntry()
  })
}

export async function prototypePages(root:string):Promise<string[]> {
  const result:string[]=[]
  async function walk(folder:string){for(const item of await fs.readdir(folder,{withFileTypes:true})){
    if (item.name.startsWith('.')||['node_modules','__MACOSX'].includes(item.name)) continue
    const file=path.join(folder,item.name)
    if(item.isDirectory())await walk(file)
    else if(item.isFile()&&/\.html?$/i.test(item.name))result.push(path.relative(root,file).split(path.sep).map(encodeURIComponent).join('/'))
  }}
  await walk(root)
  return result.sort((a,b)=>Number(!/(^|\/)index\.html?$/.test(a))-Number(!/(^|\/)index\.html?$/.test(b))||a.localeCompare(b))
}

export async function servePrototype(folder:string) {
  const existing=servers.get(folder);if(existing)return existing.url
  const root=await fs.realpath(path.join(folder,'prototype'))
  const pages=await prototypePages(root)
  if(!pages.length)throw new Error('No runnable HTML was found. Export a standalone HTML artifact or a ZIP containing HTML and assets. Source-only React projects need a running app.')
  // Serve a single wrapper folder as the site root so /assets links work.
  const common=pages.every(p=>p.startsWith(pages[0].split('/')[0]+'/'))?pages[0].split('/')[0]:''
  const siteRoot=common?path.join(root,decodeURIComponent(common)):root
  const home=pages[0].slice(common?common.length+1:0)
  const server=http.createServer((req,res)=>{void(async()=>{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
    const pathname=decodeURIComponent(new URL(req.url||'/', 'http://localhost').pathname)
    let target=path.resolve(siteRoot,'.'+(pathname==='/'?'/'+home:pathname))
    if(!target.startsWith(siteRoot+path.sep))throw new Error('Invalid path')
    let stat=await fs.stat(target)
    if(stat.isDirectory()){target=path.join(target,'index.html');stat=await fs.stat(target)}
    const real=await fs.realpath(target)
    if(!real.startsWith(siteRoot+path.sep)||!stat.isFile())throw new Error('Invalid file')
    res.setHeader('Content-Type',mime[path.extname(target).toLowerCase()]||'application/octet-stream')
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store')
    res.setHeader('Content-Security-Policy',"object-src 'none'; frame-src 'none'; base-uri 'self'")
    if(req.method==='HEAD')res.end();else res.end(await fs.readFile(real))
  })().catch(()=>{res.writeHead(404);res.end('Prototype file unavailable')})})
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  server.unref()
  const address=server.address() as import('node:net').AddressInfo
  const url=`http://127.0.0.1:${address.port}/`
  servers.set(folder,{url,server})
  return url
}
export async function managedPrototypeRoutes(folder:string){
  const pages=await prototypePages(path.join(folder,'prototype'))
  const common=pages.length&&pages.every(p=>p.startsWith(pages[0].split('/')[0]+'/'))?pages[0].split('/')[0]:''
  return pages.map(p=>'/'+p.slice(common?common.length+1:0))
}
