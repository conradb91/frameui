const {_electron}=require('playwright-core')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-project-start-')),env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'}
 delete env.ELECTRON_RUN_AS_NODE
 let app
 try{
  app=await _electron.launch({executablePath:require('electron'),args:['.',`--user-data-dir=${root}/profile`],env})
  const page=await app.firstWindow();page.setDefaultTimeout(60000)
  await page.getByRole('button',{name:'Open Codebase',exact:true}).waitFor()
  const names=['Blank workspace','Application workspace','Prototype workspace','Repository workspace']
  const launchers=[/Create Blank Design/,/Connect a running app/,/Import HTML prototype/,/Open an existing repository/]
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]})})
  const prototype=path.join(root,'prototype.html');fs.writeFileSync(prototype,'<!doctype html><h1>Prototype workspace</h1>')
  for(let i=0;i<launchers.length;i++){
   await page.getByRole('button',{name:launchers[i]}).click()
   const modal=page.getByRole('dialog',{name:'Create project',exact:true});await modal.waitFor()
   const create=modal.getByRole('button',{name:i===2?'Create project and import':'Create project',exact:true});assert.equal(await create.isDisabled(),true)
   await modal.getByLabel('Project name',{exact:true}).fill(names[i])
   if(i===2){await modal.getByLabel('Design name',{exact:true}).fill('Prototype screens');await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},prototype);await modal.getByRole('button',{name:'Select files',exact:true}).click()}
   await create.click()
   if(i===0){await page.locator('.ide-stage').waitFor();await page.evaluate(()=>window.frameuiFlushSaves?.());await page.getByRole('button',{name:'Projects',exact:true}).click()}
   if(i===1){await page.getByRole('dialog',{name:'Connect a running app'}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click()}
   if(i===2){await page.locator('.ide-stage').waitFor();await page.evaluate(()=>window.frameuiFlushSaves?.());await page.getByRole('button',{name:'Projects',exact:true}).click();await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]})})}
   await page.getByRole('button',{name:`Open ${names[i]}`,exact:true}).waitFor()
  }
  const library=await page.evaluate(()=>window.frameui.project.listLibrary())
  assert(names.every(name=>library.some(p=>p.name===name)))
  for(const project of library){assert(fs.existsSync(path.join(project.path,'frameui-project.json')));assert(path.basename(project.path).includes(project.name.replaceAll(' ','-')))}
  for(const width of [1000,1440]){
   await page.setViewportSize({width,height:900})
   for(const row of await page.locator('.project-cards--list .project-card').all()){
    const content=await row.locator('.project-card-open').boundingBox(),actions=await row.locator('.project-card-actions').boundingBox()
    assert(content.x+content.width<=actions.x+1,'Project content must not overlap actions')
    const footer=await row.locator('footer').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert(footer.scroll<=footer.width,'Project metadata must fit its column')
   }
  }
  await page.screenshot({path:'/tmp/frameui-project-home-review.png',animations:'disabled'})
  await page.evaluate(async()=>{const project=await window.frameui.project.createStarterProject('Designs layout review','repository');await window.frameui.design.save({version:1,id:crypto.randomUUID(),name:project.name,projectId:project.id,updatedAt:new Date().toISOString(),pages:[],components:[],variables:[]})})
  await page.reload();await page.getByRole('button',{name:'Open Designs layout review',exact:true}).click();await page.getByRole('heading',{name:'Designs layout review',exact:true}).waitFor();
  await page.screenshot({path:'/tmp/frameui-designs-layout-review.png',animations:'disabled'});
  assert.equal(await page.locator('.design-start-card').count(),2);await page.getByRole('button',{name:'Blank design',exact:true}).click();await page.getByRole('dialog',{name:'Create editable design'}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Explore components',exact:true}).first().click();await page.getByRole('heading',{name:'Components',exact:true}).waitFor();
  console.log('PASS: all four start options create named local folders before the next step; project rows fit without overlapping actions.')
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1})
