// Exercises real Electron IPC and canvas UI against a deterministic mock Anthropic transport.
// No API key, real CLI login, paid requests, or user projects are touched.
const {_electron}=require('playwright-core')
const http=require('node:http')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-claude-smoke-'))
 fs.writeFileSync(path.join(root,'ant'),'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ant test"; else echo "test-cli-access-token"; fi\n',{mode:0o700})
 const env={...process.env,PATH:root+path.delimiter+process.env.PATH,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
 let app,reviewProfile
 const runtime=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0"><div style="position:absolute;left:40px;top:40px;font:32px/45px sans-serif">Customer management</div></body></html>')})
 await new Promise(resolve=>runtime.listen(0,'127.0.0.1',resolve))
 const runtimeUrl=`http://127.0.0.1:${runtime.address().port}/`
 try{
  const packaged=process.env.FRAMEUI_PACKAGED_APP
  app=await _electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.',`--user-data-dir=${path.join(root,'profile')}`],env})
  const profile=await app.evaluate(({app})=>app.getPath('userData'))
  if(packaged){assert(path.basename(profile).startsWith('review-'));reviewProfile=profile}
  await app.evaluate(()=>{
   let turn=0
   globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'claude-test',display_name:'Claude test transport'}]}),{status:200})
    const request=JSON.parse(options.body)
    if(options.headers.authorization!=='Bearer test-cli-access-token')throw new Error('Wrong auth transport')
    const use=(name,input)=>({type:'tool_use',id:'tool-'+Math.random().toString(16).slice(2),name,input})
    let content
    if(turn++===0)content=[use('find_component',{query:'Button'}),use('create_artboard',{name:'AI Users',width:800,height:600})]
    else if(turn===2){const result=request.messages.at(-1).content.find(r=>r.content?.[0]?.text?.includes('AI Users'));const page=JSON.parse(result.content[0].text);content=[use('create_text',{pageId:page.id,text:'Customer management',name:'AI heading',x:40,y:40,width:600,height:50,fontSize:32}),use('render_artboard',{pageId:page.id})]}
    else content=[{type:'text',text:'Created an editable customer management artboard.'}]
    return new Response(JSON.stringify({content,stop_reason:content.some(b=>b.type==='tool_use')?'tool_use':'end_turn'}),{status:200})
   }
  })
  const page=await app.firstWindow();page.setDefaultTimeout(30000)
  const skip=page.getByRole('button',{name:'Skip introduction',exact:true});if(await skip.isVisible().catch(()=>false))await skip.click()
  await page.getByRole('button',{name:'Create Blank Design',exact:true}).click()
  await page.getByRole('button',{name:'Claude',exact:true}).click()
  await page.getByRole('heading',{name:'Design with Claude',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Ask Claude',{exact:true}).count(),0)
  await page.getByText('Use an API key instead',{exact:true}).click()
  await page.getByRole('button',{name:'Connect Claude',exact:true}).waitFor()
  await page.screenshot({path:'/tmp/frameui-claude-login.png'})
  const panel = page.getByRole('region', {name:'Claude assistant'})
  assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Login screen must not overflow horizontally')
  await page.getByRole('button',{name:'Workspace settings',exact:true}).click()
  await page.getByRole('button',{name:'dark appearance',exact:true}).click()
  await page.getByRole('button',{name:'Done',exact:true}).click()
  await page.screenshot({path:'/tmp/frameui-claude-login-dark.png'})
  await page.getByRole('button',{name:'Workspace settings',exact:true}).click()
  await page.getByRole('button',{name:'light appearance',exact:true}).click()
  await page.getByRole('button',{name:'Done',exact:true}).click()
  await app.evaluate(()=>{globalThis.__mockClaudeTransport=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:401})})
  await page.getByRole('button',{name:'Use existing Anthropic CLI login',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Anthropic rejected the connection'}).waitFor()
  assert(!(await panel.innerText()).includes('Error invoking remote method'))
  assert.equal(await page.getByLabel('Ask Claude',{exact:true}).count(),0)
  await app.evaluate(()=>{globalThis.fetch=globalThis.__mockClaudeTransport;delete globalThis.__mockClaudeTransport})

  await page.getByRole('button',{name:'Use existing Anthropic CLI login',exact:true}).click()
  await page.getByLabel('Connected',{exact:true}).waitFor()
  await page.getByLabel('Ask Claude',{exact:true}).fill('Create a customer management screen')
  await page.getByRole('button',{name:'Run Claude',exact:true}).click()
  await page.getByText('Created an editable customer management artboard.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Import to FrameUI',exact:true}).click()
  await page.getByRole('button',{name:'Confirm import',exact:true}).click()
  await page.getByRole('region',{name:'AI Prototype Studio',exact:true}).waitFor({state:'hidden'})

  await page.getByText('Customer management',{exact:true}).first().waitFor()
  await page.screenshot({path:'/tmp/frameui-ai-smoke.png'})
  const docs=await page.evaluate(async()=>{await window.frameuiFlushSaves?.();const list=await window.frameui.design.list();return Promise.all(list.map(d=>window.frameui.design.load(d.id)))})
  const created=docs.flatMap(d=>d?.pages??[]).find(p=>p.name==='AI Users')
  assert(created?.structured,'AI artboard must use the native document model')
  assert.equal(created.structured.children[0].typography.text,'Customer management')
  assert.equal(created.structured.children[0].bounds.x,40)
  await page.getByText('Customer management',{exact:true}).first().dblclick()
  const editor=page.locator('[contenteditable="true"]').first();await editor.fill('Edited by the designer');await editor.press('Meta+Enter')
  await page.getByText('Edited by the designer',{exact:true}).first().waitFor()
  await page.getByRole('button',{name:'Claude',exact:true}).click()
  const settings=fs.readFileSync(path.join(profile,'ai-provider.json'),'utf8')
  assert(!settings.includes('test-cli-access-token'),'credential must never be persisted in provider settings')
  assert(!JSON.stringify(docs).includes('test-cli-access-token'))
  const repo=path.join(root,'repo');fs.mkdirSync(repo)
  fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'ai-fixture',dependencies:{react:'18.3.1'},scripts:{test:'node -e "console.log(123)"'}}))
  fs.writeFileSync(path.join(repo,'index.html'),'<h1>Fixture</h1>')
  fs.writeFileSync(path.join(repo,'Button.tsx'),'export function Button(){return <button style={{backgroundColor: "#246bfe", color: "white", padding: "12px"}}>Project button</button>}')
  fs.writeFileSync(path.join(repo,'a.ts'),"export const label = 'Before';")
  const projectId=await page.evaluate(async repo=>{await window.frameui.project.openPath(repo);return (await window.frameui.project.getIndex()).projectId},repo)
  const componentId=await page.evaluate(async()=>(await window.frameui.project.getIndex()).projectModel.components.find(c=>c.name==='Button')?.id)
  assert(componentId,'fixture component must be indexed')
  await assert.rejects(()=>page.evaluate(async ({document,projectId})=>window.frameui.ai.run({document:{...document,projectId},pageId:document.pages[0].id,selection:[],prompt:'Implement this directly',mode:'code',style:'project'}),{document:docs.find(d=>d?.pages.length),projectId}),/design/)
  assert.equal(fs.readFileSync(path.join(repo,'a.ts'),'utf8'),"export const label = 'Before';")
  await app.evaluate(()=>{globalThis.fetch=(_url,options)=>new Promise((_resolve,reject)=>{globalThis.__waitingForCancel=true;options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})})})
  await page.evaluate(({document,projectId})=>{window.__cancelResult=window.frameui.ai.run({document:{...document,projectId},pageId:document.pages[0].id,selection:[],prompt:'Cancellation test',mode:'design',style:'project'}).then(()=> 'unexpected success',error=>String(error));return true},{document:docs.find(d=>d?.pages.length),projectId})
  for(let i=0;i<100;i++){if(await app.evaluate(()=>!!globalThis.__waitingForCancel))break;await new Promise(r=>setTimeout(r,20))}
  await page.evaluate(()=>window.frameui.ai.cancel())
  assert((await page.evaluate(()=>window.__cancelResult)).includes('cancelled'))
  await page.getByRole('button',{name:'Provider settings',exact:true}).click()
  await page.getByRole('button',{name:'Disconnect',exact:true}).click()
  await page.getByRole('heading',{name:'Design with Claude',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Ask Claude',{exact:true}).count(),0,'Disconnected users must see setup, not a disabled composer')
  console.log('PASS: isolated CLI access, Messages tool loop, activity, structured editable artboard, persistence, repository implementation blocked in FrameUI (developer handoff only), manual editing, cancellation, provider disconnect and no token in renderer documents/settings.')
 }finally{if(app)await app.close();runtime.close();if(reviewProfile)fs.rmSync(reviewProfile,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1})
