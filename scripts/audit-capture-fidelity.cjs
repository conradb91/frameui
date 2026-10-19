// Deterministic Chromium capture -> editable HTML comparison, with isolated data.
const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-fidelity-'))
const output = path.resolve(process.env.FRAMEUI_AUDIT_OUTPUT || path.join(os.tmpdir(), 'frameui-capture-audit'))
fs.mkdirSync(output, {recursive:true})
const qualityFixture=`<!doctype html><html><head><style>@import url('/font.css');*{box-sizing:border-box}body{margin:0;font:16px/24px AuditFont,Arial;color:#172b40;background:#f3f5fa}.hero{position:absolute;left:16px;top:16px;width:calc(100% - 32px);height:260px;border-radius:24px;overflow:clip;isolation:isolate;background:linear-gradient(135deg,#103958,#237790)}.hero::before{content:"";position:absolute;width:360px;height:360px;left:-150px;top:-160px;background:radial-gradient(circle,#7effb8,transparent 68%);filter:blur(12px);opacity:.8;z-index:-1}.masked{position:absolute;right:-35px;top:50px;width:210px;height:240px;mask-image:linear-gradient(90deg,transparent,#000);background:conic-gradient(from 30deg,#9d81ed,#2ce3ae,#9d81ed);mix-blend-mode:screen;opacity:.65}.hero h1{position:absolute;left:24px;top:28px;width:220px;margin:0;font:700 28px/34px Arial;color:white}.hero p{position:absolute;left:24px;top:110px;width:220px;color:#e6faf7;margin:0}.dashboard{position:absolute;left:16px;top:300px;width:calc(100% - 32px);height:280px;border-radius:18px;background:white;padding:20px;box-shadow:0 8px 24px #172b4020}.dashboard h2{font:600 20px/28px Arial;margin:0 0 20px}.dashboard button{font:600 15px/20px Arial;padding:10px 20px;background:#128e83;color:white;border:0;border-radius:12px}.dashboard input{display:block;width:260px;height:44px;border:1px solid #aab7c7;border-radius:10px;margin:16px 0;padding:10px 14px;font:16px/22px Arial;background:#f8fafc}.icon{position:absolute;right:24px;top:20px;width:28px;height:28px}.responsive{position:absolute;left:16px;top:610px;width:calc(100% - 32px);height:340px;overflow:hidden;border-radius:20px;background:linear-gradient(#e6efff,#fff)}.responsive img{position:absolute;left:20px;top:20px;width:180px;height:100px;object-fit:cover;border-radius:14px}.scaled{position:absolute;left:20px;top:150px;width:300px;height:130px;transform:scale(.8);transform-origin:top left;border:2px solid #58749b;border-radius:16px;padding:16px;background:white}.scaled p{margin:0;font:500 18px/26px Arial}.visible-overflow{position:absolute;left:280px;top:50px;width:90px;height:30px;background:#f5cd6f;overflow:visible}.visible-overflow i{position:absolute;left:75px;top:0;width:35px;height:30px;background:#ed8592}@media(max-width:600px){.visible-overflow{left:240px}}</style></head><body><section id="hero" class="hero"><div class="masked"></div><h1>Design with clarity.</h1><p>Native gradients, clipped decoration and editable text.</p></section><section class="dashboard"><h2>Your workspace</h2><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#128e83" stroke-width="2"><g transform="translate(1 1)"><path d="M2 10L8 16L18 4"/></g></svg><button>Save changes</button><input type="email" placeholder="Work email" value="designer@example.com"><input type="checkbox" checked style="width:20px;height:20px;display:inline-block;margin:0"><span> Keep me informed</span></section><section class="responsive"><img src="/image.svg"><div class="visible-overflow"><i></i></div><div class="scaled"><p>Sharp type at every zoom level.</p></div></section></body></html>`
const fixture = process.env.FRAMEUI_AUDIT_FIXTURE?fs.readFileSync(process.env.FRAMEUI_AUDIT_FIXTURE,'utf8'):process.env.FRAMEUI_QUALITY_AUDIT?qualityFixture:`<!doctype html><html><head><style>
@import url('/font.css');
*{box-sizing:border-box}body{margin:8px;font:16px/24px AuditFont,Arial;color:#203048;background:#f0f3f8}
main{padding:24px;border:3px solid #345;background:white;border-radius:12px;max-width:700px}
h1{font-size:28px;line-height:36px;margin:0 0 12px}p{margin:12px 0}.padded{padding:12px;border:2px solid #789;background:#eef}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{padding:12px;background:#e5eef8;border:2px solid #68a}
button{font:inherit;padding:10px 18px;border:2px solid #167;border-radius:8px;background:#def}
.hero{height:90px;background:url('/image.svg') center/cover no-repeat}.icon{width:40px;height:40px}pre{font:14px/20px monospace;white-space:pre;margin:12px 0}
hr{border:0;border-top:3px solid #b24;margin:16px 0}.italic{font-style:italic}.badge:before{content:'NEW';background:#fec;padding:2px 6px;margin-right:8px}
@media(max-width:500px){.grid{grid-template-columns:1fr}main{padding:12px}}
</style></head><body><main><h1>Exact capture</h1><p>Hello<span>World</span>! <em>Italic</em> and <strong>bold</strong>.</p><p class="padded">Padded text stays inside its border.</p><div class="grid"><div class="card">First card</div><div class="card">Second card</div></div><pre>const total = 1;\n  total += 2;\n    done();</pre><div class="hero"></div><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#136" stroke-width="2" stroke-linecap="round"><g transform="translate(2,2)"><path d="M2 10L8 16L18 4"/></g></svg><hr><button>Save changes</button><p class="badge">Ready to capture</p><input placeholder="Your name" value="Current value"><input type="range" min="1" max="9" value="7" style="accent-color:rgb(30,80,150)"><input type="checkbox" checked><input type="radio" checked><p>End of fixture.</p></main></body></html>`
const entry = `
import {app,BrowserWindow,session,nativeImage} from 'electron'
import {loginForCapture} from './src/main/ipc/handlers/loginForCapture'
import {enableCaptureMotion} from './src/main/ipc/handlers/cdp/captureMotion'
import {captureFullPageScreenshot} from './src/main/ipc/handlers/capture/fullPageScreenshot'
import assert from 'node:assert/strict'
import {scrollToSettle} from './src/main/ipc/handlers/capture/scrollToSettle'
import fs from 'node:fs'
import http from 'node:http'
import {PNG} from 'pngjs'
import pixelmatch from 'pixelmatch'
import {captureDomSnapshot} from './src/main/ipc/handlers/cdp/domSnapshot'
import {captureResources} from './src/main/ipc/handlers/captureResources'
import {makeStructuredFrame} from './src/core/capture-compiler/document'
import {renderStructuredFrameToHtml} from './src/core/capture-compiler/renderStructuredFrameToHtml'
app.commandLine.appendSwitch('user-data-dir',${JSON.stringify(path.join(root,'profile'))})
const output=${JSON.stringify(output)}
app.on('window-all-closed',()=>{})
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/font.css'){res.setHeader('Content-Type','text/css');res.end("@font-face{font-family:AuditFont;src:url('/font.ttf');font-weight:400;unicode-range:U+0000-00FF;}");return}
  if(req.url==='/font.ttf'){res.setHeader('Content-Type','font/ttf');res.end(fs.readFileSync('/System/Library/Fonts/Supplemental/Arial.ttf'));return}
  if(req.url==='/image.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#159"/><circle cx="60" cy="20" r="15" fill="#fd6"/></svg>');return}
  res.setHeader('Content-Type','text/html');res.end(${JSON.stringify(fixture)})
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const url=process.env.FRAMEUI_AUDIT_URL || 'http://127.0.0.1:'+server.address().port
 const partition='audit-runtime'
 if(process.env.FRAMEUI_AUDIT_CREDENTIALS){
   const credentials=JSON.parse(process.env.FRAMEUI_AUDIT_CREDENTIALS);delete process.env.FRAMEUI_AUDIT_CREDENTIALS
   const result=await loginForCapture(new URL('/login',url).href,partition,credentials.username,credentials.password)
   if(!result.ok)throw new Error(result.message)
   console.log('Authenticated read-only capture session ready')
 }
 if(process.env.FRAMEUI_AUDIT_URL) session.fromPartition(partition).webRequest.onBeforeRequest((details,callback)=>callback({cancel:!['GET','HEAD','OPTIONS'].includes(details.method)}))
 const results=[]
 for(const width of [390,1440]){
  const height=1000
  const win=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{backgroundThrottling:false,partition}})
  const render=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{backgroundThrottling:false}})
  await win.loadURL('about:blank')
  await enableCaptureMotion(win.webContents)
  await win.loadURL(url)
  if(process.env.FRAMEUI_AUDIT_URL) await scrollToSettle(win,AbortSignal.timeout(120000))
  if(process.env.FRAMEUI_AUDIT_SCROLL_SELECTOR)await win.webContents.executeJavaScript('document.querySelector('+JSON.stringify(process.env.FRAMEUI_AUDIT_SCROLL_SELECTOR)+')?.scrollIntoView({block:"center"})')
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))')
  await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation-play-state:paused!important}')
  const tree=await captureDomSnapshot(win.webContents,{width,height})
  const sourceImage=await win.webContents.capturePage()
  const warnings=[]
  const fonts=await captureResources(win.webContents,tree,url,AbortSignal.timeout(30000),new Map(),warnings)
  const frame=makeStructuredFrame(tree,{name:'Audit',route:url,width,height,durationMs:0});frame.fonts=fonts
  const html=renderStructuredFrameToHtml(frame)
  const htmlPath=output+'/'+width+'.html';fs.writeFileSync(htmlPath,html)
  fs.writeFileSync(output+'/'+width+'.json',JSON.stringify({tree,frame,warnings},null,2))
  await render.loadFile(htmlPath)
  await render.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))')
  const original=sourceImage.resize({width,height}).toPNG()
  const captured=(await render.webContents.capturePage()).resize({width,height}).toPNG()
  fs.writeFileSync(output+'/'+width+'-original.png',original);fs.writeFileSync(output+'/'+width+'-captured.png',captured)
  const a=PNG.sync.read(original),b=PNG.sync.read(captured),diff=new PNG({width,height})
  const changed=pixelmatch(a.data,b.data,diff.data,width,height,{threshold:0.15})
  fs.writeFileSync(output+'/'+width+'-diff.png',PNG.sync.write(diff))
  const texts=[];const visit=ns=>ns.forEach(n=>{if(n.typography)texts.push(n.typography.text);visit(n.children)});visit(frame.children)
  if(!process.env.FRAMEUI_AUDIT_URL&&!process.env.FRAMEUI_QUALITY_AUDIT&&!process.env.FRAMEUI_AUDIT_FIXTURE){
    assert(changed/(width*height)<0.005,'Fixture must remain below 0.5% pixel difference')
    assert(texts.includes('NEW'));assert(texts.includes('Current value'))
    const controls=[];const collect=ns=>ns.forEach(n=>{if(n.source.control)controls.push(n.source.control);collect(n.children)});collect(frame.children)
    assert(controls.some(c=>c.type==='range' && c.value==='7' && c.min==='1' && c.max==='9'))
    assert(controls.some(c=>c.type==='checkbox' && c.checked));assert(controls.some(c=>c.type==='radio' && c.checked))
    assert(texts.includes('const total = 1;\\n  total += 2;\\n    done();'))
    assert(fonts.some(font=>font.unicodeRange),'Imported font unicode ranges must survive capture')
  }
  if(process.env.FRAMEUI_AUDIT_FIXTURE&&!process.env.FRAMEUI_TEXT_AUDIT){const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children)});walk(frame.children);assert(!all.some(n=>n.type==='RasterFallback'));assert(all.some(n=>n.appearance.transform),'Affine geometry must be recovered');assert(all.some(n=>n.source.svgGeometry?.definitions?.includes('feGaussianBlur')),'Referenced SVG filter must survive');assert(changed/(width*height)<0.005,'SVG and affine fixture must remain below 0.5% pixel difference')}
  if(process.env.FRAMEUI_TEXT_AUDIT){const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children)});walk(frame.children);assert(all.some(n=>n.typography?.text==='1 Admin'&&n.typography.textRuns.some(r=>r.fontWeight==='700')),'Mixed weights must remain one editable text layer');assert(all.some(n=>n.typography?.text.includes('No surprises')&&n.typography.textRuns.some(r=>r.gradient)),'Gradient range must survive');assert(all.some(n=>n.appearance.clipX&&n.appearance.clipY&&n.appearance.radius[0]===32),'Rounded container clipping must survive');assert(!all.some(n=>n.type==='RasterFallback'));console.log('Text capture difference',width,changed/(width*height)*100);assert(changed/(width*height)<.002,'Rich text fixture must stay below 0.2% pixel difference')}
  if(process.env.FRAMEUI_QUALITY_AUDIT){
    const all=[];const collect=ns=>ns.forEach(n=>{all.push(n);collect(n.children)});collect(frame.children)
    assert(!all.some(n=>n.type==='RasterFallback'),'Supported fixture layers must remain native')
    assert(all.some(n=>n.source.control?.type==='email'&&n.source.control.value==='designer@example.com'))
    assert(all.some(n=>n.appearance.maskImage?.includes('linear-gradient')))
    assert(all.some(n=>n.source.tag==='svg'));assert(all.some(n=>n.source.tag==='path'))
    assert(all.filter(n=>n.appearance.backgroundImage?.includes('gradient')).length>=3)
    const zooms=[]
    for(const zoom of [.5,1,2]){
      win.setContentSize(Math.round(width*zoom),Math.round(height*zoom));render.setContentSize(Math.round(width*zoom),Math.round(height*zoom));win.webContents.setZoomFactor(zoom);render.webContents.setZoomFactor(zoom)
      await new Promise(r=>setTimeout(r,100));
      const original=(await win.webContents.capturePage()).toPNG(),replay=(await render.webContents.capturePage()).toPNG(),a=PNG.sync.read(original),b=PNG.sync.read(replay)
      assert.equal(a.width,b.width);assert.equal(a.height,b.height)
      const delta=new PNG({width:a.width,height:a.height}),pixels=pixelmatch(a.data,b.data,delta.data,a.width,a.height,{threshold:.15}),percent=pixels/(a.width*a.height)*100
      fs.writeFileSync(output+'/'+width+'-zoom-'+zoom+'-original.png',original);fs.writeFileSync(output+'/'+width+'-zoom-'+zoom+'-render.png',replay);fs.writeFileSync(output+'/'+width+'-zoom-'+zoom+'-diff.png',PNG.sync.write(delta));zooms.push({zoom,diffPercent:percent});console.log('Quality zoom',JSON.stringify({width,zoom,diffPercent:percent}));assert(percent<2,'Representative capture exceeds 2% visual difference')
    }
    win.webContents.setZoomFactor(1);render.webContents.setZoomFactor(1);win.setContentSize(width,height);render.setContentSize(width,height)
    const hero=all.find(n=>n.source.domId==='hero');assert(hero&&hero.children.length>1)
    const moved=structuredClone(frame),find=ns=>{for(const n of ns){if(n.id===hero.id)return n;const nested=find(n.children);if(nested)return nested}};const changed=find(moved.children);changed.bounds.x+=12;changed.bounds.y+=8;changed.bounds.width-=24;changed.bounds.height-=12
    await win.webContents.executeJavaScript('(()=>{const el=document.getElementById("hero"),r=el.getBoundingClientRect();el.style.left=(r.x+12)+"px";el.style.top=(r.y+8)+"px";el.style.width=(r.width-24)+"px";el.style.height=(r.height-12)+"px"})()')
    const modifiedPath=output+'/'+width+'-moved.html';fs.writeFileSync(modifiedPath,renderStructuredFrameToHtml(moved));await render.loadFile(modifiedPath);await render.webContents.executeJavaScript('document.fonts.ready')
    const original=(await win.webContents.capturePage()).toPNG(),replay=(await render.webContents.capturePage()).toPNG(),a=PNG.sync.read(original),b=PNG.sync.read(replay),delta=new PNG({width:a.width,height:a.height});const percent=pixelmatch(a.data,b.data,delta.data,a.width,a.height,{threshold:.15})/(a.width*a.height)*100
    fs.writeFileSync(output+'/'+width+'-moved-original.png',original);fs.writeFileSync(output+'/'+width+'-moved-render.png',replay);fs.writeFileSync(output+'/'+width+'-moved-diff.png',PNG.sync.write(delta));console.log('Quality group move/resize',JSON.stringify({width,diffPercent:percent}));assert(percent<2,'Clipping must survive group move/resize')
    fs.writeFileSync(output+'/'+width+'-quality.json',JSON.stringify({width,zooms,movedDiffPercent:percent,nativeNodes:all.length},null,2))
  }
  if(process.env.FRAMEUI_AUDIT_FULL){
    const originalFull=nativeImage.createFromDataURL(await captureFullPageScreenshot(win,AbortSignal.timeout(30000)))
    const renderedFull=nativeImage.createFromDataURL(await captureFullPageScreenshot(render,AbortSignal.timeout(30000)))
    const size=originalFull.getSize();const raw=originalFull.toPNG(),capturedFull=renderedFull.resize(size).toPNG()
    const fullA=PNG.sync.read(raw),fullB=PNG.sync.read(capturedFull),fullDiff=new PNG(size)
    const different=pixelmatch(fullA.data,fullB.data,fullDiff.data,size.width,size.height,{threshold:0.15})
    fs.writeFileSync(output+'/'+width+'-full-original.png',raw);fs.writeFileSync(output+'/'+width+'-full-captured.png',capturedFull);fs.writeFileSync(output+'/'+width+'-full-diff.png',PNG.sync.write(fullDiff))
    console.log('Full page comparison',JSON.stringify({width,frameHeight:frame.height,diffPercent:different/(size.width*size.height)*100}))
  }
  results.push({width,diffPercent:changed/(width*height)*100,fonts:fonts.length,warnings,texts:process.env.FRAMEUI_AUDIT_URL ? {count:texts.length} : texts})
  render.destroy();win.destroy()
 }
 fs.writeFileSync(output+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));server.close();app.quit()
}).catch(e=>{console.error(e);app.exit(1)})`
buildSync({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},outfile:path.join(root,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'warning'})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
if(process.env.FRAMEUI_AUDIT_LOGIN) env.FRAMEUI_AUDIT_CREDENTIALS=fs.readFileSync(0,'utf8').trim()
const result=spawnSync(require('electron'),[path.join(root,'main.cjs')],{env,stdio:'inherit',timeout:240000})
fs.rmSync(root,{recursive:true,force:true});process.exit(result.status ?? 1)
