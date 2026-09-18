import {test,expect} from 'bun:test'
import {createRequire} from 'node:module'
const {signalProcess}=createRequire(import.meta.url)('../../../hosting/stacker/lib/process-signals.cjs')
test('Windows termination waits for taskkill and targets the whole tree without a shell',async()=>{
  let finish: (error:Error|null)=>void = ()=>{}
  let completed=false
  const operation=signalProcess(123,null,'SIGTERM',null,{platform:'win32',execute:(file:string,args:string[],options:object,callback:typeof finish)=>{expect(file).toBe('taskkill.exe');expect(args).toEqual(['/pid','123','/T','/F']);expect(options).toEqual({windowsHide:true,timeout:10000});finish=callback}}).then((value:boolean)=>{completed=true;return value})
  await Promise.resolve();expect(completed).toBe(false)
  finish(null);expect(await operation).toBe(true)
})
test('failed or invalid termination does not report success',async()=>{
  expect(await signalProcess(-1,null,'SIGTERM')).toBe(false)
  expect(await signalProcess(123,null,'SIGTERM',null,{platform:'win32',execute:(_file:unknown,_args:unknown,_options:unknown,callback:(error:Error)=>void)=>callback(new Error('denied'))})).toBe(false)
})
