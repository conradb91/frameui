import {test,expect} from 'bun:test'
import {abortable,beginImport,cancelImport,finishImport,importSignal} from '../../src/main/artifacts/importJob'
import {explorePrototype} from '../../src/main/artifacts/explorePrototype'

test('stopping a job rejects pending discovery even while a browser never finishes loading',async()=>{
 const signal=beginImport(12,'first'),updates:string[]=[]
 const pending=explorePrototype('http://127.0.0.1:1234/',['/index.html'],()=>new Promise(()=>{}),signal,p=>updates.push(p.detail))
 cancelImport(12,'first')
 await expect(pending).rejects.toThrow('Import stopped')
 expect(updates[0]).toContain('Discovering index')
 finishImport(12,'first')
})
test('late cancellation or cleanup from an old job cannot stop a replacement import',()=>{
 const first=beginImport(24,'first'),second=beginImport(24,'second')
 expect(first.aborted).toBe(true)
 expect(cancelImport(24,'first')).toBe(false)
 finishImport(24,'first')
 expect(importSignal(24,'second')).toBe(second)
 expect(second.aborted).toBe(false)
 cancelImport(24,'second');expect(second.aborted).toBe(true);finishImport(24,'second')
})
test('abortable operations settle immediately instead of waiting for browser work',async()=>{
 const controller=new AbortController(),pending=abortable(new Promise(()=>{}),controller.signal)
 controller.abort(new Error('Stopped'))
 await expect(pending).rejects.toThrow('Stopped')
})

test('a blank or failed screen cannot claim complete discovery, and a successful retry clears its pending load',async()=>{
 let checkpoint:any
 const base={totalControls:0,skippedControls:0,eligibleControls:0,checkedControls:0,title:'Recovery',signature:'recovered',visual:'recovered',controls:[],blocked:[]}
 const open=(visible:boolean)=>async(url:string)=>{let closed=false;return {webContents:{getURL:()=>url,executeJavaScript:async()=>({...base,visible})},isDestroyed:()=>closed,destroy:()=>{closed=true}} as any}
 const failed=await explorePrototype('http://localhost:1234/',['/'],open(false),undefined,undefined,{onCheckpoint:async value=>{checkpoint=structuredClone(value)}})
 expect(failed.coverage.complete).toBe(false);expect(failed.coverage.failed).toBe(1);expect(failed.states).toHaveLength(0)
 const retried=await explorePrototype('http://localhost:1234/',['/'],open(true),undefined,undefined,{checkpoint})
 expect(retried.coverage.complete).toBe(true);expect(retried.coverage.failed).toBe(0);expect(retried.coverage.pending).toBe(0);expect(retried.states).toHaveLength(1)
})

test('a failed action-window load is recorded without aborting the complete import',async()=>{
 let opens=0
 const info={visible:true,title:'Retry',signature:'one',visual:'one',controls:[{selector:'button',label:'View details',event:'click'}]}
 const result=await explorePrototype('http://localhost:1234/',['/'],async url=>{if(++opens===2)throw new Error('Temporary load failure');return {webContents:{getURL:()=>url,executeJavaScript:async()=>info},isDestroyed:()=>false,destroy:()=>{}} as any})
 expect(result.coverage.failed).toBe(1);expect(result.coverage.complete).toBe(false);expect(result.states).toHaveLength(1)
})
