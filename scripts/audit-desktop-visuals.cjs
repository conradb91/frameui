const {_electron}=require('playwright-core')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-visual-audit-'));let app
 const output=path.join(__dirname,'../docs/visual-audit');fs.mkdirSync(output,{recursive:true})
 try{
  const source=path.join(root,'Budget');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'index.html'),'<style>body{font-family:system-ui;color:#172133}button{background:#2563eb;color:white}</style><header>Budget</header><main><h1>Budget overview</h1><button>New bill</button></main>')
  const env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
  app=await _electron.launch({executablePath:process.env.FRAMEUI_ELECTRON_PATH||require('electron'),args:[path.resolve(__dirname,'..'),`--user-data-dir=${root}/profile`],env})
  const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.getByRole('button',{name:'Get started',exact:true}).click()
  await page.screenshot({path:path.join(output,'start-workspace.png')})
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},source)
  await page.getByRole('button',{name:'New Design Project',exact:true}).first().click()
  await page.getByRole('button',{name:'Prepare Budget',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'Prepare Budget',exact:true}).click();await page.locator('dialog[open]').waitFor({state:'hidden',timeout:120000})
  for(const theme of ['light','dark']){
   await page.getByRole('button',{name:'Application settings',exact:true}).click()
   await page.getByRole('radio',{name:theme==='light'?'Light':'Dark',exact:true}).check()
   await page.screenshot({path:path.join(output,`${theme}-appearance.png`)})
   await page.getByRole('button',{name:'Close settings',exact:true}).click()
   if(theme==='light')await page.screenshot({path:path.join(output,'light-setup.png')})
   for(const [label,name] of [['Open Canvas','canvas'],['Open Features','features'],['Open Pages','pages'],['Find Component','components'],['Open Design System','design-system'],['Open Journey','journeys'],['Open Review','review'],['Open Project Settings','settings']]){
    const search=page.getByPlaceholder(/Quick open/);await search.fill(label)
    await page.getByRole('button',{name:new RegExp('^'+label)}).first().click()
    await search.press('Escape');await search.blur();await page.waitForTimeout(180)
    await page.screenshot({path:path.join(output,`${theme}-${name}.png`)})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${theme}/${name} window overflow`)
   }
   await page.getByRole('button',{name:/Local app ·/}).click();await page.screenshot({path:path.join(output,`${theme}-setup.png`)})
  }
  assert.deepEqual(errors,[])
  console.log('Light/dark appearance, setup, canvas, features, pages, components, design system, journeys, review and settings rendered without renderer errors or window overflow.')
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1})
