import {test,expect} from 'bun:test'
import {prototypeRouteIdentity,inspectScript} from '../../src/main/artifacts/explorePrototype'
import vm from 'node:vm'
test('route identity retains router hashes and sorted query state but ignores scroll anchors',()=>{
 expect(prototypeRouteIdentity('http://localhost/index.html#/settings')).not.toBe(prototypeRouteIdentity('http://localhost/index.html#/home'))
 expect(prototypeRouteIdentity('http://localhost/index.html#features')).toBe('/index.html')
 expect(prototypeRouteIdentity('http://localhost/?b=2&a=1')).toBe('/?a=1&b=2')
 expect(prototypeRouteIdentity('http://localhost/?tab=one')).not.toBe(prototypeRouteIdentity('http://localhost/?tab=two'))
})
test('17th navigation is examined and unsafe controls are reported without invoking handlers',()=>{
 const controls=Array.from({length:17},(_,i)=>({tagName:'BUTTON',textContent:'Open '+i,disabled:false,form:null,parentElement:null,getAttribute:()=>null,hasAttribute:()=>false,closest:()=>null,getBoundingClientRect:()=>({width:100,height:30}),getClientRects:()=>[{}]}))
 const dangerous=[{...controls[0],textContent:'',getAttribute:(key:string)=>key==='aria-label'?'Delete':null},{...controls[0],form:{}},{...controls[0],getAttribute:(key:string)=>key==='aria-disabled'?'true':null}]
 const document={body:{innerText:'Fixture'},documentElement:{},title:'Fixture',querySelector:()=>null,querySelectorAll:(selector:string)=>selector.startsWith('a[href]')?[...controls,...dangerous]:[]}
 const info=vm.runInNewContext(inspectScript,{document,getComputedStyle:()=>({visibility:'visible',display:'block'})})
 expect(info.controls).toHaveLength(17)
 expect(info.skippedControls).toBe(3)
 expect(info.checkedControls).toBe(17)
})

test('inspection reuses geometry reads and limits visual sampling without dropping control discovery',()=>{
 let rectReads=0,styleReads=0
 const elements=Array.from({length:800},(_,i)=>({tagName:'BUTTON',textContent:'Open '+i,disabled:false,form:null,parentElement:null,getAttribute:()=>null,hasAttribute:()=>false,closest:()=>null,getBoundingClientRect:()=>{rectReads++;return {width:100,height:30}},getClientRects:()=>[{}]}))
 const document={body:{innerText:'Fixture'},documentElement:{},title:'Fixture',querySelector:()=>null,querySelectorAll:(selector:string)=>selector.startsWith('a[href]')||selector==='body *'?elements:[]}
 const info=vm.runInNewContext(inspectScript,{document,getComputedStyle:()=>{styleReads++;return {visibility:'visible',display:'block'}}})
 expect(info.totalControls).toBe(800);expect(info.eligibleControls).toBe(800);expect(info.controls).toHaveLength(32)
 expect(rectReads).toBe(800);expect(styleReads).toBe(800)
 expect(info.visual.split('|')).toHaveLength(500)
})

test('discovery reuses an already observed state inspection while each action still opens a fresh browser',async()=>{
 const {explorePrototype}=await import('../../src/main/artifacts/explorePrototype')
 let opens=0,destroyed=0
 const info=(state:string)=>({title:state,signature:state,visual:state,visible:true,totalControls:state==='home'?1:0,skippedControls:0,eligibleControls:state==='home'?1:0,checkedControls:state==='home'?1:0,controls:state==='home'?[{selector:'#details',label:'Open details'}]:[]})
 const result=await explorePrototype('http://localhost/index.html',['/index.html'],async()=>{opens++;let state='home',closed=false;return {webContents:{getURL:()=> 'http://localhost/index.html',executeJavaScript:async(script:string)=>{if(script===inspectScript)return info(state);state='details';return true}},isDestroyed:()=>closed,destroy:()=>{closed=true;destroyed++}} as any})
 expect(result.states).toHaveLength(2);expect(result.transitions).toHaveLength(1)
 expect(opens).toBe(2);expect(destroyed).toBe(opens)
 expect(result.transitions[0]).toMatchObject({source:'/index.html',label:'Open details'})
})
