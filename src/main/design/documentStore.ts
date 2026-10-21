import {Worker} from 'node:worker_threads'
import path from 'node:path'
let worker:Worker|undefined,nextId=0
const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>()
export function documentRequest(method:'load'|'list'|'save'|'patch'|'removeProject',file:string,value?:unknown):Promise<unknown>{
 if(!worker){
  const created=new Worker(path.join(__dirname,'documentWorker.cjs'));worker=created
  const fail=(error:Error)=>{if(worker!==created)return;for(const task of pending.values())task.reject(error);pending.clear();worker=undefined}
  worker.on('error',fail)
  worker.on('exit',code=>{if(code!==0)fail(new Error('Document storage stopped. Retry saving.'))})
  worker.on('message',({id,result,error})=>{const task=pending.get(id);if(!task)return;pending.delete(id);if(error)task.reject(new Error(error));else task.resolve(result);if(!pending.size)worker?.unref()})
 }
 const active=worker;active.ref()
 return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});try{active.postMessage({id,method,file,value})}catch(error){pending.delete(id);if(!pending.size)active.unref();reject(error)}})
}
