import {test,expect} from 'bun:test'
import {abortable,beginImport,cancelImport,finishImport,importSignal} from '../../src/main/artifacts/importJob'
import {explorePrototype} from '../../src/main/artifacts/explorePrototype'

test('stopping a job rejects pending discovery even while a browser never finishes loading',async()=>{
 const signal=beginImport(12,'first'),updates:string[]=[]
 const pending=explorePrototype('http://127.0.0.1:1234/',['/index.html'],()=>new Promise(()=>{}),signal,p=>updates.push(p.detail))
 cancelImport(12,'first')
 await expect(pending).rejects.toThrow('Import stopped')
 expect(updates).toEqual(['Reading index'])
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
