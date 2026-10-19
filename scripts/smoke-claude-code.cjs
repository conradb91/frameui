// Real Electron/UI + subprocess + MCP integration, with a deterministic CLI fixture.
// Does not sign in, read credentials, or make billable model requests.
const {_electron}=require('playwright-core')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-code-smoke-'))
 const fixture=String.raw`
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
 const root=__dirname,args=process.argv.slice(2),flag=name=>args[args.indexOf(name)+1]
 if(args[0]==='auth'){
  if(args[1]==='login'){fs.writeFileSync(path.join(root,'signed-in'),'yes');process.exit(0)}
  console.log(JSON.stringify({loggedIn:fs.existsSync(path.join(root,'signed-in')),authMethod:'claude.ai'}));process.exit(0)
 }
 assert(args.includes('--no-session-persistence'));assert.equal(flag('--tools'),'')
 assert(args.includes('--strict-mcp-config'));assert.equal(flag('--setting-sources'),'')
 assert.equal(JSON.parse(flag('--settings')).disableAllHooks,true)
 assert.equal(flag('--output-format'),'stream-json');assert(args.includes('--verbose'))
 let input='';process.stdin.on('data',async c=>{input+=c;if(!input.includes('\n'))return;
  try{
   const message=JSON.parse(input.trim());input='';
   if(message.type==='control_request'){console.log(JSON.stringify({type:'control_response',response:{request_id:message.request_id,subtype:'success',response:{models:[{value:'default',displayName:'Default',description:'Opus 5.5 · Default'},{value:'sonnet',displayName:'Sonnet 5.5',description:'Efficient for design tasks'},{value:'opus',displayName:'Opus 5.5',description:'Complex work'}]}}}));return}
   assert.equal(message.type,'user');fs.writeFileSync(path.join(root,'last-user-content'),JSON.stringify(message.message.content));assert.equal(flag('--allowedTools'),'mcp__frameui__*')
   const config=JSON.parse(fs.readFileSync(flag('--mcp-config'),'utf8')).mcpServers.frameui
   fs.writeFileSync(path.join(root,'last-config-path'),flag('--mcp-config'))
   const request=message.message.content[0].text.split('Current request:\n').at(-1)
   if(request.startsWith('Cancel')){fs.writeFileSync(path.join(root,'waiting'),'yes');setInterval(()=>{},1000);return}
   if(request.startsWith('Failure')){console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true}));return}
   assert(message.message.content.some(c=>c.type==='image'&&c.source?.data===fs.readFileSync(path.join(root,'expected-image'),'utf8')),'the exact submitted reference image must reach CLI')
   let id=0
   const rpc=async(method,params)=>{
    const response=await fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})})
    assert.equal(response.status,200);return (await response.json()).result
   }
   assert.equal((await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'fixture',version:'1'}})).serverInfo.name,'frameui')
   const list=await rpc('tools/list',{});assert(list.tools.some(t=>t.name==='create_artboard'));assert(!list.tools.some(t=>t.name==='Bash'))
   const call=(name,args)=>rpc('tools/call',{name,arguments:args})
   const blocked=await call('propose_file_change',{path:'a.ts',content:'unsafe'});assert.equal(blocked.isError,true)
   const made=await call('create_artboard',{name:'Claude Code Screen',width:800,height:600})
   assert(!made.isError,JSON.stringify(made));const page=JSON.parse(made.content[0].text)
   const text=await call('create_text',{pageId:page.id,text:'Signed in with Claude Code',x:40,y:40,width:600,height:50,fontSize:28});assert(!text.isError,JSON.stringify(text))
   const rendered=await call('render_artboard',{pageId:page.id});assert(rendered.content.some(c=>c.type==='image'&&c.mimeType==='image/png'),'rendered image must return through MCP')
   console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Created your editable screen through Claude Code.'}}}))
   console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Created your editable screen through Claude Code.'}))
  }catch(error){console.error(error);process.exitCode=1}
 })
 `
 fs.writeFileSync(path.join(root,'fixture.cjs'),fixture)
 fs.writeFileSync(path.join(root,'claude'),'#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' '+JSON.stringify(path.join(root,'fixture.cjs'))+' "$@"\n',{mode:0o700})
 const env={...process.env,PATH:root+path.delimiter+process.env.PATH,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
 let app,reviewProfile
 try{
  const packaged=process.env.FRAMEUI_PACKAGED_APP
  app=await _electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.',`--user-data-dir=${path.join(root,'profile')}`],env})
  const profile=await app.evaluate(({app})=>app.getPath('userData'))
  if(packaged){assert(path.basename(profile).startsWith('review-'));reviewProfile=profile}
  const page=await app.firstWindow();page.setDefaultTimeout(30000)
  const skip=page.getByRole('button',{name:'Skip introduction',exact:true});if(await skip.isVisible().catch(()=>false))await skip.click()
  await page.getByRole('button',{name:'Create Blank Design',exact:true}).click()
  await page.getByRole('button',{name:'Claude',exact:true}).click()
  await page.getByRole('button',{name:'Use existing Claude Code login',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Sign in with Claude Code first'}).waitFor()
  await page.screenshot({path:'/tmp/frameui-claude-code-login.png'})
  await page.getByRole('button',{name:'Sign in through Claude Code',exact:true}).click()
  await page.getByLabel('Connected',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Model',exact:true}).click()
  await page.getByRole('menuitemradio',{name:/Sonnet 5.5/}).click()
  await page.getByRole('button',{name:'Model',exact:true}).click()
  await page.screenshot({path:'/tmp/frameui-claude-model-menu.png'})
  await page.getByRole('menuitemradio',{name:/Sonnet 5.5/}).press('Escape')
  assert(await page.getByLabel('Ask Claude',{exact:true}).evaluate(el=>getComputedStyle(el).borderTopWidth==='0px'),'composer must have no nested form border')
  assert.equal(await page.locator('.claude-composer select').count(),0,'composer uses compact menu triggers')
  await page.getByRole('button',{name:'Workspace settings',exact:true}).click()
  await page.getByRole('button',{name:'dark appearance',exact:true}).click()
  await page.getByRole('button',{name:'Done',exact:true}).click()
  await page.screenshot({path:'/tmp/frameui-claude-chat-dark.png'})
  await page.getByRole('button',{name:'Workspace settings',exact:true}).click()
  await page.getByRole('button',{name:'light appearance',exact:true}).click()
  await page.getByRole('button',{name:'Done',exact:true}).click()
  await page.screenshot({path:'/tmp/frameui-claude-chat-light.png'})
  const panel=page.getByRole('region',{name:'Claude assistant'})
  assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'chat must fit the sidebar')
  const sendBounds=await page.getByRole('button',{name:'Run Claude',exact:true}).boundingBox()
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
  assert(sendBounds.y+sendBounds.height<viewport.height,'composer must be visible without scrolling')
  assert.equal(await page.getByRole('button',{name:'Design Freedom',exact:true}).count(),0)
  for(const name of ['Improve Current Screen','Create New Screen or Process','Redesign Screen']){
    await page.getByRole('button',{name:'Design Approach',exact:true}).click()
    await page.getByRole('menuitemradio',{name:new RegExp('^'+name)}).click()
    assert((await page.getByRole('button',{name:'Design Approach',exact:true}).innerText()).includes(name))
  }
  const windowSize=await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0],size=window.getSize();window.setSize(1100,760);return size})
  await page.getByRole('button',{name:'Design Approach',exact:true}).waitFor()
  await page.screenshot({path:'/tmp/frameui-design-approach-chat.png'})
  await page.getByRole('button',{name:'Design Approach',exact:true}).click()
  await page.screenshot({path:'/tmp/frameui-design-approach-menu.png'})
  await page.getByRole('menuitemradio',{name:/^Redesign Screen/}).press('Escape')
  const compactSend=await page.getByRole('button',{name:'Run Claude',exact:true}).boundingBox(),compactViewport=await page.evaluate(()=>({height:innerHeight}))
  assert(compactSend.y+compactSend.height<compactViewport.height,'compact composer must remain visible')
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),windowSize)
  const reference=await page.screenshot()
  fs.writeFileSync(path.join(root,'expected-image'),reference.toString('base64'))
  await page.getByLabel('Attach reference screenshot').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:reference})
  await page.getByAltText('Attached design reference').waitFor()
  await page.getByRole('button',{name:'Remove reference',exact:true}).click()
  await page.getByLabel('Ask Claude',{exact:true}).evaluate((el,base64)=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}))},reference.toString('base64'))
  await page.getByAltText('Attached design reference').waitFor()
  await page.getByLabel('Ask Claude',{exact:true}).fill('Create an editable screen')
  await page.getByRole('button',{name:'Run Claude',exact:true}).click()
  await page.getByText('Created your editable screen through Claude Code.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Run Claude',exact:true}).waitFor()
  assert.equal(await page.getByAltText('Submitted design reference').count(),1,'sent image belongs to the message')
  assert.equal(await page.getByAltText('Attached design reference').count(),0,'sent image must leave the composer')
  const savedDrafts=fs.readdirSync(path.join(profile,'prototype-drafts')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(profile,'prototype-drafts',n),'utf8')).data)
  assert.deepEqual(savedDrafts[0].versions[0].design,{approach:'redesign'})
  assert(JSON.parse(fs.readFileSync(path.join(root,'last-user-content'),'utf8'))[0].text.includes('Do not introduce another UI library'))
  assert(savedDrafts.some(d=>d.conversation?.some(m=>m.role==='user'&&m.reference?.startsWith('data:image/png;base64,'))),'submitted image must persist with draft conversation')
  await page.getByText('Signed in with Claude Code',{exact:true}).first().waitFor()
  assert(!fs.existsSync(fs.readFileSync(path.join(root,'last-config-path'),'utf8')),'temporary MCP config must be removed')
  await page.screenshot({path:'/tmp/frameui-claude-code-connected.png'})
  const settings=fs.readFileSync(path.join(profile,'ai-provider.json'),'utf8')
  assert(settings.includes('claude-code'));assert(!settings.includes('Bearer'))
  await page.getByRole('button',{name:'Import to FrameUI',exact:true}).click()
  await page.getByRole('button',{name:'Confirm import',exact:true}).click()
  await page.getByRole('region',{name:'AI Prototype Studio',exact:true}).waitFor({state:'hidden'})
  await page.getByRole('button',{name:'New chat',exact:true}).click()
  await page.getByLabel('Attach reference screenshot').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:reference})
  await page.getByAltText('Attached design reference').waitFor()
  await page.getByRole('textbox',{name:/Ask Claude/}).fill('Failure test')
  await page.getByRole('button',{name:'Run Claude',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'did not finish'}).waitFor()
  await page.getByRole('button',{name:'Edit and retry',exact:true}).click()
  await page.getByAltText('Attached design reference').waitFor()
  assert.equal(await page.getByRole('textbox',{name:/Ask Claude/}).inputValue(),'Failure test')
  await page.getByRole('textbox',{name:/Ask Claude/}).fill('Cancel this task')
  await page.getByRole('button',{name:'Run Claude',exact:true}).click()
  for(let i=0;i<100&&!fs.existsSync(path.join(root,'waiting'));i++)await new Promise(r=>setTimeout(r,50))
  assert(fs.existsSync(path.join(root,'waiting')))
  await page.getByRole('button',{name:'Stop',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'cancelled'}).waitFor()
  await page.getByRole('button',{name:'Provider settings',exact:true}).click()
  await page.getByRole('button',{name:'Disconnect',exact:true}).click()
  await page.getByRole('button',{name:'Use existing Claude Code login',exact:true}).waitFor()
  assert(fs.existsSync(path.join(root,'signed-in')),'disconnect must preserve external Claude Code login')
  console.log('PASS: official-CLI flow, login failure/success, reference images, private MCP tools, source-write boundary, editable canvas, rendered images, failure handling, cancellation, temporary cleanup, disconnect without logout.')
 }finally{if(app)await app.close();if(reviewProfile)fs.rmSync(reviewProfile,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1})
