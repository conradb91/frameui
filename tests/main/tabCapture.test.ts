import {test,expect} from 'bun:test'
import {chromium} from 'playwright-core'
import {inspectScript} from '../../src/main/artifacts/explorePrototype'
import {attachTopLayer,TOP_LAYER_SCRIPT} from '../../src/main/ipc/handlers/cdp/captureTopLayer'
import {artifactFlow} from '../../src/core/prototype/artifactFlow'
import {CAPTURE_SCRIPT} from '../../src/renderer/lib/captureScript'
import {compileStructuredNodes} from '../../src/core/capture-compiler/compile'
import {PREPARE_ARTIFACT_CONTENT_SCRIPT} from '../../src/main/ipc/handlers/capture/contentHeight'
import {ungroupStructuredNodes} from '../../src/core/capture-compiler/edit'

test('scripted tabs and disclosures are discovered; clipped tables remain complete and editable',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{
 const page=await browser.newPage()
 await page.setContent(`<div class="tabs"><button onclick="switchTab(0)">Safety</button><button onclick="switchTab(1)">Library</button><button onclick="switchTab(2)">Training</button></div><div id="panel">Safety content</div><details><summary>Expand crew</summary>Expanded crew details</details><div id="table" style="height:60px;overflow:auto"><table>${Array.from({length:30},(_,i)=>'<tr><td>Member '+i+'</td></tr>').join('')}</table></div><script>function switchTab(i){document.querySelector('#panel').textContent=['Safety content','Library content','Training content'][i]}</script>`)
 const info:any=await page.evaluate(inspectScript)
 expect(info.controls.filter((c:any)=>c.kind==='tab').map((c:any)=>c.label)).toEqual(['Safety','Library','Training'])
 expect(info.controls.some((c:any)=>c.label==='Expand crew')).toBe(true)
 const signatures=new Set<string>()
 for(const tab of info.controls.filter((c:any)=>c.kind==='tab')){await page.locator(tab.selector).click();signatures.add((await page.evaluate(inspectScript) as any).signature)}
 expect(signatures.size).toBe(3)
 const before=await page.locator('#table').boundingBox()
 await page.evaluate(PREPARE_ARTIFACT_CONTENT_SCRIPT)
 expect(await page.locator('#table').boundingBox()).toEqual(before)
 const root:any=await page.evaluate(CAPTURE_SCRIPT),nodes=compileStructuredNodes(root)
 const find=(ns:any[],predicate:(n:any)=>boolean):any=>{for(const n of ns){if(predicate(n))return n;const child=find(n.children,predicate);if(child)return child}}
 const container=find(nodes,n=>n.appearance.clipY&&JSON.stringify(n).includes('Member 29'))
 expect(find(nodes,n=>n.source.tag==='summary'&&!!n.source.selector)).toBeTruthy()
 expect(container).toBeTruthy();expect(container.bounds.height).toBe(60)
 const frame:any={children:nodes}
 const expanded=ungroupStructuredNodes(frame,[container.id])
 expect(find(expanded.children,n=>n.id===container.id)).toBeUndefined()
 expect(find(expanded.children,n=>n.typography?.text==='Member 29')).toBeTruthy()
 await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.innerHTML='<h2>Crew details</h2>';document.body.append(dialog);dialog.showModal()})
 const modalRoot:any=await page.evaluate(CAPTURE_SCRIPT),layers:any=await page.evaluate(TOP_LAYER_SCRIPT)
 attachTopLayer(modalRoot,layers)
 expect(modalRoot.children.at(-1).tag).toBe('dialog')
 expect(modalRoot.children.at(-2).attributes['data-frameui-pseudo']).toBe('backdrop')
 expect(modalRoot.children.at(-2).rect.width).toBe(1280)
 expect(Number(modalRoot.children.at(-1).styles.zIndex)).toBeGreaterThan(Number(modalRoot.children.at(-2).styles.zIndex))
 }finally{await browser.close()}
},20000)

test('all active tab screens share one horizontal flow with their trigger labels',()=>{
 const pages:any[]=['home','library','training'].map(id=>({id,name:id,route:'/'+id,width:1440,height:800,objects:[],structured:{children:['library','training'].map(k=>({id:id+k,source:{selector:k},children:[]}))}}))
 const data=artifactFlow(pages,[{source:'/home',destination:'/library',selector:'library',label:'Library',kind:'tab'},{source:'/home',destination:'/training',selector:'training',label:'Training',kind:'tab'}],'Crew')
 expect(data.flows).toHaveLength(1)
 expect(data.flows[0].artboardIds).toEqual(['home','library','training'])
 expect(pages[0].canvasY).toBe(pages[1].canvasY);expect(pages[1].canvasY).toBe(pages[2].canvasY)
 expect(pages[2].canvasX).toBeGreaterThan(pages[1].canvasX)
})

test('exploration connects every tab back to its active screen without duplicate captures',async()=>{
 const {explorePrototype}=await import('../../src/main/artifacts/explorePrototype')
 const server=Bun.serve({port:0,fetch:()=>new Response(`<title>Tabs</title><div class="tabs">${['Safety','Library','Training'].map((label,i)=>`<button onclick="document.querySelector('main').textContent='${label}'">${label}</button>`).join('')}</div><main>Safety</main>`,{headers:{'Content-Type':'text/html'}})})
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{
 const result=await explorePrototype(server.url.href,['/'],async url=>{
  const page=await browser.newPage();await page.goto(url);let closed=false
  return {webContents:{executeJavaScript:(script:string)=>page.evaluate(script),getURL:()=>page.url()},isDestroyed:()=>closed,destroy:()=>{closed=true;void page.close()}} as any
 })
 expect(result.states).toHaveLength(3)
 expect(result.transitions).toHaveLength(6)
 for(const state of result.states)expect(result.transitions.filter(e=>e.source===state.pattern)).toHaveLength(2)
 expect(result.warnings).toEqual([])
 }finally{await browser.close();server.stop()}
},30000)

test('virtualized rows are harvested without changing the visible scroll viewport',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{
 const page=await browser.newPage()
 await page.setContent(`<style>*{box-sizing:border-box}#viewport{width:400px;height:120px;overflow:auto}#rows{position:relative;height:1200px}.row{position:absolute;width:400px;height:30px;background:white;border-bottom:1px solid #eee}</style><div id="viewport"><div id="rows" role="rowgroup"></div></div><script>const v=document.querySelector('#viewport'),b=document.querySelector('#rows');function render(){const start=Math.floor(v.scrollTop/30);b.innerHTML=Array.from({length:Math.min(6,40-start)},(_,i)=>'<div class="row" role="row" aria-rowindex="'+(start+i)+'" style="top:'+((start+i)*30)+'px">Member '+(start+i)+'</div>').join('')}v.addEventListener('scroll',render);render()</script>`)
 const before=await page.locator('#viewport').screenshot()
 const result:any=await page.evaluate(PREPARE_ARTIFACT_CONTENT_SCRIPT)
 expect(result.regions[0]).toMatchObject({rows:40,complete:true})
 expect(await page.locator('[role="row"]').count()).toBe(40)
 expect(await page.locator('#viewport').evaluate(el=>({height:el.clientHeight,top:el.scrollTop}))).toEqual({height:120,top:0})
 expect(await page.locator('#viewport').screenshot()).toEqual(before)
 const root:any=await page.evaluate(CAPTURE_SCRIPT)
 expect(JSON.stringify(compileStructuredNodes(root))).toContain('Member 39')
 }finally{await browser.close()}
},30000)

test('independent flows clone shared screens and keep every connection inside its own flow',()=>{
 const pages:any[]=['home','details','settings'].map(id=>({id,name:id,route:'/'+id,width:800,height:600,objects:[],structured:{children:['view','settings','back'].map(k=>({id:id+k,source:{selector:k},children:[]}))}}))
 const data=artifactFlow(pages,[{source:'/home',destination:'/details',selector:'view',label:'View details'},{source:'/home',destination:'/settings',selector:'settings',label:'Open settings'},{source:'/details',destination:'/home',selector:'back',label:'Close details'},{source:'/settings',destination:'/home',selector:'back',label:'Close settings'}],'Project')
 expect(data.flows).toHaveLength(2)
 expect(data.flows[0].artboardIds.every(id=>!data.flows[1].artboardIds.includes(id))).toBe(true)
 for(const edge of data.interactions){const owner=data.flows.find(flow=>flow.artboardIds.includes(edge.sourceArtboardId))!;expect(owner.artboardIds).toContain(edge.destinationId!)}
})
