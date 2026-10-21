import {test,expect,beforeAll,afterAll} from 'bun:test'
import {chromium,type Browser} from 'playwright-core'
import {prototypeRouteIdentity,inspectScript,explorePrototype,type DiscoveryCheckpoint} from '../../src/main/artifacts/explorePrototype'
import {PROTOTYPE_INSTRUMENTATION_SCRIPT} from '../../src/main/artifacts/prototypePageScripts'
import {replayPrototype} from '../../src/main/artifacts/prototypeReplay'
let browser:Browser
beforeAll(async()=>{browser=await chromium.launch({channel:'chrome',headless:true})},20000)
afterAll(async()=>{await browser?.close()},20000)
async function inspect(html:string){const page=await browser.newPage();await page.addInitScript(PROTOTYPE_INSTRUMENTATION_SCRIPT);await page.goto('data:text/html,'+encodeURIComponent(html));return {page,info:await page.evaluate(inspectScript) as any}}
const open=async(url:string)=>{const page=await browser.newPage();await page.addInitScript(PROTOTYPE_INSTRUMENTATION_SCRIPT);await page.goto(url);let closed=false;return {webContents:{getURL:()=>page.url(),executeJavaScript:(script:string)=>page.evaluate(script)},isDestroyed:()=>closed,destroy:()=>{closed=true;void page.close()}} as any}
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
 const server=Bun.serve({port:0,fetch:()=>new Response(`<h1>Deep views</h1><main>State 0</main><button onclick="if(n<7){n++;document.querySelector('main').textContent='State '+n}">View next</button><button>Delete record</button><script>let n=0</script>`,{headers:{'Content-Type':'text/html'}})})
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
