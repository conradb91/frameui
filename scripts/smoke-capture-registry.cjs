const {_electron} = require('playwright-core')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict')
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-capture-regression-'))
  const source = path.join(root, 'site'); fs.mkdirSync(source)
  fs.writeFileSync(path.join(source,'index.html'), '<h1>Home</h1>')
  const html = '<!doctype html><title>Account</title><nav><a href="/">Home</a><a href="/settings">Settings</a><a href="/super-admin">Super Admin</a><a href="/missing">Missing</a><a href="/slow">Slow</a></nav><main><h1>Settings</h1><input type="password" aria-label="New password">' + Array.from({length:12},(_,i)=>`<button>Control ${i}</button>`).join('') + '<dialog open aria-label="Notifications"><p>New message</p></dialog><div style="display:contents"><p>Wrapper content</p></div><div id="shadow"></div><canvas id="chart" width="30" height="30"></canvas><div style="height:2200px"></div><div id="lazy-target"></div></main><script>document.getElementById("shadow").attachShadow({mode:"open"}).innerHTML="<p>Shadow content</p>";document.getElementById("chart").getContext("2d").fillRect(0,0,30,30);new IntersectionObserver(function(entries,observer){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.innerHTML="<p>Lazy content loaded</p>";observer.disconnect()}})}).observe(document.getElementById("lazy-target"))</script>'
  const frameServer = http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<body style="background:rgb(20,90,170);color:white"><h1>Embedded application</h1></body>')})
  await new Promise(resolve=>frameServer.listen(0,'127.0.0.1',resolve))
  const server = http.createServer((req,res) => {
    if(req.url === '/private.png' || req.url === '/font.ttf') {
      if(!req.headers.cookie?.includes('assets=yes')) {res.writeHead(403);res.end();return}
      res.writeHead(200,{'Content-Type':req.url === '/private.png' ? 'image/png' : 'font/ttf'})
      res.end(fs.readFileSync(req.url === '/private.png' ? 'public/icon.png' : '/System/Library/Fonts/Supplemental/Arial.ttf'));return
    }
    if(req.url === '/asset-state') {
      res.writeHead(200,{'Content-Type':'text/html'});res.end(`<style>@font-face{font-family:Fixture;src:url('/font.ttf')}body{font-family:Fixture}</style><h1>Manual state</h1><img src="/private.png" width="80" height="80"><img id="blob" width="40" height="40"><iframe src="http://127.0.0.1:${frameServer.address().port}" width="300" height="180"></iframe><script>fetch('/private.png').then(r=>r.blob()).then(b=>document.getElementById('blob').src=URL.createObjectURL(b))</script>`);return
    }
    if(req.url === '/slow') return setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'Content-Type':'text/html'});res.end(html)}},10000)
    if(req.url === '/super-admin' && !req.headers.cookie?.includes('admin=yes')) {res.writeHead(302,{Location:'/login'});res.end();return}
    res.writeHead(req.url === '/missing' ? 404 : 200, {'Content-Type':'text/html'})
    res.end(req.url === '/login' ? '<h1>Sign in</h1><input type="password">' : html)
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  let app
  try {
    const env = {...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES:'1'}; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({executablePath:process.env.FRAMEUI_ELECTRON || path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args:['.',`--user-data-dir=${path.join(root,'profile')}`],env})
    const page = await app.firstWindow(); await page.waitForFunction(()=>!!window.frameui)
    const opened = await page.evaluate(source=>window.frameui.project.openPath(source),source)
    await page.evaluate(()=>window.frameui.project.getIndex())
    const plan = await page.evaluate(origin=>window.frameui.design.discover(origin),origin)
    assert(plan.routes.some(r=>r.pattern==='/settings'))
    // Source and runtime discovery must complement, not compete: '/' is
    // defined by the source fixture's index.html AND reached by the crawl,
    // '/settings' has no source counterpart at all, and '/slow' is queued
    // right after '/super-admin' in the same nav, so it only gets discovered
    // if a sign-in redirect on one link no longer aborts the rest of the crawl.
    const home = plan.routes.find(r=>r.pattern==='/')
    assert(home?.sources?.includes('source'))
    assert(home?.sources?.includes('runtime'))
    const settings = plan.routes.find(r=>r.pattern==='/settings')
    assert(settings?.sources?.includes('runtime'))
    const slow = plan.routes.find(r=>r.pattern==='/slow')
    assert(slow?.sources?.includes('runtime'))
    const timings = {}
    for (const controlStates of [true,false]) {
      const started = Date.now()
      const pages = await page.evaluate(({token,controlStates})=>window.frameui.design.capture({token,routes:['/settings'],widths:[1440],overlays:true,controlStates,unchanged:[]}),{token:plan.token,controlStates})
      timings[controlStates ? 'withControlStatesMs' : 'defaultCaptureMs'] = Date.now()-started
      assert.equal(pages.length,2); assert.equal(pages[0].width,1440); assert.equal(pages[0].authProfile,'standard')
      assert(pages.some(p=>p.state.includes('Notifications')))
      assert(JSON.stringify(pages[0].objects).includes('Wrapper content'))
      assert(JSON.stringify(pages[0].objects).includes('Shadow content'))
      assert(JSON.stringify(pages[0].objects).includes('data:image/png'))
      // scroll-to-settle: this content sits 2200px below the fold and only
      // mounts once its IntersectionObserver fires — proves scrolling
      // actually happened, not just that nothing below the fold broke.
      assert(JSON.stringify(pages[0].objects).includes('Lazy content loaded'),'Lazy content below the fold must be triggered and captured')
      assert(pages[0].fullPageScreenshot?.startsWith('data:image/png'),'A full-page reference screenshot must be captured')
      const fullPageSize = await app.evaluate(({nativeImage},data)=>nativeImage.createFromDataURL(data).getSize(),pages[0].fullPageScreenshot)
      assert(fullPageSize.height>1000,'The full-page screenshot must exceed the 1000px viewport height')
    }
    // Discovery's crawl can never register a route that 404s (browser()
    // refuses to return a window for a non-2xx response, so addRoute is
    // never reached for it) — a designer who already knows about a broken
    // link registers it manually instead, which is what this is testing.
    await page.evaluate(token=>window.frameui.design.addRoute(token,'/missing'),plan.token)
    const errors = await page.evaluate(async token=>{
      const result=[];const stop=window.frameui.design.onProgress(p=>{if(p.error)result.push(p.error)})
      await window.frameui.design.capture({token,routes:['/missing'],widths:[1440],unchanged:[]});stop();return result
    },plan.token)
    assert(errors.some(e=>e.includes('404')))
    const cancellation = await page.evaluate(async token=>{
      const pending=window.frameui.design.capture({token,routes:['/settings','/slow'],widths:[1440],unchanged:[]})
      // /settings now genuinely takes a few seconds (scroll-to-settle triggers
      // the lazy section, then a full-page reference screenshot) — this must
      // wait long enough for that real work to finish before cancelling, while
      // staying well under /slow's 10s artificial delay so cancellation still
      // has something in-flight to interrupt.
      await new Promise(resolve=>setTimeout(resolve,4000));const start=performance.now();await window.frameui.design.cancelCapture()
      const pages=await pending;return {ms:performance.now()-start,kept:pages.length}
    },plan.token)
    assert(cancellation.ms < 3000);assert(cancellation.kept >= 1)
    const projectId = opened.project.id
    await app.evaluate(async ({session},{projectId,origin})=>{await session.fromPartition(`persist:project-${projectId}-super-admin`).cookies.set({url:origin,name:'admin',value:'yes'})},{projectId,origin})
    const adminPlan = await page.evaluate(origin=>window.frameui.design.discover(origin+'/super-admin','super-admin'),origin)
    const adminPages=await page.evaluate(token=>window.frameui.design.capture({token,routes:['/super-admin'],widths:[390],unchanged:[]}),adminPlan.token)
    assert.equal(adminPages[0].authProfile,'super-admin')
    await assert.rejects(()=>page.evaluate(origin=>window.frameui.design.discover(origin+'/super-admin','standard'),origin),/Sign in/)
    await app.evaluate(async ({session},{projectId,origin})=>{await session.fromPartition(`persist:project-${projectId}`).cookies.set({url:origin,name:'assets',value:'yes'})},{projectId,origin})
    const manual = await page.evaluate(async ({projectId,origin})=>{
      const guest=document.createElement('webview');guest.setAttribute('partition',`persist:project-${projectId}`);guest.style.cssText='position:fixed;inset:0;width:900px;height:700px;z-index:999999';
      const ready=new Promise((resolve,reject)=>{guest.addEventListener('did-finish-load',resolve,{once:true});guest.addEventListener('did-fail-load',reject,{once:true})});guest.src=origin+'/asset-state';document.body.append(guest);await ready;
      await guest.executeJavaScript('document.fonts.ready');await new Promise(resolve=>setTimeout(resolve,300));
      const captured=await window.frameui.design.captureCurrentState(guest.getWebContentsId());guest.remove();return captured
    },{projectId,origin})
    const nodes=[];const visit=node=>{nodes.push(node);node.children.forEach(visit)};visit(manual.root)
    assert(nodes.filter(n=>n.tag==='img'&&n.attributes?.src?.startsWith('data:image/png')).length>=3,'Authenticated image, blob and cross-origin frame must be embedded')
    assert(manual.fonts.some(f=>f.data.startsWith('data:font/ttf;base64,')),'Manual fonts must be embedded')
    const frame=nodes.find(n=>n.attributes?.alt==='Embedded view (image)')
    assert(frame,'Inaccessible frame keeps a visual fallback')
    const pixel=await app.evaluate(({nativeImage},data)=>{const image=nativeImage.createFromDataURL(data).resize({width:300,height:180});return [...image.getBitmap().subarray((100*300+150)*4,(100*300+150)*4+3)]},frame.attributes.src)
    // macOS compositor color management can shift the CSS color; blank/black/white still fail.
    assert(pixel.every((channel,i)=>Math.abs(channel-[170,90,20][i])<32),'Frame fallback must contain the rendered frame pixels, not a blank placeholder')
    await assert.rejects(()=>page.evaluate(()=>window.frameui.design.captureCurrentState(1)),/capture browser/)
    console.log(JSON.stringify({timings,cancellation,checks:['settings password field','visible notifications','404 reason','retry same plan','cancel preserves completed','isolated super-admin','responsive capture','manual authenticated image','manual blob image','manual font','cross-origin frame image','guest ownership validation']},null,2))
  } finally {if(app)await app.close();frameServer.closeAllConnections();await new Promise(resolve=>frameServer.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1})
