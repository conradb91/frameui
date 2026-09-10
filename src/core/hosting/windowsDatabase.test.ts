import {test,expect} from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {WindowsDatabaseRuntime}=require('../../../hosting/stacker/lib/windows-database-runtime.cjs')
test('Windows databases require a complete architecture-specific cache and preserve other platforms',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-win-db-'))
 try{
  const runtime=new WindowsDatabaseRuntime(root,()=>{},'x64')
  const entry=runtime.catalog('postgres')[0]
  expect(entry.url).toStartWith('https://get.enterprisedb.com/')
  expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/)
  const bin=path.join(root,'databases/win32/postgres',entry.version,'x64/bin');await fs.mkdir(bin,{recursive:true})
  await fs.writeFile(path.join(bin,entry.executable),'incomplete')
  expect(runtime.binDir('postgres')).toBeNull()
  expect(runtime.installedVersions('postgres')).toEqual([])
  for(const name of entry.requiredExecutables)await fs.writeFile(path.join(bin,name),'fixture')
  expect(runtime.binDir('postgres')).toMatchObject({dir:bin,version:entry.version})
  expect(new WindowsDatabaseRuntime(root,()=>{},'arm64').catalog('postgres')).toEqual([])
  const mac=path.join(root,'postgres',entry.version);await fs.mkdir(mac,{recursive:true})
  await runtime.remove('postgres',entry.version)
  expect(await fs.stat(mac).then(()=>true)).toBe(true)
  await expect(runtime.remove('postgres','../../')).rejects.toThrow('Unknown')
 }finally{await fs.rm(root,{recursive:true,force:true})}
})
