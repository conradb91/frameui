const {_electron}=require('playwright-core')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
;(async()=>{
 const executable=process.env.FRAMEUI_PACKAGED_APP||path.resolve('release/desktop-review/mac/FrameUI.app/Contents/MacOS/FrameUI')
 const env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
 let app,profile,metadata;const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-package-check-'))
 try{
  app=await _electron.launch({executablePath:executable,args:[],env})
  const page=await app.firstWindow()
  await page.getByRole('button',{name:/Get started/}).waitFor()
  const info=await app.evaluate(({app})=>({packaged:app.isPackaged,profile:app.getPath('userData'),arch:process.arch,appPath:app.getAppPath()}))
  metadata=JSON.parse(require('@electron/asar').extractFile(info.appPath,'package.json').toString()).frameuiReviewProfile
  profile=info.profile
  assert(info.packaged);assert.equal(info.arch,'x64');assert.equal(path.basename(profile),metadata)
  assert.deepEqual(await page.evaluate(()=>window.frameui.project.listLibrary()),[])
  console.log('Intel package starts with a fresh empty review profile:',metadata)
  const source=path.join(root,'Package fixture');fs.mkdirSync(source)
  fs.writeFileSync(path.join(source,'index.html'),'<main><nav><a href="about.html">About</a></nav><h1>Packaged application ready</h1><button>Continue</button></main>')
  fs.writeFileSync(path.join(source,'about.html'),'<main><h1>About this application</h1></main>')
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},source)
  await page.getByRole('button',{name:/Get started/}).click()
  await page.getByRole('button',{name:'Choose a project folder',exact:true}).click()
  await page.getByText('Source model ready',{exact:true}).waitFor({timeout:60000})
  assert.equal(await page.getByText('Project analysis',{exact:true}).isVisible(),true)
  assert.equal(await page.getByRole('dialog',{name:'Capture application'}).count(),0)
  assert.equal((await page.evaluate(()=>window.frameui.project.listLibrary())).length,1)
  await page.getByRole('button',{name:/Screens/}).first().click()
  await page.getByRole('button',{name:'Open design workspace',exact:true}).click()
  await page.locator('[data-source-capture]').first().waitFor({timeout:30000})
  assert.notEqual((await page.evaluate(()=>window.frameui.preview.getStatus())).status,'running')
  console.log('Repo-first analysis and lazy source-linked design passed without starting a runtime.')
 }finally{
  if(app)await app.close()
  if(profile&&metadata){assert(path.basename(profile)===metadata&&metadata.startsWith('review-'));fs.rmSync(profile,{recursive:true,force:true})}
  fs.rmSync(root,{recursive:true,force:true})
 }
})().catch(error=>{console.error(error);process.exitCode=1})
