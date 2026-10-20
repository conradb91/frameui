import {test,expect} from 'bun:test'
import type {WebContents} from 'electron'
import {captureDomSnapshot} from '../../../src/main/ipc/handlers/cdp/domSnapshot'
for(const stage of ['DOM.enable','CSS.enable','DOMSnapshot.enable','DOMSnapshot.captureSnapshot',1,2,3,4,5,6,7])test(`capture cancellation releases a stalled ${stage} and accepts another capture`,async()=>{
 let attached=false,script=0,stall=true
 const contents={debugger:{isAttached:()=>attached,attach:()=>{attached=true},detach:()=>{attached=false},sendCommand:(method:string)=>stall&&method===stage?new Promise(()=>{}):Promise.resolve(method==='DOMSnapshot.captureSnapshot'?{documents:[],strings:[]}:{})},executeJavaScript:()=>{script++;if(stall&&script===stage)return new Promise(()=>{});return Promise.resolve(script===1?{width:100,height:100}:script===2||script===5||script===6?[]:{})}} as unknown as WebContents
 const controller=new AbortController(),started=performance.now(),pending=captureDomSnapshot(contents,{width:100,height:100},controller.signal)
 const timer=setTimeout(()=>controller.abort(new Error('Stopped')),10)
 await expect(pending).rejects.toThrow('Stopped');clearTimeout(timer)
 expect(performance.now()-started).toBeLessThan(1000);expect(attached).toBe(false)
 stall=false;script=0
 expect((await captureDomSnapshot(contents,{width:100,height:100})).children).toEqual([])
 expect(script).toBe(7);expect(attached).toBe(false)
})
