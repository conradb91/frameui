import {buildXdDocument,validateXdArchive} from '../../../src/core/export/xdDocument'
import {createStoredZip} from '../../../src/main/export/storedZip'
import {recordedFlow} from './flow'
import {packDocument} from '../../../src/shared/documentResources'
self.onmessage=({data})=>{
 try{
  const session=data.session,pages=structuredClone(session.pages)
  if(!pages.length)throw Error('Capture a screen first.')
  pages[0].captureWarnings=[...new Set([...(pages[0].captureWarnings??[]),...(session.notes??[])])]
  const prototype=recordedFlow(pages,session)
  const document={version:1 as const,id:session.id,name:session.name,updatedAt:new Date().toISOString(),pages,prototype,components:[],variables:[]}
  if(data.format==='frameui'){self.postMessage({type:'capture',document:packDocument(document)});return}
  self.postMessage({type:'progress',stage:'Building editable XD layers and flows'})
  const {entries,report}=buildXdDocument({jobId:crypto.randomUUID(),document,scope:'all',includePrototype:true},stage=>self.postMessage({type:'progress',stage}),[],session.renderedFonts??[],session.renderedImages??[],session.renderedLines??{})
  const bytes=createStoredZip(entries);validateXdArchive(bytes)
  self.postMessage({type:'complete',bytes:new Uint8Array(bytes),report})
 }catch(error){self.postMessage({type:'error',error:error instanceof Error?error.message:String(error)})}
}
