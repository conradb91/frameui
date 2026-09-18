const {_electron}=require('playwright-core')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-setup-review-')),source=path.join(root,'Budget')
 fs.mkdirSync(source);for(let i=0;i<24;i++)fs.writeFileSync(path.join(source,`page-${i}.html`),`<h1>Screen ${i}</h1>`)
 const env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
 let app,reviewProfile
 try{
  const executable=process.env.FRAMEUI_PACKAGED_APP
  app=await _electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.',`--user-data-dir=${path.join(root,'profile')}`],env})
  if(executable){reviewProfile=await app.evaluate(({app})=>app.getPath('userData'));assert(path.basename(reviewProfile).startsWith('review-'))}
  const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.getByRole('button',{name:'Skip introduction',exact:true}).click()
  // Delay the real handler only in the test, so the transient working state can be inspected reliably.
  await app.evaluate(({ipcMain,dialog},source)=>{
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]})
   const original=ipcMain._invokeHandlers.get('project:getIndex')
   ipcMain.removeHandler('project:getIndex')
   globalThis.failNextPreparation=true
   ipcMain.handle('project:getIndex',async(event,...args)=>{
    await new Promise(resolve=>setTimeout(resolve,1500))
    if(globalThis.failNextPreparation){globalThis.failNextPreparation=false;throw new Error('Test fixture: index temporarily unavailable')}
    return original(event,...args)
   })
  },source)
  await page.getByLabel('light appearance').click()
  await page.getByRole('button',{name:'Open Codebase',exact:true}).click()
  const setup=page.locator('.ide-project-setup-dialog')
  await setup.waitFor();fs.mkdirSync('docs/verification/modal-workflows',{recursive:true})
  const shot=async name=>page.screenshot({path:`docs/verification/modal-workflows/${name}.png`,animations:'disabled'})
  await shot('setup-connect-light')
  assert.equal(await setup.locator('[aria-current=step]').innerText().then(t=>t.includes('Connect')),true)
  await page.getByRole('button',{name:'Prepare project',exact:true}).click()
  await setup.getByRole('progressbar',{name:'Preparing workspace'}).waitFor()
  assert.equal(await setup.getByRole('progressbar').getAttribute('aria-valuenow'),null,'indexing must not invent percentages')
  await shot('setup-working-light')
  await setup.getByRole('button',{name:'Try again',exact:true}).waitFor()
  assert.equal(await setup.getByRole('progressbar').count(),0,'failed operations must not animate progress')
  await shot('setup-error-light')
  await setup.getByRole('button',{name:'Try again',exact:true}).click()
  await page.getByRole('dialog',{name:'Budget is ready'}).waitFor()
  assert.equal(await setup.getByRole('progressbar',{name:'Workspace prepared'}).getAttribute('aria-valuenow'),'100')
  assert(await setup.locator('.ide-project-ready-stats').innerText().then(t=>t.includes('24')))
  await shot('setup-ready-light')
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,680))
  const bounds=await setup.boundingBox();const viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));assert(bounds.height<viewport.h&&bounds.width<viewport.w)
  await shot('setup-ready-compact')
  await setup.getByRole('button',{name:'Close project setup'}).click()
  await page.getByLabel('dark appearance').click()
  await page.getByRole('button',{name:'Open Budget',exact:true}).click()
  await setup.waitFor();await shot('setup-connect-dark')
  await setup.getByRole('button',{name:'Prepare project',exact:true}).click()
  await setup.getByRole('progressbar',{name:'Preparing workspace'}).waitFor();await shot('setup-working-dark')
  await page.getByRole('dialog',{name:'Budget is ready'}).waitFor();await shot('setup-ready-dark')
  await setup.getByRole('button',{name:'Review project',exact:true}).click()
  await page.getByRole('navigation',{name:'Project navigation'}).waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS: real indexing with visible indeterminate progress, error/retry, complete progress, result counts, both themes, compact containment and opening project.')
 }finally{if(app)await app.close();if(reviewProfile&&path.basename(reviewProfile).startsWith('review-'))fs.rmSync(reviewProfile,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1})
