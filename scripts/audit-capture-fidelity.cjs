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
import {SETTLE_REVEALS_SCRIPT} from './src/main/ipc/handlers/capture/revealAnimations'
import {enableCaptureMotion} from './src/main/ipc/handlers/cdp/captureMotion'
import {captureFullPageScreenshot} from './src/main/ipc/handlers/capture/fullPageScreenshot'
import assert from 'node:assert/strict'
import {scrollToSettle} from './src/main/ipc/handlers/capture/scrollToSettle'
import {EXPAND_ARTIFACT_PANELS_SCRIPT} from './src/main/ipc/handlers/capture/contentHeight'
import {renderAndCompareStructuredCapture} from './src/main/ipc/handlers/capture/renderAndCompareStructuredCapture'
import {renderedExportText} from './src/main/export/renderedText'
import {captureCompletenessWarnings} from './src/core/capture-compiler/completeness'
import fs from 'node:fs'
import http from 'node:http'
import {PNG} from 'pngjs'
import pixelmatch from 'pixelmatch'
import {captureDomSnapshot} from './src/main/ipc/handlers/cdp/domSnapshot'
import {buildXdDocument,validateXdEntries} from './src/core/export/xdDocument'
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
 for(const width of (process.env.FRAMEUI_AUDIT_WIDTHS?process.env.FRAMEUI_AUDIT_WIDTHS.split(',').map(Number):[390,1440])){
  assert(Number.isInteger(width)&&width>=240&&width<=3840,'Supported capture width');
  const height=1000
  const win=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{backgroundThrottling:false,partition}})
  const render=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{backgroundThrottling:false}})
  await win.loadURL('about:blank')
  await enableCaptureMotion(win.webContents)
  await win.loadURL(url)
  if(process.env.FRAMEUI_AUDIT_CLICK_SELECTOR)await win.webContents.executeJavaScript('document.querySelector('+JSON.stringify(process.env.FRAMEUI_AUDIT_CLICK_SELECTOR)+')?.click()')
  if(process.env.FRAMEUI_AUDIT_EXPAND_PANELS)await win.webContents.executeJavaScript(EXPAND_ARTIFACT_PANELS_SCRIPT)
  if(process.env.FRAMEUI_AUDIT_URL||process.env.FRAMEUI_AUDIT_EXPAND_PANELS) await scrollToSettle(win,AbortSignal.timeout(120000))
  await win.webContents.executeJavaScript(SETTLE_REVEALS_SCRIPT)
  if(process.env.FRAMEUI_AUDIT_SCROLL_SELECTOR)await win.webContents.executeJavaScript('document.querySelector('+JSON.stringify(process.env.FRAMEUI_AUDIT_SCROLL_SELECTOR)+')?.scrollIntoView({block:"center"})')
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))')
  await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation-play-state:paused!important}')
  const tree=await captureDomSnapshot(win.webContents,{width,height})
  const sourceImage=await win.webContents.capturePage()
  const warnings=[]
  const fonts=await captureResources(win.webContents,tree,url,AbortSignal.timeout(30000),new Map(),warnings)
  const frame=makeStructuredFrame(tree,{name:'Audit',route:url,width,height,durationMs:0});frame.fonts=fonts
  if(process.env.FRAMEUI_ASSERT_COMPLETENESS)assert.deepEqual(captureCompletenessWarnings(tree,frame),[],'Capture structural checks must pass')
  const html=renderStructuredFrameToHtml(frame)
  const htmlPath=output+'/'+width+'.html';fs.writeFileSync(htmlPath,html)
  fs.writeFileSync(output+'/'+width+'.json',JSON.stringify({tree,frame,warnings},null,2))
  await render.loadFile(htmlPath)
  await render.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))')
  const comparisonHeight=Math.max(1,Math.min(height,frame.height))
  const original=sourceImage.resize({width,height}).crop({x:0,y:0,width,height:comparisonHeight}).toPNG()
  const captured=(await render.webContents.capturePage()).resize({width,height}).crop({x:0,y:0,width,height:comparisonHeight}).toPNG()
  fs.writeFileSync(output+'/'+width+'-original.png',original);fs.writeFileSync(output+'/'+width+'-captured.png',captured)
  const a=PNG.sync.read(original),b=PNG.sync.read(captured),diff=new PNG({width,height:comparisonHeight})
  const changed=pixelmatch(a.data,b.data,diff.data,width,comparisonHeight,{threshold:0.15})
  fs.writeFileSync(output+'/'+width+'-diff.png',PNG.sync.write(diff))
  const texts=[];const visit=ns=>ns.forEach(n=>{if(n.typography)texts.push(n.typography.text);visit(n.children)});visit(frame.children)
  if(!process.env.FRAMEUI_AUDIT_URL&&!process.env.FRAMEUI_QUALITY_AUDIT&&!process.env.FRAMEUI_AUDIT_FIXTURE){
    assert(changed/(width*comparisonHeight)<0.005,'Fixture must remain below 0.5% pixel difference')
    assert(texts.includes('NEW'));assert(texts.includes('Current value'))
    const controls=[];const collect=ns=>ns.forEach(n=>{if(n.source.control)controls.push(n.source.control);collect(n.children)});collect(frame.children)
    assert(controls.some(c=>c.type==='range' && c.value==='7' && c.min==='1' && c.max==='9'))
    assert(controls.some(c=>c.type==='checkbox' && c.checked));assert(controls.some(c=>c.type==='radio' && c.checked))
    assert(texts.includes('const total = 1;\\n  total += 2;\\n    done();'))
    assert(fonts.some(font=>font.unicodeRange),'Imported font unicode ranges must survive capture')
  }
  if(process.env.FRAMEUI_AUDIT_FIXTURE&&!process.env.FRAMEUI_TEXT_AUDIT&&!process.env.FRAMEUI_GENERAL_AUDIT&&!process.env.FRAMEUI_LIST_AUDIT){const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children)});walk(frame.children);assert(!all.some(n=>n.type==='RasterFallback'));assert(all.some(n=>n.appearance.transform),'Affine geometry must be recovered');assert(all.some(n=>n.source.svgGeometry?.definitions?.includes('feGaussianBlur')),'Referenced SVG filter must survive');assert(changed/(width*comparisonHeight)<0.005,'SVG and affine fixture must remain below 0.5% pixel difference')}
  if(process.env.FRAMEUI_LIST_AUDIT){
    for(const marker of ['• ','■ ','III. ','IV. '])assert(texts.includes(marker),'Editable list marker missing: '+marker)
    assert(changed/(width*comparisonHeight)<.002,'List capture must remain below 0.2% pixel difference')
    const built=buildXdDocument({jobId:'list-audit',scope:'all',includePrototype:false,document:{version:1,id:'list-design',name:'Lists',updatedAt:new Date().toISOString(),pages:[{id:'list-page',name:'Lists',folder:'',pinned:false,state:'Desktop',width:frame.width,height:frame.height,structured:frame,objects:[]}],components:[],variables:[]}})
    validateXdEntries(built.entries)
    const nativeTexts=[];const walk=value=>{if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object'){if(value.type==='text')nativeTexts.push(value.text.rawText);Object.values(value).forEach(walk)}}
    for(const entry of built.entries)if(entry.path.startsWith('artwork/')&&entry.path.endsWith('.agc'))walk(JSON.parse(entry.data.toString()))
    for(const marker of ['• ','■ ','III. ','IV. '])assert(nativeTexts.includes(marker),'Native XD list marker missing: '+marker)
    fs.writeFileSync(output+'/'+width+'-lists.json',JSON.stringify({editableMarkers:texts.filter(t=>['• ','■ ','III. ','IV. '].includes(t)),nativeXdMarkers:nativeTexts.filter(t=>['• ','■ ','III. ','IV. '].includes(t)),diffPercent:changed/(width*comparisonHeight)*100},null,2))
  }
  if(process.env.FRAMEUI_SCROLL_DRAWER_AUDIT){
    const all=[];const visit=ns=>ns.forEach(n=>{all.push(n);visit(n.children)});visit(frame.children)
    const drawer=all.find(n=>n.source.classes==='drawer'),body=all.find(n=>n.source.classes==='drawer-body'),backdrop=all.find(n=>n.source.classes?.split(' ').includes('drawer-scrim'));assert(drawer&&body&&backdrop)
    assert.equal(drawer.bounds.width,360);assert.equal(drawer.bounds.x,width-360);assert.equal(drawer.bounds.y,0,'Expanding translated drawers must preserve their top edge');assert(drawer.bounds.height>2500,'Narrow fixed drawer must reveal its complete scrolling content');assert(body.bounds.height>2400);assert(backdrop.bounds.height>=drawer.bounds.height);assert(frame.height>=drawer.bounds.height)
    assert(all.some(n=>n.typography?.text==='Record 32'),'Last scroll row must remain editable')
    const reference=nativeImage.createFromDataURL(await captureFullPageScreenshot(win,AbortSignal.timeout(30000))),size=reference.getSize();assert(Math.abs(size.height/size.width-frame.height/width)<.005,'Full reference image must include fixed drawer overflow');fs.writeFileSync(output+'/'+width+'-full-reference.png',reference.toPNG())
    const doc={version:1,id:'scroll-drawer-audit',name:'Full scrolling drawer',updatedAt:'now',components:[],variables:[],pages:[{id:'drawer-page',name:'Open drawer',width,height:frame.height,folder:'',state:'',pinned:false,objects:[],structured:frame}]}
    const native=buildXdDocument({jobId:'scroll-drawer-audit',document:doc,scope:'all',includePrototype:false});validateXdEntries(native.entries)
    const resources=JSON.parse(native.entries.find(e=>e.path==='resources/graphics/graphicContent.agc').data.toString());assert(Object.values(resources.artboards).every(a=>a.width===width&&a.height===frame.height))
    assert(changed/(width*comparisonHeight)<.005,'Expanded drawer must match HTML aside from browser scrollbar chrome')
  }
  if(process.env.FRAMEUI_DRAWER_AUDIT){
    const all=[];const visit=ns=>ns.forEach(n=>{all.push(n);visit(n.children)});visit(frame.children)
    const drawer=all.find(n=>n.source.classes==='drawer'),backdrop=all.find(n=>n.source.classes==='backdrop');assert(drawer&&backdrop)
    assert.equal(frame.width,width);assert.equal(drawer.bounds.x,96);assert.equal(drawer.bounds.width,width-96);assert.equal(backdrop.bounds.width,width);assert.equal(backdrop.bounds.height,1800)
    const doc={version:1,id:'drawer-audit',name:'Drawer audit',updatedAt:'now',components:[],variables:[],pages:[{id:'drawer-page',name:'Open drawer',width,height:frame.height,folder:'',state:'',pinned:false,objects:[],structured:frame}]}
    const native=buildXdDocument({jobId:'drawer-audit',document:doc,scope:'all',includePrototype:false});validateXdEntries(native.entries)
    const resources=JSON.parse(native.entries.find(e=>e.path==='resources/graphics/graphicContent.agc').data.toString());assert(Object.values(resources.artboards).every(a=>a.width===width))
    assert(changed/(width*comparisonHeight)<.001,'Open drawer must visually match the original HTML')
  }
  if(process.env.FRAMEUI_PSEUDO_ICON_AUDIT){
    const pseudos=[];const walk=n=>{if(n.attributes?.['data-frameui-pseudo'])pseudos.push(n);n.children.forEach(walk)};walk(tree);
    assert.equal(pseudos.length,9,'All role markers, ticks and dashes must be captured');assert(pseudos.every(n=>n.rect.width>0&&n.rect.height>0),'CSS icons must have visible geometry');
    assert(changed/(width*comparisonHeight)<.005,'Permission icons must remain below 0.5% differing pixels');
    const built=buildXdDocument({jobId:'permission-audit',scope:'all',includePrototype:false,document:{version:1,id:'permission-design',name:'Permissions',updatedAt:new Date().toISOString(),pages:[{id:'permission-page',name:'Permissions',folder:'',pinned:false,state:'Desktop',width:frame.width,height:frame.height,structured:frame,objects:[]}],components:[],variables:[]}});validateXdEntries(built.entries);
  }
  if(process.env.FRAMEUI_CIRCLE_AUDIT){
    const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children)});walk(frame.children)
    const badges=all.filter(n=>n.source.tag==='frameui-visual'&&n.appearance.backgroundColor==='rgb(230, 238, 252)');assert.equal(badges.length,6)
    assert(badges.every(n=>n.bounds.width===21&&n.bounds.height===21&&n.appearance.radius.every(r=>r===10.5)),'Counter circles must use their CSS box, not glyph bounds')
    assert(changed/(width*comparisonHeight)<.012,'Circle fixture must stay within 1.2% differing pixels, including text antialiasing')
    const doc={version:1,id:'circles',name:'Circles',updatedAt:'now',components:[],variables:[],pages:[{id:'circles',name:'Circles',width,height:frame.height,folder:'',state:'',pinned:false,objects:[],structured:frame}]}
    const native=buildXdDocument({jobId:'circles',document:doc,scope:'all',includePrototype:false});validateXdEntries(native.entries)
    let circles=0;const visit=v=>{if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'){if(v.type==='rect'&&v.width===21&&v.height===21&&v.r?.every(r=>r===10.5))circles++;Object.values(v).forEach(visit)}};native.entries.filter(e=>e.path.startsWith('artwork/')&&e.path.endsWith('.agc')).forEach(e=>visit(JSON.parse(e.data.toString())));assert.equal(circles,6,'XD must retain all six circular backgrounds')
  }
  if(process.env.FRAMEUI_MASK_ICON_AUDIT){
    const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children)});walk(frame.children)
    assert.equal(all.filter(n=>n.source.tag==='path').length,4,'Every CSS pseudo mask arrow must remain editable geometry')
    assert(changed/(width*comparisonHeight)<.003,'CSS mask icons must preserve their appearance and disabled opacity')
    const doc={version:1,id:'mask-icons',name:'Mask icons',updatedAt:'now',components:[],variables:[],pages:[{id:'icons',name:'Pagination',width,height:frame.height,folder:'',state:'',pinned:false,objects:[],structured:frame}]}
    const native=buildXdDocument({jobId:'mask-icons',document:doc,scope:'all',includePrototype:false});validateXdEntries(native.entries)
    const scene=native.entries.filter(e=>e.path.startsWith('artwork/')&&e.path.endsWith('.agc')).map(e=>JSON.parse(e.data.toString()));let paths=0;const visit=v=>{if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'){if(v.type==='path')paths++;Object.values(v).forEach(visit)}};visit(scene);assert.equal(paths,4,'Native XD must retain every arrow path')
  }
  if(process.env.FRAMEUI_CARD_AUDIT){
    const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children)});walk(frame.children)
    assert.equal(all.filter(n=>n.source.classes==='ct').length,3)
    assert(all.filter(n=>n.source.classes==='ct').every(n=>!n.typography&&n.children.length===2),'Flex columns must keep title and subtitle boundaries')
    assert(all.filter(n=>n.source.classes==='sb2').every(n=>n.typography?.fontSize===11&&n.typography.textOverflow==='ellipsis'),'Subtitle size and ellipsis must survive')
    assert(changed/(width*comparisonHeight)<.005,'Category card and table geometry must remain within 0.5% pixel difference')
    const doc={pages:[{id:'cards',objects:[],structured:frame}]}
    const measured=await renderedExportText(render.webContents,doc,new AbortController().signal)
    const subtitle=all.find(n=>n.typography?.text==='Familiarisation, reading, knowledge and drills')
    assert(measured['cards:'+subtitle.id]?.[0]?.text.endsWith('…'),'XD must preserve the browser ellipsis instead of overflowing the subtitle')
    const reviewed=await renderAndCompareStructuredCapture({frame,originalPng:sourceImage.toPNG(),dir:output,slug:width+'-paint-review',signal:AbortSignal.timeout(30000)});assert(reviewed&&reviewed.visualMatch.diffPercent<.5,'Hidden review screenshots must wait for actual paint')

  }
  if(process.env.FRAMEUI_TEXT_AUDIT){const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children)});walk(frame.children);assert(all.some(n=>n.typography?.text==='1 Admin'&&n.typography.textRuns.some(r=>r.fontWeight==='700')),'Mixed weights must remain one editable text layer');assert(all.some(n=>n.typography?.text.includes('No surprises')&&n.typography.textRuns.some(r=>r.gradient)),'Gradient range must survive');assert(all.some(n=>n.appearance.clipX&&n.appearance.clipY&&n.appearance.radius[0]===32),'Rounded container clipping must survive');assert(!all.some(n=>n.type==='RasterFallback'));console.log('Text capture difference',width,changed/(width*comparisonHeight)*100);assert(changed/(width*comparisonHeight)<.002,'Rich text fixture must stay below 0.2% pixel difference')}
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
  results.push({width,diffPercent:changed/(width*comparisonHeight)*100,fonts:fonts.length,warnings,texts:process.env.FRAMEUI_AUDIT_URL ? {count:texts.length} : texts})
  render.destroy();win.destroy()
 }
 fs.writeFileSync(output+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));server.close();app.quit()
}).catch(e=>{console.error(e);app.exit(1)})`
buildSync({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},outfile:path.join(root,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'warning'})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
if(process.env.FRAMEUI_AUDIT_LOGIN) env.FRAMEUI_AUDIT_CREDENTIALS=fs.readFileSync(0,'utf8').trim()
const result=spawnSync(require('electron'),[path.join(root,'main.cjs')],{env,stdio:'inherit',timeout:240000})
fs.rmSync(root,{recursive:true,force:true});process.exit(result.status ?? 1)
