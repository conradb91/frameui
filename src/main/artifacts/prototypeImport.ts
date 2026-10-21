import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'
import type { ZipFile, Entry } from 'yauzl'

const servers = new Map<string, { url: string; server: http.Server }>()
const mime: Record<string,string> = {'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon'}

/** Data-only extraction. Never installs packages or executes archive commands. */
export async function unpackPrototype(file: string, destination: string, signal?:AbortSignal, progress?:(completed:number,total:number,file:string)=>void) {
  signal?.throwIfAborted()
  await fs.mkdir(destination, {recursive:true})
  if (/\.html?$/i.test(file)) { await fs.copyFile(file,path.join(destination,path.basename(file))); signal?.throwIfAborted();progress?.(1,1,path.basename(file)); return }
  if (!/\.zip$/i.test(file)) throw new Error('Choose an HTML file or ZIP prototype.')
  const yauzl = createRequire(__filename)('yauzl') as typeof import('yauzl')
  const crc32=createRequire(__filename)('buffer-crc32') as {unsigned(data:Buffer,previous?:number):number}
  // yauzl validates decoded names and actual streamed sizes, in addition to our limits.
  const zip = await new Promise<ZipFile>((resolve,reject)=>yauzl.open(file,{lazyEntries:true,strictFileNames:true},(e,z)=>e||!z?reject(e||new Error('Invalid ZIP prototype.')):resolve(z)))
  let count=0
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
      count++
      if (/^[\\/]|^[A-Za-z]:/.test(name)||name.includes('\0')||name.split(/[\\/]/).some(p=>p==='..')||((entry.externalFileAttributes>>>16)&0xf000)===0xa000) throw new Error('Prototype contains unsafe paths or symbolic links.')
      if(name.toLowerCase()===SOURCES_FILE)throw new Error('Prototype contains a reserved import metadata file.')
      if (name.startsWith('__MACOSX/')||name.split('/').includes('.DS_Store')) {zip.readEntry();return}
      const target=path.resolve(destination,name)
      if (!target.startsWith(path.resolve(destination)+path.sep)) throw new Error('Unsafe prototype path.')
      if (name.endsWith('/')) await fs.mkdir(target,{recursive:true})
      else {
        await fs.mkdir(path.dirname(target),{recursive:true})
        signal?.throwIfAborted()
        const stream=await new Promise<Readable>((r,j)=>zip.openReadStream(entry,(e,s)=>e||!s?j(e||new Error('Unreadable ZIP entry.')):r(s)))
        activeStream=stream
        let checksum=0
        await pipeline(stream,new Transform({transform(chunk,_encoding,callback){checksum=crc32.unsigned(chunk,checksum);callback(null,chunk)}}),createWriteStream(target,{flags:'wx',mode:0o600}),{signal})
        if(checksum!==entry.crc32)throw new Error('The prototype ZIP is damaged. Export it again and retry.')
      }
      signal?.throwIfAborted()
      progress?.(count,zip.entryCount,name)
      zip.readEntry()
    })();void entryWork.catch(fail).finally(()=>{activeStream=undefined;entryWork=undefined})})
    zip.readEntry()
  })
}

interface PrototypeSource {prefix:string;root:string;home:string}
const SOURCES_FILE='frameui-import-sources.json'
/** Isolated source roots prevent two archives' index.html/assets from overwriting each other. */
export async function unpackPrototypes(files:string[],destination:string,signal?:AbortSignal,progress?:(completed:number,total:number,detail:string,file:string)=>void){
 const unique=[...new Set(files)],warnings:string[]=[]
 if(!unique.length)throw new Error('Select HTML or ZIP files to import.')
 if(unique.length===1){await unpackPrototype(unique[0],destination,signal,(done,total,detail)=>progress?.(done,total,detail,unique[0]));return {warnings}}
 const groups=new Map<string,string[]>()
 for(const file of unique){const key=/\.zip$/i.test(file)?file:path.dirname(file);groups.set(key,[...groups.get(key)??[],file])}
 const sources:PrototypeSource[]=[]
 let index=0,completed=0
 for(const group of groups.values()){
  const prefix='source-'+(++index),folder=path.join(destination,prefix)
  let successful=0
  for(const file of group){
   signal?.throwIfAborted()
   try{await unpackPrototype(file,folder,signal,(_done,_total,detail)=>progress?.(completed,unique.length,detail,file));successful++}
   catch(error){signal?.throwIfAborted();warnings.push(path.basename(file)+': '+(error instanceof Error?error.message:String(error)));if(/\.zip$/i.test(file))await fs.rm(folder,{recursive:true,force:true});else await fs.rm(path.join(folder,path.basename(file)),{force:true})}
   progress?.(++completed,unique.length,path.basename(file),file)
  }
  if(!successful)continue
  const pages=await prototypePages(folder);if(!pages.length){warnings.push(path.basename(group[0])+': No runnable HTML found.');continue}
  const common=pages.every(p=>p.startsWith(pages[0].split('/')[0]+'/'))?decodeURIComponent(pages[0].split('/')[0]):''
  sources.push({prefix,root:common,home:pages[0].slice(common?encodeURIComponent(common).length+1:0)})
 }
 if(!sources.length)throw new Error('No selected files could be imported. '+warnings.join(' '))
 await fs.writeFile(path.join(destination,SOURCES_FILE),JSON.stringify({version:1,sources}))
 return {warnings}
}

async function prototypeSources(root:string):Promise<PrototypeSource[]>{
 try{const value=JSON.parse(await fs.readFile(path.join(root,SOURCES_FILE),'utf8'));if(value.version!==1||!Array.isArray(value.sources)||value.sources.some((s:PrototypeSource)=>!/^source-\d+$/.test(s.prefix)||typeof s.root!=='string'||s.root.split(/[\\/]/).some(p=>p==='..'||p==='.')||path.isAbsolute(s.root)||typeof s.home!=='string'))throw new Error('Invalid prototype source metadata.');return value.sources as PrototypeSource[]}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
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
  const pages=await prototypePages(root),sources=await prototypeSources(root)
  if(!pages.length)throw new Error('No runnable HTML was found. Export a standalone HTML artifact or a ZIP containing HTML and assets. Source-only React projects need a running app.')
  // Serve a single wrapper folder as the site root so /assets links work.
  const common=!sources.length&&pages.every(p=>p.startsWith(pages[0].split('/')[0]+'/'))?pages[0].split('/')[0]:''
  const siteRoot=common?path.join(root,decodeURIComponent(common)):root
  const home=pages[0].slice(common?common.length+1:0)
  const server=http.createServer((req,res)=>{void(async()=>{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
    const requestUrl=new URL(req.url||'/', 'http://localhost'),pathname=decodeURIComponent(requestUrl.pathname)
    let source=sources.find(s=>pathname==='/'+s.prefix||pathname.startsWith('/'+s.prefix+'/'))
    if(sources.length&&!source){
      let referring='';try{referring=new URL(req.headers.referer||'').pathname}catch{}
      source=sources.find(s=>referring.startsWith('/'+s.prefix+'/'))??sources.find(s=>req.headers.cookie?.split(';').some(c=>c.trim()==='frameui-source='+s.prefix))??(pathname==='/'?sources[0]:undefined)
      if(!source)throw new Error('Select a prototype source')
      res.writeHead(302,{Location:'/'+source.prefix+(pathname==='/'?'/'+source.home:requestUrl.pathname)+requestUrl.search});res.end();return
    }
    const activeRoot=source?path.join(root,source.prefix,source.root):siteRoot
    const relative=source?pathname.slice(source.prefix.length+1):pathname
    let target=path.resolve(activeRoot,'.'+(!relative||relative==='/'?'/'+(source?.home??home):relative))
    if(!target.startsWith(activeRoot+path.sep))throw new Error('Invalid path')
    let stat;try{stat=await fs.stat(target)}catch(error){if(!path.extname(pathname)&&req.headers.accept?.includes('text/html')){target=path.resolve(activeRoot,source?.home??home);stat=await fs.stat(target)}else throw error}
    if(stat.isDirectory()){target=path.join(target,'index.html');stat=await fs.stat(target)}
    const real=await fs.realpath(target)
    if(!real.startsWith(activeRoot+path.sep)||!stat.isFile())throw new Error('Invalid file')
    if(source&&/\.html?$/i.test(real))res.setHeader('Set-Cookie','frameui-source='+source.prefix+'; Path=/; SameSite=Strict')
    res.setHeader('Content-Type',mime[path.extname(target).toLowerCase()]||'application/octet-stream')
    res.setHeader('Content-Length',stat.size)
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store')
    res.setHeader('Content-Security-Policy',"object-src 'none'; frame-src 'self'; base-uri 'self'")
    if(req.method==='HEAD')res.end();else await pipeline(createReadStream(real),res)
  })().catch(()=>{if(res.headersSent)res.destroy();else{res.writeHead(404);res.end('Prototype file unavailable')}})})
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  server.unref()
  const address=server.address() as import('node:net').AddressInfo
  const url=`http://127.0.0.1:${address.port}/`
  servers.set(folder,{url,server})
  return url
}
/** Removed projects must not retain listening prototype servers. */
export function stopPrototype(folder:string){
 const running=servers.get(folder);if(!running)return
 servers.delete(folder);running.server.closeAllConnections();running.server.close()
}
export async function managedPrototypeRoutes(folder:string){
  const root=path.join(folder,'prototype'),sources=await prototypeSources(root)
  if(sources.length){const routes:string[]=[];for(const source of sources)for(const page of await prototypePages(path.join(root,source.prefix,source.root)))routes.push('/'+source.prefix+'/'+page);return routes}
  const pages=await prototypePages(root)
  const common=pages.length&&pages.every(p=>p.startsWith(pages[0].split('/')[0]+'/'))?pages[0].split('/')[0]:''
  return pages.map(p=>'/'+p.slice(common?common.length+1:0))
}
