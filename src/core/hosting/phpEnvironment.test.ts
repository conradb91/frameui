import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const {configureLocalUrlEnvironment, readEnvironment, readEffectiveEnvironment, stackerLocalEnvironment} = require('../../../hosting/stacker/lib/environment.cjs')

test('Laravel gets a stable private encryption key when none is configured', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-laravel-env-'))
  const project = {path:root, framework:{id:'laravel'},localDomain:'budget.localhost',envFiles:['.env']}
  try {
    await fs.writeFile(path.join(root,'.env'), 'APP_KEY=\nAPP_LABEL=Original\n')
    await configureLocalUrlEnvironment(project)
    const key = stackerLocalEnvironment(project).APP_KEY
    expect(key).toMatch(/^base64:/)
    expect(Buffer.from(key.slice(7),'base64').length).toBe(32)
    await configureLocalUrlEnvironment(project)
    expect(stackerLocalEnvironment(project).APP_KEY).toBe(key)
    expect(await fs.readFile(path.join(root,'.env'),'utf8')).toBe('APP_KEY=\nAPP_LABEL=Original\n')
    const environment = await readEnvironment({...project,envFiles:['.env','.env.stacker.local']},'.env.stacker.local')
    expect(environment.variables.find((item:{key:string})=>item.key==='APP_KEY').secret).toBe(true)
  } finally { await fs.rm(root,{recursive:true,force:true}) }
})

test('Laravel preserves an existing application encryption key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-laravel-key-'))
  const project = {path:root, framework:{id:'laravel'},localDomain:'budget.localhost',envFiles:['.env']}
  try {
    await fs.writeFile(path.join(root,'.env'), 'APP_KEY=existing-key\n')
    await configureLocalUrlEnvironment(project)
    await configureLocalUrlEnvironment({...project,envFiles:['.env.stacker.local','.env']})
    expect(stackerLocalEnvironment(project).APP_KEY).toBeUndefined()
    const effective = await readEffectiveEnvironment({...project,envFiles:['.env','.env.stacker.local']})
    expect(effective.variables.find((item:{key:string})=>item.key==='APP_KEY').value).toBe('existing-key')
    expect(await fs.readFile(path.join(root,'.env'),'utf8')).toBe('APP_KEY=existing-key\n')
  } finally { await fs.rm(root,{recursive:true,force:true}) }
})
