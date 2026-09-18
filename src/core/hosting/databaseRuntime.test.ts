import {test,expect} from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
const {publishRuntime,validRuntime}=createRequire(import.meta.url)('../../../hosting/stacker/lib/database-runtime-manager.cjs')
test('runtime publication rolls back a failed replacement and publishes a complete replacement',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-db-publication-'))
  const target=path.join(root,'runtime'),staging=path.join(root,'staging')
  try {
    await fs.mkdir(target);await fs.writeFile(path.join(target,'binary'),'previous')
    await expect(publishRuntime(staging,target)).rejects.toThrow()
    expect(await fs.readFile(path.join(target,'binary'),'utf8')).toBe('previous')
    await fs.mkdir(staging);await fs.writeFile(path.join(staging,'binary'),'replacement')
    await publishRuntime(staging,target)
    expect(await fs.readFile(path.join(target,'binary'),'utf8')).toBe('replacement')
    expect(await fs.readdir(root)).toEqual(['runtime'])
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
test('cached runtimes must execute and report the exact approved version',async()=>{
  expect(await validRuntime(process.execPath,process.versions.bun)).toBe(true)
  expect(await validRuntime(process.execPath,'999.0.0')).toBe(false)
  expect(await validRuntime(path.join(os.tmpdir(),'frameui-no-such-runtime'),'1.0.0')).toBe(false)
})
