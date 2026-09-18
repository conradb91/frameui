import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { discoverServices } = require('../../../hosting/stacker/lib/repository-adapters.cjs')
const { commandForRecipe } = require('../../../hosting/stacker/lib/project-recipe-engine.cjs')
async function fixture(files: Record<string,string>, run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-services-'))
  try { for (const [file, contents] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root,file)), {recursive:true}); await fs.writeFile(path.join(root,file),contents) } await run(root) }
  finally { await fs.rm(root,{recursive:true,force:true}) }
}
test('repository adapters discover React frontend and .NET backend independently', () => fixture({
  'frontend/package.json': JSON.stringify({ dependencies:{react:'18',vite:'5'},scripts:{dev:'vite'} }),
  'backend/Api.csproj':'<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
  'backend/Program.cs':'var app = WebApplication.CreateBuilder(args).Build(); app.Run();',
  'node_modules/ignored/package.json':'{"scripts":{"start":"node index.js"}}',
}, async root => {
  const services = await discoverServices(root)
  expect(services.map((s: {framework:{id:string}}) => s.framework.id)).toEqual(['react','dotnet'])
  expect(services[1].runtime).toEqual({type:'.NET',constraint:'8.0'})
  expect(commandForRecipe(services[1],'start',5123)).toEqual(['dotnet',['run','--no-restore','--no-launch-profile','--project','Api.csproj','--urls','http://127.0.0.1:5123']])
}))
test('Blazor WebAssembly detection respects pinned SDK', () => fixture({
  'UI.csproj':'<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
  'global.json':'{"sdk":{"version":"8.0.408"}}',
}, async root => { expect((await discoverServices(root))[0].runtime.constraint).toBe('8.0.408') }))
test('nested Vue and PHP services coexist', () => fixture({
  'apps/web/package.json':JSON.stringify({dependencies:{vue:'3',vite:'5'},scripts:{dev:'vite'}}),
  'services/api/composer.json':'{"require":{"php":"^8.2","codeigniter4/framework":"^4"}}',
  'services/api/spark':'<?php',
}, async root => { expect((await discoverServices(root)).map((s:{framework:{id:string}})=>s.framework.id)).toEqual(['vue','codeigniter']) }))
test('cancelled obsolete discovery cannot return services', () => fixture({'index.html':'Hello'}, async root => { const controller = new AbortController(); controller.abort(); await expect(discoverServices(root,{signal:controller.signal})).rejects.toThrow('cancelled') }))
test('remote .NET connection settings cannot be mistaken for a local database', () => fixture({
  'App.csproj':'<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
  'appsettings.json':JSON.stringify({ConnectionStrings:{Default:'Server=production.example.com;Database=Live;Password=private'}}),
}, async root => { const service = (await discoverServices(root))[0]; expect(service.databaseTarget.classification).toBe('remote'); expect(service.databaseTarget.host).toBe('production.example.com') }))

test('plain PHP does not require Composer dependencies', () => fixture({'index.php':'<?php echo "Hello";'}, async root => { const service = (await discoverServices(root))[0]; expect(service.framework.id).toBe('php'); expect(service.dependenciesInstalled).toBe(true) }))

test('a changed manifest invalidates installed dependencies before restart', () => fixture({
  'package.json': JSON.stringify({ dependencies: { react: '18', vite: '5' }, scripts: { dev: 'vite' } }),
  'node_modules/installed': 'present',
}, async root => {
  const initial = (await discoverServices(root))[0]
  expect(initial.dependenciesInstalled).toBe(true)
  await fs.writeFile(path.join(root, '.frameui-dependencies.json'), JSON.stringify({signature: initial.dependencySignature}))
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({dependencies: {react:'19',vite:'5'}, scripts: {dev:'vite'}}))
  expect((await discoverServices(root))[0].dependenciesInstalled).toBe(false)
}))
