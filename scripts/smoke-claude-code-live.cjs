// Explicit live smoke: uses the signed-in official CLI and its usage limits.
// Sends a scratch canvas, never a user repository. Run only when live testing is authorized.
const {_electron}=require('playwright-core')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
;(async()=>{
 if(process.env.FRAMEUI_LIVE_CLAUDE!=='1')throw new Error('Set FRAMEUI_LIVE_CLAUDE=1 to explicitly enable this live account check.')
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-live-chat-'))
 const env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
 let app,reviewProfile
 try{
  const packaged=process.env.FRAMEUI_PACKAGED_APP
  app=await _electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.',`--user-data-dir=${path.join(root,'profile')}`],env})
  if(packaged){reviewProfile=await app.evaluate(({app})=>app.getPath('userData'));assert(path.basename(reviewProfile).startsWith('review-'))}
  const page=await app.firstWindow();page.setDefaultTimeout(120000)
  const skip=page.getByRole('button',{name:'Skip introduction',exact:true});if(await skip.isVisible().catch(()=>false))await skip.click()
  await page.getByRole('button',{name:'Create Blank Design',exact:true}).click()
  await page.getByRole('button',{name:'Claude',exact:true}).click()
  await page.getByRole('button',{name:'Use existing Claude Code login',exact:true}).click()
  await page.getByLabel('Connected',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Model',exact:true}).click()
  const models=await page.getByRole('menuitemradio').allTextContents()
  assert(models.some(m=>m.includes('Sonnet')))
  await page.getByRole('menuitemradio',{name:/^Sonnet 5.5/}).click()
  await page.getByLabel('Ask Claude',{exact:true}).fill('Create a polished small account prototype using apply_design_batch: an artboard named Connection Check, 400 by 400, with text FrameUI live connection works, a Settings button, a Profile navigation item, and a Help button. Create Profile as a second full screen, Settings as a side drawer with a Close button, and Help as a modal with a Close button. Wire the three entry controls to their correct native actions, wire both close buttons and a back button on Profile. Configure a flow containing all four screens and a manual test scenario. Use a restrained neutral palette, consistent spacing and clear typography. Inspect prototype validation and render the home screen before finishing. Reply exactly: Live design check passed.')
  await page.getByRole('button',{name:'Run Claude',exact:true}).click()
  await page.getByRole('button',{name:'Stop',exact:true}).waitFor()
  await page.getByRole('button',{name:'Run Claude',exact:true}).waitFor()
  const errors=page.getByRole('alert');assert.equal(await errors.count(),0,await errors.allTextContents())
  await page.getByText('Live design check passed.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Import to FrameUI',exact:true}).click()
  await page.getByRole('button',{name:'Confirm import',exact:true}).click()
  await page.getByRole('region',{name:'AI Prototype Studio',exact:true}).waitFor({state:'hidden'})
  const documents=await page.evaluate(async()=>{await window.frameuiFlushSaves?.();const list=await window.frameui.design.list();return Promise.all(list.map(d=>window.frameui.design.load(d.id)))})
  const created=documents.flatMap(d=>d?.pages??[]).find(p=>p.name==='Connection Check')
  assert(created?.structured,'live Claude must create a native editable artboard')
  assert(JSON.stringify(created.structured).includes('FrameUI live connection works'))
  const doc=documents.find(d=>d?.pages.some(p=>p.id===created.id))
  assert(doc.pages.length>=4,'live prototype must include page, modal and drawer')
  for(const action of ['navigate','open-drawer','close-drawer','open-modal','close-modal','back'])assert(doc.prototype.interactions.some(i=>i.action===action),'missing native action '+action)
  assert(doc.prototype.flows.some(f=>f.artboardIds.length>=4),'entire flow must import together')
  await page.screenshot({path:'/tmp/frameui-claude-chat-live.png'})
  // A second message verifies that the transcript is actual model context.
  await page.getByLabel('Ask Claude',{exact:true}).fill('Without using tools or changing the design, what exact text did I ask you to put on the artboard? Reply with only that text.')
  await page.getByLabel('Ask Claude',{exact:true}).press('Enter')
  await page.getByRole('button',{name:'Stop',exact:true}).waitFor()
  await page.getByRole('button',{name:'Run Claude',exact:true}).waitFor()
  await page.getByRole('button',{name:'Return to canvas',exact:true}).click()
  const conversation=page.getByRole('log',{name:'Conversation'})
  await conversation.getByText('FrameUI live connection works',{exact:true}).waitFor()
  await page.screenshot({path:'/tmp/frameui-claude-chat-live-followup.png'})
  console.log(JSON.stringify({status:'PASS',models,checks:['real account login status','live model selection','streaming response','native editable artboard','render tool','follow-up conversation context']}))
 }finally{if(app)await app.close();if(reviewProfile)fs.rmSync(reviewProfile,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1})
