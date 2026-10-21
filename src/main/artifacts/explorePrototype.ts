import {abortable} from './importJob'
import type {ArtifactImportProgress} from '../../shared/types/artifactImport'
import type {BrowserWindow} from 'electron'
import {createHash} from 'node:crypto'
import type {ArtifactStep,ReplayStep,DiscoveryCoverage,CoverageEntry,DetectedArtifactTransition,ArtifactInteractionKind} from '../../shared/artifactDiscovery'
import {inspectScript} from './prototypePageScripts'
import {replayPrototype} from './prototypeReplay'
export {inspectScript,replayPrototype}
export interface ArtifactState {pattern:string;url:string;name:string;steps:ReplayStep[]}
export type ArtifactTransition=DetectedArtifactTransition
interface Control extends ArtifactStep {label:string;kind?:ArtifactInteractionKind;href?:string;target?:string}
interface Inspection {route:string;totalControls:number;skippedControls:number;eligibleControls:number;checkedControls:number;visible:boolean;title:string;signature:string;visual:string;controls:Control[];blocked?:{selector:string;label:string;event:string;reason:string}[];expanded?:string[];overlay?:'modal'|'drawer'|'dropdown';overlaySelector?:string;reconstructed?:boolean;frameWarnings?:string[];popup?:string}
export interface DiscoveryCheckpoint {version:2;states:ArtifactState[];transitions:ArtifactTransition[];entries:CoverageEntry[];cursor:number;controlIndex:number;fingerprints:[string,string][]}
export interface DiscoveryOptions {maxStates?:number;maxAttempts?:number;maxDepth?:number;maxMilliseconds?:number;checkpoint?:DiscoveryCheckpoint;onCheckpoint?:(checkpoint:DiscoveryCheckpoint)=>Promise<void>}
export function prototypeRouteIdentity(address:string){const url=new URL(address);url.searchParams.sort();return url.pathname+url.search+(/^#!?\//.test(url.hash)?url.hash:'')}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
const keyOf=(entry:Pick<CoverageEntry,'state'|'selector'|'event'|'value'>)=>JSON.stringify([entry.state,entry.selector,entry.event,entry.value??''])
/** A resumable graph traversal. Limits bound work, never turn pending controls into successes. */
export async function explorePrototype(url:string,paths:string[],open:(url:string)=>Promise<BrowserWindow>,signal?:AbortSignal,progress?:(value:Omit<ArtifactImportProgress,'id'|'stage'>)=>void,options:DiscoveryOptions={}){
 const limits={states:options.maxStates??(options.checkpoint?.states.length??0)+160,attempts:options.maxAttempts??800,depth:options.maxDepth??Math.min(128,32+(options.checkpoint?Math.max(0,...options.checkpoint.states.map(s=>s.steps.length)):0)),milliseconds:options.maxMilliseconds??120000}
 const checkpoint=options.checkpoint,states:ArtifactState[]=structuredClone(checkpoint?.states??paths.map(path=>({pattern:path,url:new URL(path,url).href,name:decodeURIComponent(path.split('/').pop()||'Prototype').replace(/\.html?$/i,''),steps:[]})))
 // Loopback ports change when reopening the app; replay paths against the current server.
 for(const state of states){const previous=new URL(state.url);state.url=new URL(previous.pathname+previous.search+previous.hash,url).href}
 const transitions:ArtifactTransition[]=structuredClone(checkpoint?.transitions??[]),entries:CoverageEntry[]=structuredClone(checkpoint?.entries??[]),warnings:string[]=[],deduplication:{source:string;control:string;route:string;fingerprint:string;decision:string;destination?:string}[]=[]
 const ledger=new Map(entries.map(e=>[keyOf(e),e])),fingerprints=new Map(checkpoint?.fingerprints??[]),inspected=new Map<string,Inspection>(),origin=new URL(url).origin
 let cursor=checkpoint?.cursor??0,controlIndex=checkpoint?.controlIndex??0,attempts=0,halted=false;const started=Date.now(),unrendered=new Set<string>()
 if(checkpoint&&entries.some(e=>e.status==='failed')){for(const entry of entries)if(entry.status==='failed')entry.status='pending';cursor=0;controlIndex=0}
 async function persist(){await options.onCheckpoint?.({version:2,states,transitions,entries,cursor,controlIndex,fingerprints:[...fingerprints]})}
 function record(entry:CoverageEntry){const key=keyOf(entry),old=ledger.get(key);if(old)Object.assign(old,entry);else{entries.push(entry);ledger.set(key,entry)}return entry}
 async function owned(address:string){return abortable(open(address).then(win=>{if(signal?.aborted){if(!win.isDestroyed())win.destroy();signal.throwIfAborted()}return win}),signal)}
 async function inspect(state:ArtifactState){const win=await owned(state.url);try{await replayPrototype(win.webContents,state.steps,signal);return {...await abortable(win.webContents.executeJavaScript(inspectScript),signal),route:prototypeRouteIdentity(win.webContents.getURL())} as Inspection}finally{if(!win.isDestroyed())win.destroy()}}
 const fingerprint=(info:Inspection)=>digest(info.route+'|'+info.signature+'|'+info.visual)
 for(;cursor<states.length;cursor++,controlIndex=0){
  signal?.throwIfAborted();const state=states[cursor]
  if(Date.now()-started>=limits.milliseconds){halted=true;break}
  progress?.({completed:attempts,screens:states.length,connections:transitions.length,detail:`Discovering ${state.name} · ${entries.filter(e=>e.status==='pending').length} actions pending`})
  let info:Inspection
  try{info=inspected.get(state.pattern)??await inspect(state);inspected.delete(state.pattern)}catch(error){signal?.throwIfAborted();record({state:state.pattern,selector:'',label:state.name,event:'load',status:'failed',reason:error instanceof Error?error.message:String(error)});warnings.push(`Could not replay ${state.name}.`);continue}
  if(!info.visible){unrendered.add(state.pattern);record({state:state.pattern,selector:'',label:state.name,event:'load',status:'failed',reason:'The screen did not render visible content.'});warnings.push(`${state.name} did not render visible content.`);continue}
  const loadEntry=ledger.get(keyOf({state:state.pattern,selector:'',event:'load'}));if(loadEntry)loadEntry.status='unchanged'
  const inspectionEntry=ledger.get(keyOf({state:state.pattern,selector:'',event:'inspect'}));if(inspectionEntry)inspectionEntry.status='unchanged'
  if(!state.steps.length)state.name=info.title.slice(0,180)
  fingerprints.set(fingerprint(info),state.pattern)
  for(const item of info.blocked??[])record({state:state.pattern,...item,status:'blocked'})
  for(const warning of info.frameWarnings??[])warnings.push(warning)
  const controls=info.controls.map(c=>({...c,event:c.event??'click' as const}))
  for(const control of controls)if(!ledger.has(keyOf({state:state.pattern,...control})))record({state:state.pattern,selector:control.selector,label:control.label,event:control.event,value:control.value,status:'pending'})
  for(;controlIndex<controls.length;controlIndex++){
   signal?.throwIfAborted();const control=controls[controlIndex],base={state:state.pattern,selector:control.selector,label:control.label,event:control.event,value:control.value},known=ledger.get(keyOf(base))
   if(known&&known.status!=='pending')continue
   if(attempts>=limits.attempts||Date.now()-started>=limits.milliseconds||state.steps.length>=limits.depth){halted=true;break}
   if(control.href&&!/^javascript:/i.test(control.href)){const target=new URL(control.href);if(target.origin!==origin||!/^https?:$/.test(target.protocol)){record({...base,status:'blocked',reason:'External navigation requires a separate imported source.'});continue}}
   progress?.({completed:attempts,screens:states.length,connections:transitions.length,detail:`${control.event==='hover'?'Hovering over':'Checking'} ${control.label} on ${state.name}`});attempts++
   const step:ArtifactStep={selector:control.target??control.selector,event:control.event,...(control.value!==undefined?{value:control.value}:{}),...(control.key?{key:control.key}:{}),...(control.x!==undefined?{x:control.x,y:control.y}:{})}
   let win:BrowserWindow|undefined
   try{
    win=await owned(state.url)
    await replayPrototype(win.webContents,[...state.steps,step],signal)
    if(new URL(win.webContents.getURL()).origin!==origin){record({...base,status:'blocked',reason:'Navigation left the imported source.'});continue}
    const next={...await abortable(win.webContents.executeJavaScript(inspectScript),signal),route:prototypeRouteIdentity(win.webContents.getURL())} as Inspection,key=fingerprint(next)
    if(next.popup&&new URL(next.popup).origin!==origin){record({...base,status:'blocked',reason:'An external window was requested: '+new URL(next.popup).origin});continue}
    if(key===fingerprint(info)||['hover','scroll'].includes(control.event)&&next.signature===info.signature){record({...base,status:'unchanged',reason:control.event==='hover'?'No new content or view appeared.':undefined});deduplication.push({source:state.pattern,control:control.label,route:next.route,fingerprint:key,decision:'unchanged'});continue}
    let destination=fingerprints.get(key)
    if(!destination){
     if(states.length>=limits.states){halted=true;break}
     destination='/__prototype_state_'+states.length;fingerprints.set(key,destination)
     const actionName=control.event==='select'?`${control.label} · ${control.value}`:control.event==='input'?`${control.label} · ${control.value||'Cleared'}`:control.label
     states.push({pattern:destination,url:state.url,name:(next.title!==info.title?next.title:actionName).slice(0,180),steps:[...state.steps,step]});inspected.set(destination,next)
    }
    const trigger=control.event==='hover'?'hover':control.event==='select'&&control.target?'click':control.event==='input'||control.event==='select'?'change':control.event==='key'?'key':control.event==='scroll'?'swipe':'click'
    const opening=next.overlay&&next.overlay!==info.overlay,closing=info.overlay&&!next.overlay
    const action:NonNullable<ArtifactTransition['action']>=opening?(next.overlay==='drawer'?'open-drawer':next.overlay==='modal'?'open-modal':'open-overlay'):closing?(info.overlay==='drawer'?'close-drawer':info.overlay==='modal'?'close-modal':'close-overlay'):next.route!==info.route?'navigate':'state'
    transitions.push({source:state.pattern,destination,selector:control.selector,label:control.label,kind:opening?next.overlay==='dropdown'?'dropdown':next.overlay:control.kind,trigger,action,value:control.value,key:control.key,reconstructed:next.reconstructed})
    record({...base,status:'captured',destination});deduplication.push({source:state.pattern,control:control.label,route:next.route,fingerprint:key,decision:'transition',destination})
   }catch(error){signal?.throwIfAborted();record({...base,status:'failed',reason:error instanceof Error?error.message:String(error)})}finally{if(win&&!win.isDestroyed())win.destroy();await persist()}
  }
  await persist();if(halted)break
 }
 // Record unvisited screens explicitly; continuing starts at the exact pending action.
 for(let index=cursor+1;index<states.length;index++)record({state:states[index].pattern,selector:'',label:states[index].name,event:'inspect',status:'pending'})
 if(!halted){for(const entry of entries)if(entry.event==='inspect'&&entry.status==='pending')entry.status='unchanged'}
 const counts=(status:CoverageEntry['status'])=>entries.filter(e=>e.status===status).length
 const coverage:DiscoveryCoverage={version:2,complete:!halted&&!counts('failed')&&!counts('blocked')&&!counts('pending'),attempted:counts('captured')+counts('unchanged')+counts('failed'),captured:counts('captured'),unchanged:counts('unchanged'),blocked:counts('blocked'),failed:counts('failed'),pending:counts('pending'),entries,limits}
 if(halted)warnings.push(`Discovery paused with ${coverage.pending} pending actions. Continue discovery to explore the remaining views.`)
 if(coverage.failed)warnings.push(`${coverage.failed} actions could not be replayed. Review the interaction coverage.`)
 if(coverage.blocked)warnings.push(`${coverage.blocked} controls need manual review; they are listed in interaction coverage.`)
 await persist();signal?.throwIfAborted()
 return {states:states.filter(s=>!unrendered.has(s.pattern)),transitions,deduplication,warnings:[...new Set(warnings)],coverage}
}
