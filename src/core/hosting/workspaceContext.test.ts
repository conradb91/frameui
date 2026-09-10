import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { detectProject } = require('../../../hosting/stacker/lib/detector.cjs')
const { discoverServices } = require('../../../hosting/stacker/lib/repository-adapters.cjs')
test('workspace members inherit manager, dependency root and lockfile invalidation without starting the aggregator', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'frameui-workspace-'))
  try {
    await fs.mkdir(path.join(root,'apps/web'),{recursive:true})
    await fs.mkdir(path.join(root,'node_modules'))
    await fs.writeFile(path.join(root,'package.json'),JSON.stringify({workspaces:['apps/*'],packageManager:'pnpm@10.0.0',scripts:{dev:'pnpm -r dev'}}))
    await fs.writeFile(path.join(root,'apps/web/package.json'),JSON.stringify({scripts:{dev:'vite'},dependencies:{react:'18.3.1',vite:'5.4.0'}}))
    const project=await detectProject(path.join(root,'apps/web'))
    expect(project.packageManager).toBe('pnpm')
    expect(project.dependencyRoot).toBe(root)
    expect(project.dependenciesInstalled).toBe(true)
    await fs.writeFile(path.join(root,'apps/web/.frameui-dependencies.json'),JSON.stringify({signature:project.dependencySignature}))
    await fs.writeFile(path.join(root,'pnpm-lock.yaml'),'lockfileVersion: 9.0')
    expect((await detectProject(path.join(root,'apps/web'))).dependenciesInstalled).toBe(false)
    expect((await discoverServices(root)).map((item: {relativeRoot:string})=>item.relativeRoot)).toEqual(['apps/web'])
  } finally { await fs.rm(root,{recursive:true,force:true}) }
})
test('PHP Composer preparation is not invalidated by an independent frontend lockfile', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameui-php-assets-'))
  try {
    await fs.writeFile(path.join(root,'composer.json'),JSON.stringify({require:{php:'^8.3'}}))
    await fs.writeFile(path.join(root,'index.php'),'<?php echo "Ready";')
    await fs.mkdir(path.join(root,'vendor'))
    const project=await detectProject(root)
    await fs.writeFile(path.join(root,'.frameui-dependencies.json'),JSON.stringify({signature:project.dependencySignature}))
    await fs.writeFile(path.join(root,'package-lock.json'),'{}')
    expect((await detectProject(root)).dependenciesInstalled).toBe(true)
    await fs.writeFile(path.join(root,'composer.lock'),'{}')
    expect((await detectProject(root)).dependenciesInstalled).toBe(false)
  } finally { await fs.rm(root,{recursive:true,force:true}) }
})
