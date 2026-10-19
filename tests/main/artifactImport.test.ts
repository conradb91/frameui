import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { unpackPrototype, prototypePages, servePrototype } from '../../src/main/artifacts/prototypeImport'
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
