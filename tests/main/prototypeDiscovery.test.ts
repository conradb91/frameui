import {test,expect,beforeAll,afterAll} from 'bun:test'
import {chromium,type Browser} from 'playwright-core'
import {prototypeRouteIdentity,inspectScript,explorePrototype,type DiscoveryCheckpoint} from '../../src/main/artifacts/explorePrototype'
import {PROTOTYPE_INSTRUMENTATION_SCRIPT} from '../../src/main/artifacts/prototypePageScripts'
import {replayPrototype} from '../../src/main/artifacts/prototypeReplay'
let browser:Browser
beforeAll(async()=>{browser=await chromium.launch({channel:'chrome',headless:true})},20000)
afterAll(async()=>{await browser?.close()},20000)
async function inspect(html:string){const page=await browser.newPage();await page.addInitScript(PROTOTYPE_INSTRUMENTATION_SCRIPT);await page.goto('data:text/html;charset=utf-8,'+encodeURIComponent(html));return {page,info:await page.evaluate(inspectScript) as any}}
const open=async(url:string)=>{const page=await browser.newPage();await page.addInitScript(PROTOTYPE_INSTRUMENTATION_SCRIPT);await page.goto(url);let closed=false;return {webContents:{getURL:()=>page.url(),executeJavaScript:(script:string)=>page.evaluate(script)},isDestroyed:()=>closed,destroy:()=>{closed=true;void page.close()}} as any}
test('screen names use the visible page heading after navigation',async()=>{
 const {page,info}=await inspect('<main><section hidden><h1>Home</h1></section><section><h1>Report</h1></section></main>')
 try{expect(info.title).toBe('Report')}finally{await page.close()}
})
test('simple import keeps linked pages and navigation buttons while detailed import retains modal and disclosure states',async()=>{
 const server=Bun.serve({port:0,fetch:request=>new Response(new URL(request.url).pathname==='/next'?'<title>Next page</title><h1>Next page</h1><a href="/">Home</a>':`<title>Home</title><h1>Home</h1><a href="/next">Next page</a><button onclick="location.href='/next'">Navigation button</button><button onclick="document.querySelector('dialog').showModal()">Open details</button><dialog><h2>Details modal</h2></dialog><details><summary>More information</summary><p>Expanded information</p></details>`,{headers:{'Content-Type':'text/html'}})})
 try{
  const simple=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{mode:'simple',maxAttempts:15,maxMilliseconds:12000})
  expect(simple.states.map(state=>state.pattern).sort()).toEqual(['/','/next'])
  expect(simple.transitions.some(edge=>edge.label==='Navigation button'&&edge.kind==='navigation')).toBe(true)
  expect(simple.transitions.every(edge=>edge.action==='navigate')).toBe(true)
  expect(simple.coverage.mode).toBe('simple')
  expect(simple.coverage.pending).toBe(0)
  const detailed=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{mode:'detailed',maxAttempts:12,maxMilliseconds:12000})
  expect(detailed.transitions.some(edge=>edge.kind==='modal')).toBe(true)
  expect(detailed.transitions.some(edge=>edge.kind==='disclosure')).toBe(true)
  expect(detailed.states.length).toBeGreaterThan(simple.states.length)
  expect(detailed.coverage.mode).toBe('detailed')
 }finally{server.stop(true)}
},30000)
test('an unresolved relative link inside a bundled blob frame is reported without aborting import',async()=>{
 const server=Bun.serve({port:0,fetch:()=>new Response(`<h1>Appraisal</h1><iframe></iframe><script>document.querySelector('iframe').src=URL.createObjectURL(new Blob(['<h2>Embedded appraisal</h2><a href="Baseline.dc.html">See knowledge page</a>'],{type:'text/html'}))</script>`,{headers:{'Content-Type':'text/html'}})})
 try{
  const result=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{maxAttempts:10,maxMilliseconds:10000})
  expect(result.states.length).toBeGreaterThan(0)
  expect(result.coverage.failed).toBe(0)
  expect(result.coverage.entries.some(entry=>entry.label==='See knowledge page'&&entry.status==='blocked'&&entry.reason?.includes('no resolvable page address'))).toBe(true)
 }finally{server.stop(true)}
},20000)
test('route identity retains router hashes and sorted query state but ignores scroll anchors',()=>{
 expect(prototypeRouteIdentity('http://localhost/index.html#/settings')).not.toBe(prototypeRouteIdentity('http://localhost/index.html#/home'))
 expect(prototypeRouteIdentity('http://localhost/index.html#features')).toBe('/index.html')
 expect(prototypeRouteIdentity('http://localhost/?b=2&a=1')).toBe('/?a=1&b=2')
})
test('all 800 native controls are inventoried and full visual signatures include late elements',async()=>{
 const {page,info}=await inspect(Array.from({length:800},(_,i)=>`<button>View ${i}</button>`).join(''))
 try{expect(info.controls.filter((c:any)=>c.event==='click')).toHaveLength(800);expect(info.checkedControls).toBeGreaterThanOrEqual(800);const before=await page.evaluate(inspectScript) as any;await page.locator('button').last().evaluate(el=>el.style.backgroundColor='blue');const after=await page.evaluate(inspectScript) as any;expect(after.visual).not.toBe(before.visual)}finally{await page.close()}
},20000)
test('delegated buttons, form-local buttons, select, search, hover and shadow roots are discovered',async()=>{
 const {page,info}=await inspect(`<button>Crew profile</button><select aria-label="Status"><option>All</option><option>Outstanding</option></select><input aria-label="Search crew"><form><button type="button">View local details</button><button>Submit</button></form><div id="host"></div><div id="hint">More details</div><script>document.querySelector('button').addEventListener('mouseenter',()=>{});document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<button>Shadow view</button>';document.addEventListener('click',e=>{if(e.target.id==='hint')e.target.textContent='Expanded'})</script>`)
 try{expect(info.controls.some((c:any)=>c.label==='Crew profile'&&c.event==='click')).toBe(true);expect(info.controls.some((c:any)=>c.label==='Crew profile'&&c.event==='hover')).toBe(true);expect(info.controls.some((c:any)=>c.label==='Status'&&c.event==='open-select')).toBe(true);expect(info.controls.some((c:any)=>c.label==='Search crew'&&c.event==='input')).toBe(true);expect(info.controls.some((c:any)=>c.label==='View local details')).toBe(true);expect(info.controls.some((c:any)=>c.label==='Shadow view'&&c.selector.includes(' >>> '))).toBe(true);expect(info.controls.some((c:any)=>c.label==='More details')).toBe(true);expect(info.blocked.some((c:any)=>c.label==='Submit')).toBe(true)}finally{await page.close()}
})
test('positions and selected option values are part of state identity',async()=>{
 const {page,info}=await inspect('<select><option>All</option><option>Outstanding</option></select><div style="position:absolute;left:20px;top:50px;width:100px;height:30px"></div>')
 try{await page.locator('select').selectOption({label:'Outstanding'});const selected=await page.evaluate(inspectScript) as any;expect(selected.signature).not.toBe(info.signature);await page.locator('div').evaluate(el=>el.style.left='250px');expect((await page.evaluate(inspectScript) as any).visual).not.toBe(selected.visual)}finally{await page.close()}
})
test('typed replay opens a reconstructed native menu and selects the requested outcome',async()=>{
 const {page,info}=await inspect('<select aria-label="Status" onchange="document.querySelector(\'p\').textContent=this.value"><option>All</option><option>Outstanding</option></select><p>All</p>')
 try{const web={executeJavaScript:(script:string)=>page.evaluate(script)} as any,control=info.controls[0];await replayPrototype(web,[{selector:control.selector,event:'open-select'}]);expect(await page.getByRole('listbox').count()).toBe(1);const menu=await page.evaluate(inspectScript) as any;expect(menu.reconstructed).toBe(true);const option=menu.controls.find((c:any)=>c.label==='Outstanding'&&c.event==='select');expect(option).toBeTruthy();await replayPrototype(web,[{selector:option.target,event:'select',value:option.value}]);expect(await page.locator('p').textContent()).toBe('Outstanding');expect(await page.getByRole('listbox').count()).toBe(0)}finally{await page.close()}
})
test('exploration resumes the exact pending frontier, records failed and blocked actions, and exceeds four steps',async()=>{
 const server=Bun.serve({port:0,fetch:()=>new Response(`<h1>Deep views</h1><main>State 0</main><button onclick="if(n<7){n++;document.querySelector('main').textContent='State '+n}">View next</button><form><button>Delete record</button></form><script>let n=0</script>`,{headers:{'Content-Type':'text/html'}})})
 let checkpoint:DiscoveryCheckpoint|undefined
 try{
 const first=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{maxAttempts:2,maxMilliseconds:30000,onCheckpoint:async value=>{checkpoint=structuredClone(value)}})
 expect(first.coverage.pending).toBeGreaterThan(0);expect(first.coverage.blocked).toBeGreaterThan(0);expect(checkpoint).toBeDefined()
 const next=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{checkpoint,maxAttempts:40,maxMilliseconds:30000})
 expect(next.states).toHaveLength(8);expect(Math.max(...next.states.map(s=>s.steps.length))).toBe(7);expect(next.coverage.pending).toBe(0);expect(next.transitions).toHaveLength(7);expect(next.coverage.blocked).toBe(8);expect(next.coverage.failed).toBe(0)
 }finally{server.stop()}
},60000)

test('same-origin embedded documents and closed shadow controls replay and capture as editable native children',async()=>{
 const {reconstructSnapshotTree}=await import('../../src/main/ipc/handlers/cdp/reconstructSnapshotTree')
 const {CAPTURED_STYLE_PROPERTIES}=await import('../../src/shared/captureStyleProperties')
 const {compileStructuredNodes}=await import('../../src/core/capture-compiler/compile')
 const {page}=await inspect(`<style>iframe{position:absolute;left:150px;top:110px;width:400px;height:220px;border:2px solid black}</style><iframe srcdoc="<button onclick=&quot;this.textContent='Embedded expanded'&quot;>Embedded view</button>"></iframe><div id="closed"></div><script>const root=document.querySelector('#closed').attachShadow({mode:'closed'}),button=document.createElement('button');button.textContent='Closed view';button.onclick=()=>button.textContent='Shadow expanded';root.append(button)</script>`)
 try{
 await page.frameLocator('iframe').getByRole('button').waitFor()
 const info:any=await page.evaluate(inspectScript),embedded=info.controls.find((c:any)=>c.label==='Embedded view'),shadow=info.controls.find((c:any)=>c.label==='Closed view')
 expect(embedded.selector).toContain(' ||| ');expect(shadow.selector).toContain(' >>> ')
 const web={executeJavaScript:(script:string)=>page.evaluate(script)} as any
 await replayPrototype(web,[{selector:embedded.selector,event:'click'},{selector:shadow.selector,event:'click'}])
 await page.evaluate(inspectScript)
 const cdp=await page.context().newCDPSession(page),snapshot=await cdp.send('DOMSnapshot.captureSnapshot',{computedStyles:CAPTURED_STYLE_PROPERTIES.map(s=>s.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())),includeDOMRects:true,includePaintOrder:true})
 const root=reconstructSnapshotTree(snapshot as any,CAPTURED_STYLE_PROPERTIES,{width:1280,height:720})
 const find=(node:any,predicate:(n:any)=>boolean):any=>predicate(node)?node:node.children.map((n:any)=>find(n,predicate)).find(Boolean)
 const frame=find(root,n=>n.tag==='frameui-embedded'),button=find(frame,n=>n.attributes?.captureSelector===embedded.selector)
 expect(frame).toBeTruthy();expect(button.rect.x).toBeGreaterThanOrEqual(152);expect(button.rect.y).toBeGreaterThanOrEqual(112)
 const compiled=JSON.stringify(compileStructuredNodes(root))
 expect(compiled).toContain('Embedded expanded');expect(compiled).toContain('Shadow expanded');expect(compiled).not.toContain('RasterFallback')
 }finally{await page.close()}
},20000)

test('an empty document is not treated as a successfully rendered interface',async()=>{
 const {page,info}=await inspect('<title>Empty prototype</title>')
 try{expect(info.visible).toBe(false);await page.evaluate(()=>{document.body.innerHTML='<div style="width:100px;height:100px;background:blue"></div>'});expect((await page.evaluate(inspectScript) as any).visible).toBe(true)}finally{await page.close()}
})

test('shared hover colour rules do not turn decorative text or delegated containers into click targets',async()=>{
 const {page,info}=await inspect(`<style>.paint,.action:hover{color:#444}.tile:hover .tip{display:block}.tip{display:none}</style>${Array.from({length:200},()=>'<span class="paint">Decorative copy</span>').join('')}<div id="detail"><button type="button" id="addSp">Add Spare</button></div><div class="tile" style="width:100px;height:40px">Help<span class="tip">More detail</span></div><dialog><h3>Add Spare</h3></dialog><script>document.querySelector('#detail').addEventListener('click',e=>{if(e.target.closest('#addSp'))document.querySelector('dialog').showModal()})</script>`)
 try{
 expect(info.controls.filter((c:any)=>c.event==='click').map((c:any)=>c.label)).toEqual(['Add Spare'])
 expect(info.controls.some((c:any)=>c.event==='hover'&&c.label.includes('Help'))).toBe(true)
 expect(info.controls.some((c:any)=>c.label==='Decorative copy')).toBe(false)
 expect(info.controls.find((c:any)=>c.label==='Add Spare').priority).toBe(0)
 }finally{await page.close()}
})

test('Create opens a dialog, its client-handled submit captures validation, and selects stay inside the top layer',async()=>{
 const {page,info}=await inspect(`<button type="button" onclick="document.querySelector('dialog').showModal()">Create spare</button><dialog><h3>Add Spare</h3><form novalidate><label>Equipment<select><option>Engine</option><option>Pump</option></select></label><input readonly aria-label="Calculated status" value="Missing"><input required aria-label="Part number"><p id="validation"></p><button type="submit">Add Spare</button></form></dialog><script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();document.querySelector('#validation').textContent='Part number is required'})</script>`)
 try{
 expect(info.blocked).toHaveLength(0)
 const web={executeJavaScript:(script:string)=>page.evaluate(script)} as any
 await replayPrototype(web,[{selector:info.controls[0].selector,event:'click'}])
 const modal:any=await page.evaluate(inspectScript),submit=modal.controls.find((c:any)=>c.label==='Add Spare'&&c.event==='click')
 expect(submit).toBeTruthy();expect(modal.controls.some((c:any)=>c.label==='Calculated status')).toBe(false)
 await replayPrototype(web,[{selector:submit.selector,event:'click'}]);expect(await page.locator('#validation').textContent()).toContain('required')
 const select=modal.controls.find((c:any)=>c.event==='open-select');await replayPrototype(web,[{selector:select.selector,event:'open-select'}])
 expect(await page.locator('dialog [role="listbox"]').count()).toBe(1)
 const menu:any=await page.evaluate(inspectScript),option=menu.controls.find((c:any)=>c.event==='select'&&c.label==='Pump');expect(option).toBeTruthy()
 await replayPrototype(web,[{selector:option.target,event:'select',value:option.value}]);expect(await page.locator('select').inputValue()).toBe('Pump')
 }finally{await page.close()}
})

test('dialog controls are explored before a large frontier of filter combinations',async()=>{
 const server=Bun.serve({port:0,fetch:()=>new Response(`<style>.paint,.button:hover{color:#444}</style>${Array.from({length:80},()=>'<span class="paint">Decorative text</span>').join('')}<main><button type="button" onclick="document.querySelector('dialog').showModal()">Add Spare</button>${Array.from({length:12},(_,i)=>`<button type="button" onclick="this.textContent+=' selected'">Filter ${i}</button>`).join('')}</main><dialog><h3>Add Spare</h3><form novalidate><input required><p id="error"></p><button type="submit">Add Spare</button></form></dialog><script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();document.querySelector('#error').textContent='Required part number'})</script>`,{headers:{'Content-Type':'text/html'}})})
 try{const result=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{maxAttempts:2,maxMilliseconds:20000});expect(result.transitions).toHaveLength(2);expect(result.transitions[0]).toMatchObject({label:'Add Spare',action:'open-modal'});expect(result.transitions[1].source).toBe(result.transitions[0].destination);expect(result.coverage.pending).toBeGreaterThan(0);expect(result.coverage.complete).toBe(false)}finally{server.stop()}
},30000)

test('interaction types follow components and observed outcomes across renamed and icon-only buttons',async()=>{
 for(const label of ['Add Spare','Ouvrir','Create','Delete','⚙']){
 const server=Bun.serve({port:0,fetch:()=>new Response(`<meta charset="utf-8"><button type="button" onclick="x()">${label}</button><dialog><h3>Drawer is just a heading</h3></dialog><script>function x(){q()}function q(){document.querySelector('dialog').showModal()}</script>`,{headers:{'Content-Type':'text/html'}})})
 try{
 const candidate=await inspect(`<button onclick="x()">${label}</button><dialog></dialog><script>function x(){q()}function q(){document.querySelector('dialog').showModal()}</script>`);try{expect(candidate.info.controls[0].priority).toBe(0)}finally{await candidate.page.close()}
 const result=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{maxAttempts:1,maxMilliseconds:10000})
 expect(result.transitions).toHaveLength(1)
 expect(result.transitions[0]).toMatchObject({kind:'modal',componentType:'button',action:'open-modal',label})
 }finally{server.stop()}
 }
 const {page,info}=await inspect('<button role="tab">⚙</button><summary>Plus</summary><select><option>A</option></select>')
 try{expect(info.controls.find((c:any)=>c.label==='⚙').kind).toBe('tab');expect(info.controls.find((c:any)=>c.label==='Plus').kind).toBe('disclosure');expect(info.controls.find((c:any)=>c.event==='open-select').kind).toBe('dropdown')}finally{await page.close()}
},30000)

test('root filters are explored before nested repeat openers and dropdown choices get captured',async()=>{
 const server=Bun.serve({port:0,fetch:()=>new Response(`<button onclick="document.querySelector('dialog').showModal()">⚙</button><select aria-label="Category" onchange="document.querySelector('p').textContent=this.value"><option>All</option><option>Pump</option></select><p>All</p><dialog><h3>Panel</h3><button aria-haspopup="dialog" onclick="this.textContent='Other view'">More</button></dialog>`,{headers:{'Content-Type':'text/html;charset=utf-8'}})})
 try{const result=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{maxAttempts:4,maxMilliseconds:15000});expect(result.transitions.some(t=>t.kind==='modal')).toBe(true);expect(result.transitions.some(t=>t.source==='/'&&t.kind==='dropdown')).toBe(true);expect(result.transitions.some(t=>t.value==='Pump'&&t.kind==='dropdown')).toBe(true)}finally{server.stop()}
},20000)

test('native system dialogs are blocked by behavior even behind an arbitrarily named handler',async()=>{
 const server=Bun.serve({port:0,fetch:()=>new Response(`<button onclick="x()">Continue</button><script>function x(){window.print()}</script>`,{headers:{'Content-Type':'text/html'}})})
 try{const result=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{maxAttempts:1,maxMilliseconds:10000});expect(result.transitions).toHaveLength(0);expect(result.coverage.blocked).toBe(1);expect(result.coverage.entries.some(e=>e.reason?.includes('Native print dialog'))).toBe(true)}finally{server.stop()}
},15000)

test('unvisited root rows and hover states get a turn before repeated nested openers',async()=>{
 const server=Bun.serve({port:0,fetch:()=>new Response(`<button onclick="document.querySelector('dialog').showModal()">Open</button><div role="row" onclick="document.querySelector('main').textContent='Selected item'">Item</div><main>Initial</main><dialog><h3>Details</h3><button aria-haspopup="dialog" onclick="this.textContent='Another view'">Nested</button></dialog>`,{headers:{'Content-Type':'text/html'}})})
 try{const result=await explorePrototype(server.url.href,['/'],open,undefined,undefined,{maxAttempts:2,maxMilliseconds:10000});expect(result.transitions).toHaveLength(2);expect(result.transitions[0].kind).toBe('modal');expect(result.transitions[1]).toMatchObject({source:'/',componentType:'row',label:'Item'})}finally{server.stop()}
},15000)
