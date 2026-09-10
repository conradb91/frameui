const { _electron: electron } = require('playwright-core')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
function desktopEnvironment() {
  const env = {...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'}
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
  return env
}
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-designer-'))
  let app
  try {
  const source = path.join(root, 'Budget'); fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'index.html'), '<main><h1>Budget overview</h1><button>New bill</button></main>')
  fs.writeFileSync(path.join(source, '.env'), 'DB_PASSWORD=original-secret\nAPP_LABEL=Original\n')
  if (process.env.FRAMEUI_SMOKE_DOTNET) {
    fs.unlinkSync(path.join(source, 'index.html')); fs.mkdirSync(path.join(source, 'Pages')); fs.writeFileSync(path.join(source, 'Pages/Index.cshtml'), '@page\n<main><h1>Budget overview</h1><button>New bill</button></main>')
    fs.writeFileSync(path.join(source, 'Budget.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>')
    fs.writeFileSync(path.join(source, 'Program.cs'), 'var builder = WebApplication.CreateBuilder(args); var app = builder.Build(); app.MapGet("/", () => Results.Content("<main><h1>Budget overview</h1><button>New bill</button></main>", "text/html")); app.Run();')
    const cached = process.env.FRAMEUI_SMOKE_SDK_ROOT || '/tmp/frameui-dotnet-audit/dotnet/darwin/x64/8.0.425'; if (fs.existsSync(cached)) { const runtime = path.join(root, 'profile/LocalEnvironment/runtimes/dotnet/darwin/x64'); fs.mkdirSync(runtime, {recursive:true}); fs.cpSync(cached, path.join(runtime, path.basename(cached)), {recursive:true}) }
  }
  if (process.env.FRAMEUI_SMOKE_VITE) {
    const vue = process.env.FRAMEUI_SMOKE_VITE === 'vue'
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({name:'budget',type:'module',scripts:{dev:'vite --strictPort'},dependencies:vue ? {vue:'^3.5.0',vite:'^5.4.0','@vitejs/plugin-vue':'^5.2.0'} : {react:'^18.3.0','react-dom':'^18.3.0',vite:'^5.4.0'}}))
    fs.writeFileSync(path.join(source, 'index.html'), '<div id="root"></div><script type="module" src="/main.jsx"></script>')
    fs.writeFileSync(path.join(source, 'main.jsx'), vue ? 'import {createApp} from "vue"; import App from "./App.vue"; createApp(App).mount("#root");' : 'import React from "react"; import {createRoot} from "react-dom/client"; createRoot(document.getElementById("root")).render(<main><h1>Budget overview</h1><button>New bill</button></main>);')
    if (vue) { fs.writeFileSync(path.join(source,'App.vue'), '<template><main><h1>Budget overview</h1><button>New bill</button></main></template>'); fs.writeFileSync(path.join(source,'vite.config.js'), 'import {defineConfig} from "vite"; import vue from "@vitejs/plugin-vue"; export default defineConfig({plugins:[vue()]});') }
  }
  if (process.env.FRAMEUI_SMOKE_PHP) {
    fs.unlinkSync(path.join(source,'index.html')); fs.writeFileSync(path.join(source,'index.php'), '<?php echo "<main><h1>Budget overview</h1><button>New bill</button></main>";')
    const cached = process.env.FRAMEUI_SMOKE_PHP_ROOT || '/tmp/frameui-php-pipeline-audit/php/8.4.20/x64'
    if (fs.existsSync(cached)) { const runtime = path.join(root,'profile/LocalEnvironment/runtimes/php/8.4.20/x64'); fs.mkdirSync(path.dirname(runtime),{recursive:true}); fs.cpSync(cached,runtime,{recursive:true}) }
  }
  if (process.env.FRAMEUI_SMOKE_NEXT) {
    fs.unlinkSync(path.join(source, 'index.html')); fs.mkdirSync(path.join(source, 'app'))
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({name:'budget',scripts:{dev:'next dev'},engines:{node:'>=20.9.0'},dependencies:{next:'^16.0.0',react:'^19.0.0','react-dom':'^19.0.0'}}))
    fs.writeFileSync(path.join(source, 'app/layout.jsx'), 'export default function Layout({children}) { return <html><body>{children}</body></html> }')
    fs.writeFileSync(path.join(source, 'app/page.jsx'), 'export default function Page() { return <main><h1>Budget overview</h1><button>New bill</button></main> }')
  }
  if (process.env.FRAMEUI_SMOKE_FRAMEWORK) {
    const framework = process.env.FRAMEUI_SMOKE_FRAMEWORK
    if (!['codeigniter', 'laravel'].includes(framework)) throw new Error('Unknown PHP framework smoke fixture')
    const phpRoot = process.env.FRAMEUI_SMOKE_PHP_ROOT || '/tmp/frameui-php-pipeline-audit/php/8.4.20/x64'
    const php = path.join(phpRoot, 'bin/php')
    const composerRoot = process.env.FRAMEUI_SMOKE_COMPOSER_ROOT || '/tmp/frameui-composer-audit'
    const {ComposerManager} = require('../hosting/stacker/lib/composer-manager.cjs')
    const composer = new ComposerManager(composerRoot)
    if (!composer.cachedPath()) await composer.install(php)
    fs.rmSync(source, {recursive:true,force:true})
    await new Promise((resolve,reject) => require('node:child_process').execFile(php, [composer.pharPath,'create-project',framework === 'laravel' ? 'laravel/laravel' : 'codeigniter4/appstarter',source,'--no-install','--no-scripts','--no-interaction'], {timeout:180000,maxBuffer:4*1024*1024,env:{...process.env,PATH:path.dirname(php)+path.delimiter+process.env.PATH}}, (error, stdout, stderr) => error ? reject(new Error(stderr || stdout || error.message)) : resolve()))
    const brokenComposer = path.join(root, 'profile/LocalEnvironment/runtimes/composer'); fs.mkdirSync(brokenComposer, {recursive:true}); fs.writeFileSync(path.join(brokenComposer, 'composer.phar'), 'corrupt cached composer')
    const view = framework === 'laravel' ? 'resources/views/welcome.blade.php' : 'app/Views/welcome_message.php'
    fs.writeFileSync(path.join(source,view), (framework === 'laravel' ? '<!doctype html><html><head>@vite([\'resources/css/app.css\', \'resources/js/app.js\'])</head><body>' : '') + '<main><h1>Budget overview</h1><button>New bill</button></main>' + (framework === 'laravel' ? '</body></html>' : ''))
    fs.writeFileSync(path.join(source,'.env'), 'DB_PASSWORD=original-secret\nAPP_LABEL=Original\nSESSION_DRIVER=file\nCACHE_STORE=file\nCI_ENVIRONMENT=development\n')
    const runtime = path.join(root,'profile/LocalEnvironment/runtimes/php/8.4.20/x64'); fs.mkdirSync(path.dirname(runtime),{recursive:true}); fs.cpSync(phpRoot,runtime,{recursive:true})
  }
  if (process.env.FRAMEUI_SMOKE_BLAZOR) {
    fs.unlinkSync(path.join(source,'index.html')); fs.mkdirSync(path.join(source,'wwwroot'))
    fs.writeFileSync(path.join(source,'Budget.csproj'), '<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"><PropertyGroup><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.AspNetCore.Components.WebAssembly" Version="8.0.28"/><PackageReference Include="Microsoft.AspNetCore.Components.WebAssembly.DevServer" Version="8.0.28" PrivateAssets="all"/></ItemGroup></Project>')
    fs.writeFileSync(path.join(source,'Program.cs'), 'using Microsoft.AspNetCore.Components.WebAssembly.Hosting; using Budget; var builder = WebAssemblyHostBuilder.CreateDefault(args); builder.RootComponents.Add<App>("#app"); await builder.Build().RunAsync();')
    fs.writeFileSync(path.join(source,'App.razor'), '@page "/"\n<main><h1>Budget overview</h1><button>New bill</button></main>')
    fs.writeFileSync(path.join(source,'wwwroot/index.html'), '<!doctype html><html><head><base href="/" /></head><body><div id="app">Loading</div><script src="_framework/blazor.webassembly.js"></script></body></html>')
    const cached = process.env.FRAMEUI_SMOKE_SDK_ROOT || '/tmp/frameui-dotnet-audit/dotnet/darwin/x64/8.0.425'; const runtime = path.join(root,'profile/LocalEnvironment/runtimes/dotnet/darwin/x64'); fs.mkdirSync(runtime,{recursive:true}); fs.cpSync(cached,path.join(runtime,path.basename(cached)),{recursive:true})
  }
  if (process.env.FRAMEUI_SMOKE_MIXED) {
    fs.unlinkSync(path.join(source,'index.html')); fs.mkdirSync(path.join(source,'frontend')); fs.mkdirSync(path.join(source,'backend'))
    fs.writeFileSync(path.join(source,'frontend/package.json'),JSON.stringify({name:'budget-ui',type:'module',scripts:{dev:'vite --strictPort'},dependencies:{react:'^18.3.0','react-dom':'^18.3.0',vite:'^5.4.0'}}))
    fs.writeFileSync(path.join(source,'frontend/.env'),'VITE_API_URL=http://localhost:3000/api\n')
    fs.writeFileSync(path.join(source,'frontend/index.html'),'<div id="root"></div><script type="module" src="/main.jsx"></script>')
    fs.writeFileSync(path.join(source,'frontend/main.jsx'),'import React from "react"; import {createRoot} from "react-dom/client"; import App from "./App.jsx"; createRoot(document.getElementById("root")).render(<App/>);')
    fs.writeFileSync(path.join(source,'frontend/App.jsx'), 'import React, {useState,useEffect} from "react"; const api=import.meta.env.VITE_API_URL; export default function App(){const [title,setTitle]=useState("Loading"); const load=()=>fetch(api+"/budget").then(r=>r.json()).then(data=>setTitle(data.title)); useEffect(()=>{load()},[]); return <main>{title === "Sign in" ? <button onClick={async()=>{await fetch(api+"/login",{method:"POST"});await load()}}>Sign in</button> : <><h1>{title}</h1><button>New bill</button></>}</main>}')
    fs.writeFileSync(path.join(source,'backend/package.json'),JSON.stringify({name:'budget-api',scripts:{start:'node server.cjs'},engines:{node:'>=22.13.0'}}))
    fs.writeFileSync(path.join(source,'backend/server.cjs'), `const http=require('node:http'); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('budget.sqlite'); db.exec("CREATE TABLE IF NOT EXISTS budget (title TEXT); INSERT INTO budget SELECT 'Budget overview' WHERE NOT EXISTS (SELECT 1 FROM budget)"); http.createServer((req,res)=>{res.setHeader('Content-Type','application/json'); if(req.url==='/api/login' && req.method==='POST'){res.setHeader('Set-Cookie','budget_session=fixture; HttpOnly; SameSite=Lax; Path=/');res.end('{}');return} if(req.url==='/api/budget'){res.statusCode=(req.headers.cookie||'').includes('budget_session=fixture')?200:401;res.end(JSON.stringify(res.statusCode===200?db.prepare('SELECT title FROM budget LIMIT 1').get():{title:'Sign in'}));return}res.end('{}')}).listen(process.env.PORT,'127.0.0.1');`)
  }
  if (process.env.FRAMEUI_SMOKE_WORKSPACE) {
    if (!process.env.FRAMEUI_SMOKE_MIXED) throw new Error('Workspace smoke requires the mixed fixture')
    fs.writeFileSync(path.join(source,'package.json'),JSON.stringify({name:'budget-workspace',private:true,packageManager:'pnpm@10.0.0',workspaces:['frontend','backend','shared'],scripts:{dev:'pnpm -r dev'}}))
    fs.writeFileSync(path.join(source,'pnpm-workspace.yaml'),"packages:\n  - frontend\n  - backend\n  - shared\n")
    fs.mkdirSync(path.join(source,'shared'))
    fs.writeFileSync(path.join(source,'shared/package.json'),JSON.stringify({name:'@budget/shared',version:'1.0.0',main:'index.cjs'}))
    fs.writeFileSync(path.join(source,'shared/index.cjs'),"module.exports={title:'Budget overview'}")
    const manifest=JSON.parse(fs.readFileSync(path.join(source,'backend/package.json'),'utf8'));manifest.dependencies={'@budget/shared':'workspace:*'}
    fs.writeFileSync(path.join(source,'backend/package.json'),JSON.stringify(manifest))
    const server=path.join(source,'backend/server.cjs');fs.writeFileSync(server,"if(require('@budget/shared').title!=='Budget overview')throw new Error('Workspace dependency missing');\n"+fs.readFileSync(server,'utf8'))
  }
  const expectedSourceEnvironment = fs.readFileSync(path.join(source, '.env'), 'utf8')
    app = await electron.launch({ executablePath: process.env.FRAMEUI_ELECTRON_PATH || require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${root}/profile`], env: desktopEnvironment() })
    const page = await app.firstWindow()
    page.on('pageerror', error => console.error('Renderer:', error.message))
    await page.getByRole('button', { name: 'Get started', exact: true }).click()
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, source)
    await page.getByRole('button', { name: 'New Design Project', exact: true }).first().click()
    const prepare = page.getByRole('button', { name: 'Prepare project', exact: true })
    await prepare.waitFor({ timeout: 60000 })
    await page.locator('dialog[open]').waitFor({ state: 'hidden' })
    assert.equal(await page.getByText('Review before setup', { exact: true }).count(), 0)
    await prepare.click()
    await page.locator('dialog[open]').waitFor({ state: 'hidden', timeout: 300000 })
    if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').innerText())
    await page.getByRole('button', { name: 'Use existing page', exact: true }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Use existing page', exact: true }).click()
    await page.locator('webview').first().waitFor()
    if (process.env.FRAMEUI_SMOKE_MIXED) await page.evaluate(async () => {
      const view=document.querySelector('webview')
      for(let attempt=0;attempt<200;attempt++) {
        try { if(await view.executeJavaScript('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent==="Sign in");if(b){b.click();return true}return document.body.innerText.includes("Budget overview")})()')) return } catch {}
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      throw new Error('The authenticated application did not offer sign in')
    })
    const status = await page.evaluate(() => window.frameui.preview.getStatus())
    assert.equal(status.status, 'running')
    if (process.env.FRAMEUI_SMOKE_DOTNET) console.log('HTTP probe', await app.evaluate(async ({net}, url) => { const response = await net.fetch(url); return {status:response.status,body:await response.text()} }, status.url))
    const body = await page.evaluate(async () => {
      const view = document.querySelector('webview'); let last = ''
      for (let i = 0; i < 100; i++) {
        try { const text = await view.executeJavaScript('document.body.innerText'); last = await view.executeJavaScript('JSON.stringify({url:location.href, html:document.documentElement.outerHTML})'); if (text.includes('Budget overview')) return text } catch {}
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('Application page did not render: ' + view.getAttribute('src') + ' ' + last)
    })
    assert(body.includes('Budget overview'))
    const localButton = page.getByRole('button', {name: /^Local app ·/})
    const sourceUpdate = !process.env.FRAMEUI_SMOKE_DOTNET && !process.env.FRAMEUI_SMOKE_PHP && !process.env.FRAMEUI_SMOKE_VITE && !process.env.FRAMEUI_SMOKE_FRAMEWORK && !process.env.FRAMEUI_SMOKE_BLAZOR && !process.env.FRAMEUI_SMOKE_MIXED
    if (sourceUpdate) {
      if (process.env.FRAMEUI_SMOKE_NEXT) {
        const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')); manifest.dependencies['is-number'] = '7.0.0'
        fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(manifest))
        fs.writeFileSync(path.join(source, 'app/page.jsx'), 'import isNumber from "is-number"; export default function Page() { return <main><h1>Budget overview</h1><button>New bill</button><p>{isNumber(7) ? "Restart update" : "Missing dependency"}</p></main> }')
      } else fs.appendFileSync(path.join(source, 'index.html'), '<p>Restart update</p>')
    }
    await localButton.click()
    await page.getByRole('button', {name: 'Restart',exact:true}).click()
    await page.locator('dialog[open]').waitFor({state:'visible'})
    await page.locator('dialog[open]').waitFor({state:'hidden',timeout:300000})
    await page.getByRole('button', {name: 'Stop',exact:true}).waitFor({timeout:180000})
    if (sourceUpdate) {
      const restarted = await page.evaluate(() => window.frameui.preview.getStatus())
      const html = await app.evaluate(async ({net}, url) => (await net.fetch(url)).text(), restarted.url)
      assert(html.includes('Restart update'), 'Restart must synchronize source changes and install changed dependencies')
    }
    await page.getByRole('button', {name: 'Open designer',exact:true}).click()
    assert.equal(fs.readFileSync(path.join(source, '.env'), 'utf8'), expectedSourceEnvironment)
    const close = page.getByRole('button', { name: /^Close screen / }).first()
    await close.click()
    assert.equal(await page.getByRole('button', { name: /^Close screen / }).count(), 0)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await page.getByRole('button', { name: /^Close screen / }).first().waitFor()
    await page.getByRole('button', {name:'Edit a design copy',exact:true}).first().click()
    const design = page.frameLocator('iframe[title="Editable project design"]').last()
    const heading = design.getByText('Budget overview',{exact:true}).first()
    await heading.waitFor({timeout:30000})
    await heading.dblclick()
    await heading.fill('Monthly budget')
    await page.keyboard.press('Enter')
    await design.getByText('Monthly budget',{exact:true}).waitFor()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await design.getByText('Budget overview',{exact:true}).waitFor()
    const zoom = await page.locator('[aria-label="Zoom options"]').innerText()
    await page.evaluate(() => { const iframe = [...document.querySelectorAll('iframe[title="Editable project design"]')].at(-1); iframe.contentDocument.dispatchEvent(new WheelEvent('wheel',{deltaY:-50,ctrlKey:true,clientX:150,clientY:150,bubbles:true,cancelable:true})) })
    for (let i=0; i<50 && await page.locator('[aria-label="Zoom options"]').innerText() === zoom; i++) await page.waitForTimeout(50)
    assert.notEqual(await page.locator('[aria-label="Zoom options"]').innerText(),zoom)
    for (const size of [{width:1280,height:720},{width:1440,height:900},{width:1920,height:1080},{width:2560,height:1440}]) {
      await page.setViewportSize(size)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    }
    await page.setViewportSize({width:1440,height:900})
    await page.locator('[aria-label="Zoom options"]').click()
    await page.getByRole('button', {name:'Fit canvas',exact:true}).click()
    await page.screenshot({ path: path.join(__dirname, '../docs/designer-preparation-smoke.png') })
    await app.close(); app = null
    app = await electron.launch({ executablePath: process.env.FRAMEUI_ELECTRON_PATH || require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${root}/profile`], env: desktopEnvironment() })
    const reopened = await app.firstWindow()
    await reopened.getByRole('button', {name: 'Local app · Ready', exact:true}).waitFor({timeout:120000})
    assert.equal((await reopened.evaluate(() => window.frameui.preview.getStatus())).status, 'running')
    await reopened.getByRole('button', { name: /^Close screen / }).first().waitFor()
    assert.equal(fs.readFileSync(path.join(source, '.env'), 'utf8'), expectedSourceEnvironment)
    console.log('Fresh import → automatic preparation → designer → real page → restart → close → undo → edit → undo → iframe zoom passed; source settings unchanged.')
    if (process.env.FRAMEUI_SMOKE_MIXED) assert.equal(fs.existsSync(path.join(source,'backend/budget.sqlite')),false,'Database must stay in the private application copy')
    console.log('Full application quit/reopen resumed the authorized application and restored artboards.')
  } catch (error) {
    if (app) { const page = await app.firstWindow(); const details = page.getByRole('button',{name:'Technical details',exact:true}).first(); if (await details.isVisible()) await details.click(); console.error((await page.locator('body').innerText()).slice(-6000)); await page.screenshot({path:path.join(__dirname,'../docs/designer-preparation-failure.png')}) }
    throw error
  } finally { if (app) await app.close(); fs.rmSync(root, {recursive:true,force:true}) }
})().catch(error => {console.error(error); process.exitCode=1})
