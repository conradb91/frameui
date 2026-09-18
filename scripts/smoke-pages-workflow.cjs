const {_electron}=require('playwright-core')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-pages-workflow-')),source=path.join(root,'PageStudio')
 fs.mkdirSync(source);fs.writeFileSync(path.join(source,'package.json'),JSON.stringify({name:'page-studio',dependencies:{vite:'^5.0.0'}}));fs.writeFileSync(path.join(source,'index.html'),'<h1>Home</h1>')
 const requests=[]
 const html=body=>`<!doctype html><html><head><title>Page studio</title><style>body{font:18px Arial;padding:40px;background:#f2f5fb}main{background:white;padding:32px;border-radius:12px}label{display:block;margin:16px}input,button{padding:12px}h1{color:#2355c4}</style></head><body><main>${body}</main></body></html>`
 const server=http.createServer((req,res)=>{
  requests.push(req.url)
  if(req.url==='/login'&&req.method==='POST') {let body='';req.on('data',c=>body+=c);req.on('end',()=>{if(body.includes('password=fixture-secret')){res.writeHead(302,{'set-cookie':'session=ok; Path=/; HttpOnly',location:'/private'});res.end()}else{res.writeHead(302,{location:'/login'});res.end()}});return}
  if(req.url==='/private'&&!req.headers.cookie?.includes('session=ok')){res.writeHead(302,{location:'/login'});res.end();return}
  if(req.url==='/broken'){res.writeHead(404);res.end('Not found');return}
  res.writeHead(200,{'content-type':'text/html'})
  if(req.url==='/register'){res.end(html('<h1>Create your account</h1><form><label>Email<input name="email" type="email"></label><label>Password<input type="password"></label><button type="submit">Continue</button></form>'));return}
  if(req.url==='/login'){res.end(html('<h1>Sign in</h1><form method="post" action="/login"><label>Email<input name="email" type="email"></label><label>Password<input name="password" type="password"></label><button type="submit">Sign in</button></form>'));return}
  res.end(html(`<h1>${req.url==='/'?'Home':req.url==='/private'?'Private dashboard':'Customer workspace'}</h1><p>Editable ${req.url} screen.</p>`))
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`
 const env={...process.env,FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'};delete env.ELECTRON_RUN_AS_NODE
 let app,reviewProfile
 try{
  const executable=process.env.FRAMEUI_PACKAGED_APP
  app=await _electron.launch({executablePath:executable||require('electron'),args:executable?[]:['.',`--user-data-dir=${path.join(root,'profile')}`],env})
  if(executable){reviewProfile=await app.evaluate(({app})=>app.getPath('userData'));assert(path.basename(reviewProfile).startsWith('review-'))}
  const page=await app.firstWindow();page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.getByRole('button',{name:'Skip introduction',exact:true}).click()
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},source)
  await page.getByRole('button',{name:'Open Codebase',exact:true}).click()
  await page.getByLabel('Local preview',{exact:true}).fill(url)
  await page.getByRole('button',{name:'Prepare project',exact:true}).click()
  await page.getByRole('button',{name:'Review project',exact:true}).click()
  await page.evaluate(()=>window.frameuiFlushSaves())
  const id=await page.evaluate(async url=>{
    const [entry]=await window.frameui.design.list();const doc=await window.frameui.design.load(entry.id)
    doc.pageRegistry=['/','/customers','/customers/:id','/private','/broken'].map(pattern=>({pattern,url:url+pattern,name:pattern==='/'?'Home':pattern==='/private'?'Private dashboard':pattern==='/broken'?'Missing page':'Customers',authProfile:'standard',area:'Application',status:'Discovered',needsSample:pattern.includes(':')}));doc.pages=[];doc.appUrl=url
    await window.frameui.design.save(doc);return doc.id
  },url)
  await page.reload();await page.getByRole('button',{name:'Open PageStudio',exact:true}).click()
  const nav=page.getByRole('navigation',{name:'Project navigation'});await nav.getByRole('button',{name:'Pages',exact:true}).click()
  fs.mkdirSync('docs/verification/pages-workflow',{recursive:true})
  await page.getByLabel('light appearance').click()
  await page.locator('.pages-connection-disclosure > summary').click()
  await page.getByLabel('Running application',{exact:true}).fill('')
  await page.getByRole('button',{name:'Capture /',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Enter your local application address'}).waitFor()
  await page.getByLabel('Running application',{exact:true}).fill(url+'/private')
  await page.getByRole('button',{name:'Test connection',exact:true}).click()
  await page.getByRole('dialog',{name:'Sign in to capture these pages'}).waitFor()
  await page.getByRole('button',{name:'Not now',exact:true}).click()
  await page.getByLabel('Running application',{exact:true}).fill(url)
  await page.getByRole('button',{name:'Test connection',exact:true}).click()
  await page.getByRole('button',{name:'Connected',exact:true}).waitFor()

  await page.screenshot({path:'docs/verification/pages-workflow/initial-light.png',animations:'disabled'})
  await page.getByRole('button',{name:'Capture /',exact:true}).click()
  await page.getByRole('button',{name:'Start design',exact:true}).first().waitFor()
  assert.equal(await page.locator('webview').count(),0,'single route captures without entering capture mode')
  await page.getByLabel('Select group /customers',{exact:true}).check()
  assert(await page.getByRole('button',{name:'Capture selected pages',exact:true}).isDisabled(),'dynamic selection requires concrete path')
  await page.getByLabel('Example path for /customers/:id',{exact:true}).fill('/customers/42')
  await page.getByText('Mobile',{exact:true}).click()
  await page.getByRole('button',{name:'Capture selected pages',exact:true}).click()
  await page.getByText(/4 screens saved/).waitFor()
  await page.evaluate(()=>window.frameuiFlushSaves())
  let saved=await page.evaluate(id=>window.frameui.design.load(id),id)
  assert.equal(saved.pages.length,5);assert(saved.pages.some(p=>p.route==='/customers/:id'&&p.width===390));assert(!requests.includes('/customers/:id'))
  await page.getByRole('button',{name:'Capture /broken',exact:true}).click();await page.getByText(/Application returned HTTP 404/).first().waitFor()
  await page.getByRole('button',{name:'Capture /private',exact:true}).click()
  const auth=page.getByRole('dialog',{name:'Sign in to capture these pages'});await auth.waitFor()
  await page.screenshot({path:'docs/verification/pages-workflow/sign-in-light.png',animations:'disabled'})
  await auth.getByLabel('Email or username').fill('designer@example.test');await auth.getByLabel('Password',{exact:true}).fill('fixture-secret')
  await auth.getByRole('button',{name:'Sign in & resume',exact:true}).click();await auth.waitFor({state:'hidden'})
  await page.getByText(/2 screens saved/).waitFor()
  await page.evaluate(()=>window.frameuiFlushSaves());saved=await page.evaluate(id=>window.frameui.design.load(id),id)
  assert.equal(saved.pages.length,7);assert(saved.pages.some(p=>p.route==='/private'));assert(!JSON.stringify(saved).includes('fixture-secret'))
  assert(!saved.pages.some(p=>p.route==='/broken'))
  assert(saved.pageRegistry.find(r=>r.pattern==='/broken').captureError.includes('HTTP 404'),'route failure persists with the project')
  assert(saved.pageRegistry.find(r=>r.pattern==='/customers/:id').url.endsWith('/customers/42'),'concrete dynamic URL persists')
  assert(saved.pages.every(p=>p.structured?.children.length),'all saved screens remain structurally editable')
  // Cancellation keeps the seven completed screens and does not create a false success.
  await page.getByRole('button',{name:'Capture /customers',exact:true}).click()
  await page.getByRole('button',{name:'Stop capture',exact:true}).click()
  await page.getByText(/Capture stopped/).waitFor()
  await page.evaluate(()=>window.frameuiFlushSaves());saved=await page.evaluate(id=>window.frameui.design.load(id),id)
  assert.equal(saved.pages.length,7)
  // Validation rejects other origins and unresolved route parameters before loading.
  const rejected=await page.evaluate(async url=>{
    const results=[]
    for(const path of ['http://localhost:1/','/customers/:id','/logout']) {
      try {await window.frameui.design.prepareCapture({url,routes:[{pattern:path,path,name:'Invalid'}]});results.push(false)} catch {results.push(true)}
    }
    return results
  },url)
  assert.deepEqual(rejected,[true,true,true])
  await page.getByLabel('Capture session',{exact:true}).selectOption('admin')
  await page.getByRole('button',{name:'Capture /private',exact:true}).click()
  await auth.waitFor()
  await auth.getByRole('button',{name:'Sign in in your app',exact:true}).click()
  const guest=page.locator('webview')
  for(let i=0;i<100;i++) {
    if(await guest.evaluate(el=>el.executeJavaScript('!!document.querySelector(\'input[type="password"]\')')).catch(()=>false)) break
    await page.waitForTimeout(100)
  }
  await guest.evaluate(el=>el.executeJavaScript(`document.querySelector('[name=email]').value='designer@example.test';document.querySelector('[name=password]').value='fixture-secret';document.querySelector('form').requestSubmit()`))
  for(let i=0;i<100;i++) {if((await guest.evaluate(el=>el.getURL())).endsWith('/private'))break;await page.waitForTimeout(100)}
  await auth.getByRole('button',{name:'I’m signed in · Resume capture',exact:true}).click()
  await page.getByText(/2 screens saved/).waitFor()
  await page.evaluate(()=>window.frameuiFlushSaves());saved=await page.evaluate(id=>window.frameui.design.load(id),id)
  assert.equal(saved.pages.filter(p=>p.authProfile==='admin').length,2,'manual sign-in shares the selected capture session')
  await page.getByLabel('Capture session',{exact:true}).selectOption('standard')
  await page.getByLabel('dark appearance').click();await page.screenshot({path:'docs/verification/pages-workflow/results-dark.png',animations:'disabled'})
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isVisible()).setSize(1080,720))
  assert(await page.locator('.ide-library-main').evaluate(el=>el.scrollWidth<=el.clientWidth),'no horizontal overflow at minimum width')
  await page.screenshot({path:'docs/verification/pages-workflow/compact.png',animations:'disabled'})
  await page.getByRole('button',{name:'Start design',exact:true}).first().click();await page.getByRole('dialog',{name:'Create editable design'}).waitFor()
  const signup = await page.evaluate(async url=>{
    const plan=await window.frameui.design.prepareCapture({url,routes:[{pattern:'/register',path:'/register',name:'Register'}]})
    return (await window.frameui.design.capture({token:plan.token,routes:['/register'],widths:[1440],unchanged:[]})).length
  },url)
  assert.equal(signup,1,'a registration password form is not mistaken for required sign-in')
  assert.deepEqual(errors,[])
  console.log('PASS: direct capture, route groups, dynamic paths, multi-size batch, failed-route isolation, sign-in/resume, saved editable content and compact layout')
 }finally{if(app)await app.close();server.close();if(reviewProfile&&path.basename(reviewProfile).startsWith('review-'))fs.rmSync(reviewProfile,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1})
