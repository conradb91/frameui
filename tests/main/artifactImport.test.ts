import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { unpackPrototype, unpackPrototypes, managedPrototypeRoutes, stopPrototype, prototypePages, servePrototype } from '../../src/main/artifacts/prototypeImport'
import { createStoredZip } from '../../src/main/export/storedZip'
import { artifactFlow } from '../../src/core/prototype/artifactFlow'
import { prototypeSchema } from '../../src/core/prototype/schema'

test('ZIP import keeps nested assets, serves wrapper root, and refuses traversal',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-artifact-test-'))
 try{
  const file=path.join(root,'demo.zip'),folder=path.join(root,'project')
  await fs.writeFile(file,createStoredZip([{path:'demo/index.html',data:Buffer.from('<h1>Prototype</h1>')},{path:'demo/settings.html',data:Buffer.from('<h1>Settings</h1>')},{path:'demo/assets/app.css',data:Buffer.from('body{color:red}') }]))
  await unpackPrototype(file,path.join(folder,'prototype'))
  expect(await prototypePages(path.join(folder,'prototype'))).toEqual(['demo/index.html','demo/settings.html'])
  const url=await servePrototype(folder)
  expect(await (await fetch(url)).text()).toContain('Prototype')
  expect(await (await fetch(new URL('/assets/app.css',url))).text()).toContain('color:red')
  expect((await fetch(new URL('/frameui-artifact.json',url))).status).toBe(404)
  expect((await fetch(url,{method:'POST'})).status).toBe(405)
  expect(await servePrototype(folder)).toBe(url)
  await fs.writeFile(file,createStoredZip([{path:'../escape.html',data:Buffer.from('unsafe')}]))
  await expect(unpackPrototype(file,path.join(root,'unsafe'))).rejects.toThrow()
  expect(await fs.stat(path.join(root,'escape.html')).catch(()=>null)).toBeNull()
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('only real captured elements receive observed prototype connections',()=>{
 const pages:any[]=[{id:'a',route:'/index.html',structured:{children:[{id:'button',source:{selector:'html>body:nth-child(2)>button:nth-child(1)'},children:[]}]}},{id:'b',route:'/settings.html',structured:{children:[]}}]
 const prototype=artifactFlow(pages,[{source:'/index.html',destination:'/settings.html',selector:'html>body:nth-child(2)>button:nth-child(1)',label:'Settings'},{source:'/index.html',destination:'/missing',selector:'missing',label:'No match'}],'Demo')
 expect(prototype.interactions).toHaveLength(1)
 expect(prototype.interactions[0].sourceElementId).toBe('button')
 expect(prototypeSchema.safeParse(prototype).success).toBe(true)
})

test('damaged ZIPs and ZIP symlinks cannot be imported',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-artifact-invalid-'))
 try{
  const file=path.join(root,'bad.zip')
  const data=createStoredZip([{path:'index.html',data:Buffer.from('<h1>Prototype</h1>')}])
  const damaged=Buffer.from(data);damaged[40]^=1
  await fs.writeFile(file,damaged)
  await expect(unpackPrototype(file,path.join(root,'damaged'))).rejects.toThrow()
  const link=Buffer.from(data),central=link.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]))
  link.writeUInt32LE((0xa000<<16)>>>0,central+38)
  await fs.writeFile(file,link)
  await expect(unpackPrototype(file,path.join(root,'symlink'))).rejects.toThrow()
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('ZIP extraction reports file progress and honours cancellation before writing more files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-artifact-stop-'))
 try{
  const file=path.join(root,'cancel.zip'),controller=new AbortController(),updates:number[]=[]
  await fs.writeFile(file,createStoredZip(Array.from({length:20},(_,i)=>({path:`page-${i}.html`,data:Buffer.from('<h1>Page</h1>')}))))
  await expect(unpackPrototype(file,path.join(root,'out'),controller.signal,(completed)=>{updates.push(completed);if(completed===1)controller.abort(new Error('Import stopped'))})).rejects.toThrow('Import stopped')
  expect(updates.length).toBeGreaterThan(0)
  expect(await fs.stat(path.join(root,'out','page-19.html')).catch(()=>null)).toBeNull()
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('multiple HTML and ZIP files retain separate asset roots and sibling HTML links',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-multiple-prototypes-'))
 try{
 const folder=path.join(root,'project'),html=path.join(root,'intro.html'),sibling=path.join(root,'details.html'),first=path.join(root,'first.zip'),second=path.join(root,'second.zip')
 await fs.writeFile(html,'<h1>Intro</h1><a href="details.html">Details</a>');await fs.writeFile(sibling,'<h1>Details</h1>')
 for(const [file,name] of [[first,'First'],[second,'Second']])await fs.writeFile(file,createStoredZip([{path:'wrapper/index.html',data:Buffer.from(`<h1>${name}</h1><link rel="stylesheet" href="/assets/theme.css">`)},{path:'wrapper/assets/theme.css',data:Buffer.from(`/* ${name} */`)},{path:'wrapper/settings.html',data:Buffer.from(`<h1>${name} settings</h1>`)}]))
 await unpackPrototypes([html,sibling,first,second],path.join(folder,'prototype'))
 const routes=await managedPrototypeRoutes(folder);expect(routes).toHaveLength(6)
 expect(routes).toContain('/source-1/intro.html');expect(routes).toContain('/source-1/details.html');expect(routes).toContain('/source-2/index.html');expect(routes).toContain('/source-3/index.html')
 const url=await servePrototype(folder)
 for(const [prefix,name] of [['source-2','First'],['source-3','Second']]){
 const home=await fetch(url+prefix+'/index.html');expect(await home.text()).toContain(name)
 expect(home.headers.get('set-cookie')).toContain('frameui-source='+prefix)
 const asset=await fetch(url+'assets/theme.css',{headers:{Referer:url+prefix+'/index.html'}});expect(await asset.text()).toContain(name);expect(asset.url).toContain('/'+prefix+'/assets/theme.css')
 const link=await fetch(url+'settings.html',{headers:{Cookie:'frameui-source='+prefix}});expect(await link.text()).toContain(name+' settings')
 }
 expect(await (await fetch(url+'source-1/details.html')).text()).toContain('Details')
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

 test('closing a prototype releases its listener and a preserved project can reopen',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-prototype-close-'))
 try{await fs.mkdir(path.join(root,'prototype'));await fs.writeFile(path.join(root,'prototype/index.html'),'<h1>Preserved project</h1>');const url=await servePrototype(root);expect((await fetch(url)).ok).toBe(true);stopPrototype(root);await expect(fetch(url)).rejects.toThrow();expect(await fs.readFile(path.join(root,'prototype/index.html'),'utf8')).toContain('Preserved project');const reopened=await servePrototype(root);expect((await fetch(reopened)).ok).toBe(true);stopPrototype(root)}finally{await fs.rm(root,{recursive:true,force:true})}
})

test('missing captured destinations are reported as failed connections instead of silently complete',()=>{
 const coverage:any={version:2,complete:true,captured:1,failed:0,entries:[{state:'/a',selector:'button',label:'View',event:'click',status:'captured',destination:'/b'}]}
 const pages:any[]=[{id:'a',name:'A',route:'/a',width:800,height:600,objects:[],structured:{children:[{id:'button',source:{selector:'button'},children:[]}]}}]
 const result=artifactFlow(pages,[{source:'/a',destination:'/b',selector:'button',label:'View'}],'Demo',coverage)
 expect(result.interactions).toHaveLength(0);expect(result.coverage?.complete).toBe(false);expect(result.coverage?.captured).toBe(0);expect(result.coverage?.failed).toBe(1)
})

test('prototype import accepts more than 2,000 archive entries and more than 100 selected HTML files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-unbounded-files-'))
 try{
 const archive=path.join(root,'many.zip');await fs.writeFile(archive,createStoredZip([{path:'index.html',data:Buffer.from('<h1>Many entries</h1>')},...Array.from({length:2005},(_,i)=>({path:`assets/${i}.txt`,data:Buffer.from('asset')}))]));await unpackPrototype(archive,path.join(root,'archive'))
 expect((await fs.readdir(path.join(root,'archive/assets'))).length).toBe(2005)
 const files:string[]=[];for(let i=0;i<105;i++){const file=path.join(root,`page-${i}.html`);await fs.writeFile(file,'<h1>Page '+i+'</h1>');files.push(file)}
 const project=path.join(root,'project');await unpackPrototypes(files,path.join(project,'prototype'));expect((await managedPrototypeRoutes(project)).length).toBe(105)
 }finally{await fs.rm(root,{recursive:true,force:true})}
},30000)

test('files larger than 128 MB are copied and served as a stream',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-large-file-'))
 try{
 const file=path.join(root,'large.html'),handle=await fs.open(file,'w');await handle.write('<h1>Large prototype</h1>');await handle.truncate(129*1024*1024);await handle.close()
 const project=path.join(root,'project');await unpackPrototype(file,path.join(project,'prototype'));expect((await fs.stat(path.join(project,'prototype/large.html'))).size).toBe(129*1024*1024)
 const url=await servePrototype(project),head=await fetch(url,{method:'HEAD'});expect(Number(head.headers.get('content-length'))).toBe(129*1024*1024)
 const response=await fetch(url),reader=response.body!.getReader(),first=await reader.read();expect(new TextDecoder().decode(first.value)).toContain('Large prototype');await reader.cancel();stopPrototype(project)
 }finally{await fs.rm(root,{recursive:true,force:true})}
},30000)

test('a failed archive is reported while later valid files still import',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-partial-batch-'))
 try{
 const bad=path.join(root,'broken.zip'),good=path.join(root,'valid.html');await fs.writeFile(bad,'Not a zip');await fs.writeFile(good,'<h1>Valid page</h1>')
 const project=path.join(root,'project'),result=await unpackPrototypes([bad,good],path.join(project,'prototype'))
 expect(result.warnings).toHaveLength(1);expect(result.warnings[0]).toContain('broken.zip');expect(await managedPrototypeRoutes(project)).toEqual(['/source-2/valid.html'])
 }finally{await fs.rm(root,{recursive:true,force:true})}
})

test('large imported canvases persist more than 200 flows, 500 flow screens and 10,000 connections',()=>{
 const now=new Date().toISOString(),ids=Array.from({length:600},(_,i)=>'screen-'+i),flow={id:'flow',name:'Large flow',artboardIds:ids,positions:{},createdAt:now,updatedAt:now}
 const result=prototypeSchema.safeParse({version:1,flows:Array.from({length:205},(_,i)=>({...flow,id:'flow-'+i})),interactions:Array.from({length:10005},(_,i)=>({id:'edge-'+i,sourceArtboardId:'screen-0',destinationId:'screen-1',trigger:'click',action:'navigate'})),variables:{},scenarios:[],imports:[]})
 expect(result.success).toBe(true)
})
