import {test,expect} from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {createRequire} from 'node:module'
const {installLocalCrt}=createRequire(import.meta.url)('../../../hosting/stacker/lib/windows-crt.cjs')
test('app-local Windows CRT checks every DLL before writing and rejects corruption',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-crt-'));const payload=path.join(root,'x64'),destination=path.join(root,'php')
 try{
  await fs.mkdir(payload);await fs.mkdir(destination)
  const bytes=Buffer.alloc(128);bytes.write('MZ');bytes.writeUInt32LE(80,60);bytes.writeUInt32LE(0x4550,80);bytes.writeUInt16LE(0x8664,84)
  const names=['vcruntime140.dll','msvcp140.dll'];const files=Object.fromEntries(names.map(name=>[name,crypto.createHash('sha256').update(bytes).digest('hex')]))
  for(const name of names)await fs.writeFile(path.join(payload,name),bytes)
  await fs.writeFile(path.join(payload,'manifest.json'),JSON.stringify({architecture:'x64',files}))
  await fs.writeFile(path.join(payload,names[1]),'corrupt')
  await expect(installLocalCrt(destination,'x64',root)).rejects.toThrow('integrity')
  expect(await fs.readdir(destination)).toHaveLength(0)
  await fs.writeFile(path.join(payload,names[1]),bytes)
  expect(await installLocalCrt(destination,'x64',root)).toBe(true)
  expect((await fs.readdir(destination)).sort()).toEqual(names.sort())
 }finally{await fs.rm(root,{recursive:true,force:true})}
})
test('missing app-local CRT payload is reported without writing files',async()=>{
 expect(await installLocalCrt('/unused','x64',path.join(os.tmpdir(),'frameui-no-crt-payload'))).toBe(false)
})
