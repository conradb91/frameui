/** One cancellable import per renderer, spanning extraction, discovery and capture. */
const jobs=new Map<number,{id:string;controller:AbortController}>()
export function beginImport(owner:number,id:string){
  jobs.get(owner)?.controller.abort(new Error('Import stopped'))
  const job={id,controller:new AbortController()};jobs.set(owner,job);return job.controller.signal
}
export function importSignal(owner:number,id:string){
  const job=jobs.get(owner)
  if(!job||job.id!==id)throw new Error('This import is no longer active.')
  job.controller.signal.throwIfAborted()
  return job.controller.signal
}
export function cancelImport(owner:number,id:string){
  const job=jobs.get(owner);if(!job||job.id!==id)return false
  job.controller.abort(new Error('Import stopped'));return true
}
export function finishImport(owner:number,id:string){if(jobs.get(owner)?.id===id)jobs.delete(owner)}
export function abortable<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return work
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason??new Error('Import stopped'))
    if(signal.aborted){work.catch(()=>{});abort();return}
    signal.addEventListener('abort',abort,{once:true})
    work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
  })
}

export function disposeImport(owner:number){jobs.get(owner)?.controller.abort(new Error('Import window closed'));jobs.delete(owner)}
