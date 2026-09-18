import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { indexProject } from '../indexer/indexProject'
import { registerSourceAdapter } from './registry'
import { discoverApplications } from '../indexer/projectCapabilities'
import { isRelevantProjectPath } from '../indexer/ignore'
import { ProjectIndexService } from '../indexer/projectIndexService'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-adapter-')); roots.push(root)
  for (const [file, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content) }
  return root
}
const pkg = (dependencies: Record<string, string>) => JSON.stringify({ dependencies })
const webProject = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'

describe('framework-neutral imports', () => {
  test('composes React and Razor into the same model with styles and assets', () => {
    const root = fixture({
      'package.json': pkg({ react: '18', vite: '5', bootstrap: '5' }), 'Server.csproj': webProject,
      'src/pages/Home.tsx': 'export default function Home(){ return <main>React home</main> }',
      'Pages/Index.cshtml': '@page\n<main><h1>Razor home</h1></main>',
      'Views/Shared/_Layout.cshtml': '<html><body>@RenderBody()</body></html>',
      'wwwroot/site.css': ':root { --color-brand: #ff0000; }', 'src/card.module.scss': '$color-brand: #123456;\n$breakpoint-tablet: 48rem;\n.card { color: red; }\n@media (min-width: 80rem) { .card { display: grid; } }',
      'wwwroot/logo.svg': '<svg />', 'wwwroot/font.woff2': 'fixture', 'obj/Generated.razor': '@page "/generated"\n<p>Ignore</p>',
    })
    const index = indexProject('mixed', root)
    expect(index.adapterIds).toContain('react'); expect(index.adapterIds).toContain('dotnet')
    expect(index.projectModel.pages.map((page) => page.source.filePath)).toEqual(expect.arrayContaining(['src/pages/Home.tsx', 'Pages/Index.cshtml']))
    expect(index.projectModel.pages.every((page) => page.structure.length > 0)).toBe(true)
    expect(index.projectModel.pages.some((page) => page.source.filePath.includes('Generated'))).toBe(false)
    expect(index.projectModel.assets.map((asset) => asset.kind)).toEqual(expect.arrayContaining(['icon', 'font']))
    expect(index.projectModel.styles).toHaveLength(2)
    expect(index.projectModel.tokens.map((token) => token.value)).toEqual(expect.arrayContaining(['#123456', '48rem', '80rem']))
    expect(index.technologies?.map((item) => item.id)).toEqual(expect.arrayContaining(['aspnet-core', 'razor-pages', 'css-modules', 'scss', 'bootstrap', 'vite']))
  })

  test('Blazor pages, components and constrained routes use the common structure', () => {
    const root = fixture({ 'Web.csproj': webProject, 'Program.cs': 'builder.Services.AddInteractiveServerComponents();',
      'Components/Pages/Orders.razor': '@page "/orders/{id:int}"\n@using System\n<main><OrderCard /><h1>Orders</h1></main>\n@code { string fake = "<div>not UI</div>"; }',
      'Components/OrderCard.razor': '<article>Order</article>', 'Components/Layout/MainLayout.razor': '@inherits LayoutComponentBase\n<section>@Body</section>' })
    const index = indexProject('blazor', root)
    const page = index.projectModel.pages[0]
    expect(page.route).toBe('/orders/:id')
    expect(page.componentNames).toContain('OrderCard')
    expect(page.structure[0].children[0].sourceFilePath).toBe('Components/OrderCard.razor')
    expect(page.structure).toHaveLength(1)
    expect(index.technologies?.map((item) => item.id)).toContain('blazor-server')
    expect(index.devCommand?.command).toBe('dotnet')
  })

  test('Razor Pages append relative templates and MVC views do not invent URLs', () => {
    const root = fixture({ 'Web.csproj': webProject, 'Pages/Orders/Details.cshtml': '@page "{id:int}"\n<main>Details</main>', 'Views/Home/Index.cshtml': '<main>MVC</main>' })
    const pages = indexProject('razor', root).projectModel.pages
    expect(pages.find((page) => page.source.filePath.startsWith('Pages'))?.route).toBe('/Orders/Details/:id')
    expect(pages.find((page) => page.source.filePath.startsWith('Views'))?.route).toBeNull()
  })

  test('Angular imports external and inline templates and selector relationships', () => {
    const root = fixture({ 'package.json': pkg({ '@angular/core': '20' }),
      'src/app/home.ts': "@Component({selector: 'app-home', templateUrl: './home.html'}) export class Home {}",
      'src/app/home.html': '<main><app-card /><h1>Angular</h1></main>',
      'src/app/card.ts': "@Component({selector: 'app-card', template: `<article>Card</article>`}) export class Card {}",
      'src/app/inline.ts': "@Component({selector: 'app-inline', template: `<section>Inline</section>`}) export class Inline {}",
      'src/app/lazy.ts': "@Component({selector: 'app-lazy', template: `<main>Lazy</main>`}) export class Lazy {}",
      'src/app/app.routes.ts': "export const routes = [{path: '', component: Home}, {path: 'admin', children: [{path: 'inline', component: Inline}]}, {path: 'lazy', loadComponent: () => import('./lazy').then(m => m.Lazy)}]" })
    const index = indexProject('angular', root)
    expect(index.framework).toBe('angular')
    expect(index.projectModel.pages.find((page) => page.route === '/lazy')?.structure[0].textPreview).toBe('Lazy')
    expect(index.projectModel.pages).toHaveLength(3)
    expect(index.projectModel.pages.find((page) => page.route === '/')?.componentNames).toContain('app-card')
    expect(index.projectModel.pages.find((page) => page.route === '/admin/inline')?.structure[0].tagName).toBe('section')
  })

  test('Laravel and Vue contribute independently', () => {
    const root = fixture({ 'package.json': pkg({ vue: '3' }), 'composer.json': JSON.stringify({ require: { 'laravel/framework': '11' } }),
      'resources/views/home.blade.php': '<main>Laravel</main>', 'src/pages/Dashboard.vue': '<template><main>Vue</main></template>' })
    const index = indexProject('laravel-vue', root)
    expect(index.projectModel.pages.map((page) => page.source.filePath)).toEqual(expect.arrayContaining(['resources/views/home.blade.php', 'src/pages/Dashboard.vue']))
    expect(index.technologies?.map((item) => item.id)).toEqual(expect.arrayContaining(['laravel', 'vue']))
  })

  test.each([
    ['Nuxt', { nuxt: '4' }, 'app/pages/index.vue', '<template><main>Nuxt</main></template>', 'nuxt'],
    ['SvelteKit', { '@sveltejs/kit': '2' }, 'src/routes/(app)/+page.svelte', '<main>Svelte</main>', 'sveltekit'],
    ['Astro', { astro: '5' }, 'src/pages/index.astro', '---\nconst title = "Home"\n---\n<main>Astro</main>', 'astro'],
    ['Next', { react: '19', next: '15' }, 'app/page.tsx', 'export default function Page(){return <main>Next</main>}', 'nextjs'],
    ['Express', { express: '5' }, 'views/index.ejs', '<main>Express</main>', 'express'],
    ['Vue', { vue: '3' }, 'src/pages/index.vue', '<template><main>Vue</main></template>', 'vue'],
    ['Svelte', { svelte: '5' }, 'src/pages/index.svelte', '<main>Svelte</main>', 'svelte'],
    ['Vite', { vite: '5', typescript: '5' }, 'index.html', '<main>Vanilla</main>', 'vite'],
  ] as const)('%s uses the common model', (_label, dependencies, file, content, technology) => {
    const root = fixture({ 'package.json': pkg(dependencies), [file]: content })
    const index = indexProject('fixture', root)
    expect(index.projectModel.pages.some((page) => page.structure[0]?.tagName === 'main')).toBe(true)
    expect(index.technologies?.map((item) => item.id)).toContain(technology)
  })

  test('discovers .NET backends and nested frontends as selectable applications', () => {
    const root = fixture({ 'Server/Web.csproj': webProject, 'Server/Pages/Index.cshtml': '@page\n<main>Server</main>',
      'Server/ClientApp/package.json': pkg({ react: '18' }), 'Server/ClientApp/src/pages/Home.tsx': 'export default function Home(){return <main>Client</main>}' })
    expect(discoverApplications(root).map((app) => app.rootPath)).toEqual(['Server', 'Server/ClientApp'])
  })

  test('a new adapter adds scanning and rendering without a canvas or format change', () => {
    const root = fixture({ 'home.exampleui': 'Hello adapter' })
    const remove = registerSourceAdapter({ id: 'exampleui', extensions: ['.exampleui'], ownsFile: (file) => file.endsWith('.exampleui'),
      detect: (ctx) => ctx.candidateFiles.some((file) => file.endsWith('.exampleui')) ? { framework: 'exampleui', phpFramework: null, bundler: 'unknown', routerStyle: 'example-routes', routesDir: null, devCommand: null } : null,
      findPages: () => [{ id: 'home', name: 'Home', filePath: 'home.exampleui', route: '/' }], findComponents: () => [],
      readStructure: (content, file) => file.endsWith('.exampleui') ? [{ tagName: 'main', isKnownComponent: false, children: [], textPreview: content }] : null })
    try {
      const model = indexProject('extension', root).projectModel
      expect(model.version).toBe(1)
      expect(isRelevantProjectPath(root, path.join(root, 'home.exampleui'))).toBe(true)
      expect(model.pages[0].structure[0].textPreview).toBe('Hello adapter')
    } finally { remove() }
  })

  test('Blazor WebAssembly and explicit layout references are detected', () => {
    const root = fixture({ 'Client.csproj': '<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly" />',
      'Pages/Home.razor': '@page "/"\n@layout MainLayout\n<main>Home</main>',
      'Shared/MainLayout.razor': '<section>@Body</section>' })
    const index = indexProject('wasm', root)
    expect(index.technologies?.map((item) => item.id)).toContain('blazor-webassembly')
    expect(index.projectModel.sourceRelationships).toContainEqual({ sourceFile: 'Pages/Home.razor', targetFile: 'Shared/MainLayout.razor', kind: 'layout' })
    expect(index.dependencyGraph?.dependents['Shared/MainLayout.razor']).toContain('Pages/Home.razor')
  })

  test('reimports retain the selected application and its runtime metadata', () => {
    const root = fixture({ 'A/App.csproj': webProject, 'A/Pages/Home.razor': '@page "/a"\n<main>A</main>',
      'B/App.csproj': webProject, 'B/Pages/Home.razor': '@page "/b"\n<main>B</main>' })
    const data = fixture({})
    const service = new ProjectIndexService(data, 'selection', root)
    const index = service.load()
    const app = index.applications!.find((item) => item.rootPath === 'B')!
    service.selectApplication(app.id)
    fs.writeFileSync(path.join(root, 'B/Pages/Home.razor'), '@page "/updated"\n<main>Updated B</main>')
    const updated = service.update([{ path: 'B/Pages/Home.razor', kind: 'modified' }])
    expect(updated.activeApplicationId).toBe(app.id)
    expect(updated.projectModel.pages[0].route).toBe('/updated')
    expect(updated.devCommand?.workingDirectory).toBe('B')
  })

  test('reopening a changed Razor page refreshes routes and structure', () => {
    const root = fixture({ 'App.csproj': webProject, 'Pages/Home.razor': '@page "/old"\n<h1>Old</h1>' })
    const data = fixture({})
    new ProjectIndexService(data, 'cache', root).load()
    fs.writeFileSync(path.join(root, 'Pages/Home.razor'), '@page "/new"\n<h1>New</h1>')
    const model = new ProjectIndexService(data, 'cache', root).load().projectModel
    expect(model.pages[0].route).toBe('/new')
    expect(model.pages[0].structure[0].textPreview).toBe('New')
  })
})
