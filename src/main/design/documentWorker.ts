import {applyDesignPatch,type DesignPatch} from '@shared/designPatch'
import {parentPort} from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import {readJsonFile,writeJsonFileAtomic} from '@core/workspace/atomicJson'
import {visualDocumentSchema} from '@core/visual/schema'
import {packDocument,unpackDocument} from '@shared/documentResources'
import type {VisualDocument} from '@shared/types/visualDesign'
const summaries=new Map<string,{signature:string;summary:ReturnType<typeof summary>}>()
function summary(d:VisualDocument){return {id:d.id,name:d.name,projectId:d.projectId,libraryId:d.libraryId,updatedAt:d.updatedAt,pageCount:d.pages.length,thumbnail:d.pages[0]?.thumbnail}}
parentPort!.on('message',({id,method,file,value})=>{
 try{
  let result:unknown
  if(method==='save'||method==='patch'){
   let input=unpackDocument(value)
   if(method==='patch'){const base=readJsonFile<VisualDocument|null>(file,null);if(!base)throw new Error('Design not found. Reopen it before saving.');input=applyDesignPatch(base,input as DesignPatch)}
   const doc=visualDocumentSchema.parse(input);if(path.basename(file)!==doc.id+'.json')throw new Error('Document ID mismatch');writeJsonFileAtomic(file,doc);summaries.delete(file);result={ok:true}
  }else if(method==='load')result=packDocument(readJsonFile<VisualDocument|null>(file,null))
  else{
   const dir=path.dirname(file),rows=[]
   for(const name of fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')):[]){
    const full=path.join(dir,name),stat=fs.statSync(full),signature=stat.mtimeMs+':'+stat.size
    let cached=summaries.get(full)
    if(cached?.signature!==signature){const doc=readJsonFile<VisualDocument|null>(full,null);if(!doc)continue;cached={signature,summary:summary(doc)};summaries.set(full,cached)}
    rows.push(cached!.summary)
   }
   const counts=new Map<string,number>();for(const d of rows)if(d.libraryId)counts.set(d.libraryId,(counts.get(d.libraryId)??0)+1)
   result=rows.map(d=>({...d,designCount:d.libraryId?undefined:counts.get(d.id)??0}))
  }
  parentPort!.postMessage({id,result})
 }catch(error){parentPort!.postMessage({id,error:error instanceof Error?error.message:String(error)})}
})
