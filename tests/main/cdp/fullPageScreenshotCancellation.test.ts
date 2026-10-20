import {test,expect} from 'bun:test'
import type {BrowserWindow} from 'electron'
import {captureFullPageScreenshot} from '../../../src/main/ipc/handlers/capture/fullPageScreenshot'
for(const stage of ['Page.enable','Page.getLayoutMetrics','devicePixelRatio','Page.captureScreenshot'])test(`stalled screenshot ${stage} cancels and releases debugger for retry`,async()=>{
 let attached=false,stall=true
 const win={webContents:{debugger:{isAttached:()=>attached,attach:()=>{attached=true},detach:()=>{attached=false},sendCommand:(method:string)=>stall&&method===stage?new Promise(()=>{}):Promise.resolve(method==='Page.getLayoutMetrics'?{cssContentSize:{x:0,y:0,width:100,height:100}}:{data:'AAAA'})},executeJavaScript:()=>stall&&stage==='devicePixelRatio'?new Promise(()=>{}):Promise.resolve(1)}} as unknown as BrowserWindow
 const controller=new AbortController(),start=performance.now(),pending=captureFullPageScreenshot(win,controller.signal)
 setTimeout(()=>controller.abort(new Error('Stopped')),10)
 await expect(pending).rejects.toThrow('Stopped');expect(performance.now()-start).toBeLessThan(1000);expect(attached).toBe(false)
 stall=false
 expect(await captureFullPageScreenshot(win,new AbortController().signal)).toBe('data:image/png;base64,AAAA');expect(attached).toBe(false)
})
