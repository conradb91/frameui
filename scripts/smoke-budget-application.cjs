const {_electron}=require('playwright-core')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
;(async()=>{
 const root=process.env.FRAMEUI_BUDGET_SMOKE_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'frameui-real-budget-'))
 let app
 try {
  const original=process.env.FRAMEUI_BUDGET_SOURCE||'/Users/leadsprint/Desktop/New-App/Budget'
  const source=path.join(root,'Budget')
  if(!fs.existsSync(source))fs.cpSync(original,source,{recursive:true,filter:file=>!path.relative(original,file).split(path.sep).some(part=>['vendor','node_modules','.git'].includes(part))})
  const originalEnv=fs.readFileSync(path.join(original,'.env'),'utf8')
  const env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
  app=await _electron.launch({executablePath:process.env.FRAMEUI_ELECTRON_PATH||require('electron'),args:[path.resolve(__dirname,'..'),`--user-data-dir=${root}/profile`],env})
  const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900})
  if(await page.getByRole('button',{name:'Get started',exact:true}).count())await page.getByRole('button',{name:'Get started',exact:true}).click()
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},source)
  if(await page.getByRole('button',{name:'New Design Project',exact:true}).count())await page.getByRole('button',{name:'New Design Project',exact:true}).first().click()
  else await page.getByRole('button',{name:/Local app ·/}).click()
  await page.getByRole('button',{name:/^(Prepare workspace|Open designer)$/}).waitFor({timeout:120000})
  if(await page.getByRole('button',{name:'Open designer',exact:true}).count())await page.getByRole('button',{name:'Open designer',exact:true}).click()
  else {
  await page.locator('dialog[open]').waitFor({state:'hidden',timeout:120000})
  await page.getByRole('button',{name:'Prepare workspace',exact:true}).click()
  await page.getByRole('radio',{name:/Create a private local database/}).check()
  await page.getByRole('button',{name:'Continue setup',exact:true}).click()
  await page.locator('dialog[open]').waitFor({state:'hidden',timeout:900000})
  }
  console.log('Initial setup finished')
  if(await page.getByRole('alert').count()) {
   console.log('Initial setup status:',await page.getByRole('alert').innerText())
   await page.screenshot({path:path.join(__dirname,'../docs/budget-data-setup.png')})
   await page.getByRole('button',{name:'Fix setup',exact:true}).click()
   const run=page.getByRole('button',{name:'Run setup files',exact:true})
   await page.getByRole('textbox',{name:'Confirm project name'}).fill('Budget')
   assert(await run.isEnabled(),'A managed database must exist before migrations')
   await run.click()
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Run setup files'&&!button.disabled),{},{timeout:180000})
   console.log('Migration requested')
   await page.getByRole('button',{name:/^(Try again|Prepare workspace)$/}).click({timeout:180000})
   if(await page.getByRole('radio',{name:/Create a private local database/}).count()){await page.getByRole('radio',{name:/Create a private local database/}).check();await page.getByRole('button',{name:'Continue setup',exact:true}).click()}
   await page.locator('dialog[open]').waitFor({state:'hidden',timeout:900000})
  }
  if(await page.getByRole('alert').count())throw Error(await page.getByRole('alert').innerText())
  await page.getByRole('button',{name:'Use existing page',exact:true}).click({timeout:30000})
  await page.locator('webview').first().waitFor()
  const body=await page.evaluate(async()=>{const v=document.querySelector('webview');for(let i=0;i<100;i++){try{const s=await v.executeJavaScript('document.body.innerText');if(s.trim())return s}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('No application content')})
  assert(!/DatabaseException|Unable to connect|Whoops!/i.test(body))
  console.log('Budget rendered:',body.slice(0,250))
  await page.screenshot({path:path.join(__dirname,'../docs/budget-application-smoke.png')})
  assert.equal(fs.readFileSync(path.join(original,'.env'),'utf8'),originalEnv)
  console.log('Actual Budget private MySQL setup, explicit migrations and application rendering passed; source unchanged.')
 } catch(error){console.error('Test profile:',root);if(app){const page=await app.firstWindow();await page.screenshot({path:path.join(__dirname,'../docs/budget-application-failure.png')});console.error((await page.locator('body').innerText()).slice(-4500))}throw error}
 finally{if(app)await app.close();console.log('Evidence profile retained:',root)}
})().catch(error=>{console.error(error);process.exitCode=1})
