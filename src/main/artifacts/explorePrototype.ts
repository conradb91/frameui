import {abortable} from './importJob'
import type {ArtifactImportProgress} from '../../shared/types/artifactImport'
import type {BrowserWindow} from 'electron'
import {createHash} from 'node:crypto'
import type {ArtifactStep,ReplayStep,DiscoveryCoverage,CoverageEntry,DetectedArtifactTransition,ArtifactInteractionKind,ArtifactImportMode} from '../../shared/artifactDiscovery'
import {inspectScript} from './prototypePageScripts'
import {replayPrototype} from './prototypeReplay'
export {inspectScript,replayPrototype}
export interface ArtifactState {pattern:string;url:string;name:string;steps:ReplayStep[]}
export type ArtifactTransition=DetectedArtifactTransition
interface Control extends ArtifactStep {priority?:number;label:string;kind?:ArtifactInteractionKind;componentType?:ArtifactTransition['componentType'];href?:string;target?:string}
interface Inspection {route:string;totalControls:number;skippedControls:number;eligibleControls:number;checkedControls:number;visible:boolean;title:string;signature:string;visual:string;controls:Control[];blocked?:{selector:string;label:string;event:string;reason:string}[];expanded?:string[];overlay?:'modal'|'drawer'|'dropdown';overlaySelector?:string;reconstructed?:boolean;frameWarnings?:string[];popup?:string;externalAction?:string}
export interface DiscoveryCheckpoint {version:2;states:ArtifactState[];transitions:ArtifactTransition[];entries:CoverageEntry[];cursor:number;controlIndex:number;fingerprints:[string,string][];engineRevision?:number;inspectedStates?:string[]}
export interface DiscoveryOptions {mode?:ArtifactImportMode;maxStates?:number;maxAttempts?:number;maxDepth?:number;maxMilliseconds?:number;checkpoint?:DiscoveryCheckpoint;onCheckpoint?:(checkpoint:DiscoveryCheckpoint)=>Promise<void>}
export function prototypeRouteIdentity(address:string){const url=new URL(address);url.searchParams.sort();return url.pathname+url.search+(/^#!?\//.test(url.hash)?url.hash:'')}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
const keyOf=(entry:Pick<CoverageEntry,'state'|'selector'|'event'|'value'>)=>JSON.stringify([entry.state,entry.selector,entry.event,entry.value??''])
/** A resumable graph traversal. Limits bound work, never turn pending controls into successes. */
export async function explorePrototype(url:string,paths:string[],open:(url:string)=>Promise<BrowserWindow>,signal?:AbortSignal,progress?:(value:Omit<ArtifactImportProgress,'id'|'stage'>)=>void,options:DiscoveryOptions={}){
 const limits={states:options.maxStates??(options.checkpoint?.states.length??0)+Math.max(1,paths.length)*160,attempts:options.maxAttempts??Math.max(1,paths.length)*800,depth:options.maxDepth??Math.min(128,32+(options.checkpoint?Math.max(0,...options.checkpoint.states.map(s=>s.steps.length)):0)),milliseconds:options.maxMilliseconds??Math.max(1,paths.length)*120000}
 const checkpoint=options.checkpoint,states:ArtifactState[]=structuredClone(checkpoint?.states??paths.map(path=>({pattern:path,url:new URL(path,url).href,name:decodeURIComponent(path.split('/').pop()||'Prototype').replace(/\.html?$/i,''),steps:[]})))
 // Loopback ports change when reopening the app; replay paths against the current server.
 for(const state of states){const previous=new URL(state.url);state.url=new URL(previous.pathname+previous.search+previous.hash,url).href}
 const transitions:ArtifactTransition[]=structuredClone(checkpoint?.transitions??[]),entries:CoverageEntry[]=structuredClone(checkpoint?.entries??[]),warnings:string[]=[],deduplication:{source:string;control:string;route:string;fingerprint:string;decision:string;destination?:string}[]=[]
 const ledger=new Map(entries.map(e=>[keyOf(e),e])),fingerprints=new Map(checkpoint?.fingerprints??[]),origin=new URL(url).origin
 const ready=new Map<string,{info:Inspection;controls:Control[]}>(),inspectedStates=new Set<string>(),unrendered=new Set<string>(),depthBlocked=new Set<string>()
 let cursor=0,attempts=0,halted=false;const started=Date.now()
 for(const entry of entries)if(entry.status==='failed')entry.status='pending'
 if(checkpoint?.engineRevision===3)for(const pattern of checkpoint.inspectedStates??[]){if(!entries.some(e=>e.state===pattern&&e.status==='pending'))inspectedStates.add(pattern)}
 async function persist(){await options.onCheckpoint?.({version:2,states,transitions,entries,cursor,controlIndex:0,fingerprints:[...fingerprints],engineRevision:3,inspectedStates:[...inspectedStates]})}
 function record(entry:CoverageEntry){const key=keyOf(entry),old=ledger.get(key);if(old)Object.assign(old,entry);else{entries.push(entry);ledger.set(key,entry)}return entry}
 async function owned(address:string){return abortable(open(address).then(win=>{if(signal?.aborted){if(!win.isDestroyed())win.destroy();signal.throwIfAborted()}return win}),signal)}
 async function inspect(state:ArtifactState){const win=await owned(state.url);try{await replayPrototype(win.webContents,state.steps,signal);return {...await abortable(win.webContents.executeJavaScript(inspectScript),signal),route:prototypeRouteIdentity(win.webContents.getURL())} as Inspection}finally{if(!win.isDestroyed())win.destroy()}}
 const fingerprint=(info:Inspection)=>digest(options.mode==='simple'?info.route:info.route+'|'+info.signature+'|'+info.visual)
 function register(state:ArtifactState,info:Inspection){
  inspectedStates.add(state.pattern)
  if(!info.visible){unrendered.add(state.pattern);record({state:state.pattern,selector:'',label:state.name,event:'load',status:'failed',reason:'The screen did not render visible content.'});warnings.push(`${state.name} did not render visible content.`);return}
  for(const event of ['load','inspect']){const entry=ledger.get(keyOf({state:state.pattern,selector:'',event}));if(entry)entry.status='unchanged'}
  if(!state.steps.length)state.name=info.title.slice(0,180)
  fingerprints.set(fingerprint(info),state.pattern)
  for(const item of options.mode==='simple'?[]:info.blocked??[])record({state:state.pattern,...item,status:'blocked'})
  warnings.push(...info.frameWarnings??[])
  const controls=info.controls.filter(c=>options.mode!=='simple'||c.event==='click').map(c=>({...c,event:c.event??'click' as const})),active=new Set(controls.map(control=>keyOf({state:state.pattern,...control})))
  for(const entry of entries)if(entry.state===state.pattern&&entry.status==='pending'&&!['load','inspect'].includes(entry.event)&&!active.has(keyOf(entry))){entry.status='unchanged';entry.reason='This control is no longer exposed in this captured view.'}
  for(const control of controls)if(!ledger.has(keyOf({state:state.pattern,...control})))record({state:state.pattern,selector:control.selector,label:control.label,event:control.event,value:control.value,status:'pending'})
  ready.set(state.pattern,{info,controls})
 }
 // Work across the frontier by action priority. New dialogs and their controls must
 // not wait behind every filter combination, text value and decorative hover.
 while(true){
  signal?.throwIfAborted()
  if(Date.now()-started>=limits.milliseconds){halted=true;break}
  const root=states.find(state=>!state.steps.length&&!inspectedStates.has(state.pattern))
  if(root){cursor=states.indexOf(root);progress?.({completed:attempts,screens:states.length,connections:transitions.length,detail:`Discovering ${root.name}`});try{register(root,await inspect(root))}catch(error){signal?.throwIfAborted();inspectedStates.add(root.pattern);record({state:root.pattern,selector:'',label:root.name,event:'load',status:'failed',reason:error instanceof Error?error.message:String(error)});warnings.push(`Could not replay ${root.name}.`)}await persist();continue}
  let selected:{state:ArtifactState;info:Inspection;control:Control;score:number}|undefined
  for(const state of states){
   const item=ready.get(state.pattern);if(!item||depthBlocked.has(state.pattern))continue
   const control=item.controls.find(c=>ledger.get(keyOf({state:state.pattern,...c}))?.status==='pending');if(!control)continue
   if(state.steps.length>=limits.depth){depthBlocked.add(state.pattern);continue}
   const score=(control.priority??10)+state.steps.length*16
   if(!selected||score<selected.score)selected={state,info:item.info,control,score}
  }
  if(!selected){
   const state=states.find(state=>!inspectedStates.has(state.pattern))
   if(!state){if(depthBlocked.size)halted=true;break}
   cursor=states.indexOf(state)
   progress?.({completed:attempts,screens:states.length,connections:transitions.length,detail:`Discovering ${state.name} · ${entries.filter(e=>e.status==='pending').length} actions pending`})
   try{register(state,await inspect(state))}catch(error){signal?.throwIfAborted();inspectedStates.add(state.pattern);record({state:state.pattern,selector:'',label:state.name,event:'load',status:'failed',reason:error instanceof Error?error.message:String(error)});warnings.push(`Could not replay ${state.name}.`)}
   await persist();continue
  }
  if(attempts>=limits.attempts){halted=true;break}
  const {state,info,control}=selected;cursor=states.indexOf(state)
  const base={state:state.pattern,selector:control.selector,label:control.label,event:control.event,value:control.value}
  if(control.href&&!/^javascript:/i.test(control.href)){
   let target:URL
   try{target=new URL(control.href)}catch{record({...base,status:'blocked',reason:'This link has no resolvable page address in the imported source.'});continue}
   if(target.origin!==origin||!/^https?:$/.test(target.protocol)){record({...base,status:'blocked',reason:'External navigation requires a separate imported source.'});continue}
  }
  progress?.({completed:attempts,screens:states.length,connections:transitions.length,detail:`${control.event==='hover'?'Hovering over':'Checking'} ${control.label} on ${state.name}`});attempts++
  const step:ArtifactStep={selector:control.target??control.selector,event:control.event,...(control.value!==undefined?{value:control.value}:{}),...(control.key?{key:control.key}:{}),...(control.x!==undefined?{x:control.x,y:control.y}:{})}
  let win:BrowserWindow|undefined
  try{
   win=await owned(state.url);await replayPrototype(win.webContents,[...state.steps,step],signal)
   if(new URL(win.webContents.getURL()).origin!==origin){record({...base,status:'blocked',reason:'Navigation left the imported source.'});continue}
   const next={...await abortable(win.webContents.executeJavaScript(inspectScript),signal),route:prototypeRouteIdentity(win.webContents.getURL())} as Inspection,key=fingerprint(next)
   if(next.externalAction){record({...base,status:'blocked',reason:next.externalAction+' requires manual review.'});continue}
   if(next.popup&&new URL(next.popup).origin!==origin){record({...base,status:'blocked',reason:'An external window was requested: '+new URL(next.popup).origin});continue}
   if(options.mode==='simple'&&next.route===info.route||key===fingerprint(info)||['hover','scroll'].includes(control.event)&&next.signature===info.signature){record({...base,status:'unchanged',reason:control.event==='hover'?'No new content or view appeared.':undefined});deduplication.push({source:state.pattern,control:control.label,route:next.route,fingerprint:key,decision:'unchanged'});continue}
   let destination=fingerprints.get(key)
   if(!destination){
    if(states.length>=limits.states){halted=true;break}
    destination=options.mode==='simple'?next.route:'/__prototype_state_'+states.length
    const actionName=control.event==='select'?`${control.label} · ${control.value}`:control.event==='input'?`${control.label} · ${control.value||'Cleared'}`:control.label
    const created={pattern:destination,url:options.mode==='simple'?win.webContents.getURL():state.url,name:(next.title!==info.title?next.title:actionName).slice(0,180),steps:options.mode==='simple'?[]:[...state.steps,step]};states.push(created);register(created,next)
   }
   const trigger=control.event==='hover'?'hover':control.event==='select'&&control.target?'click':control.event==='input'||control.event==='select'?'change':control.event==='key'?'key':control.event==='scroll'?'swipe':'click'
   const opening=next.overlay&&(next.overlay!==info.overlay||next.overlaySelector!==info.overlaySelector||next.title!==info.title),closing=info.overlay&&!next.overlay
   const action:NonNullable<ArtifactTransition['action']>=opening?(next.overlay==='drawer'?'open-drawer':next.overlay==='modal'?'open-modal':'open-overlay'):closing?(info.overlay==='drawer'?'close-drawer':info.overlay==='modal'?'close-modal':'close-overlay'):next.route!==info.route?'navigate':'state'
   transitions.push({source:state.pattern,destination,selector:control.selector,label:control.label,componentType:control.componentType,kind:opening?next.overlay==='dropdown'?'dropdown':next.overlay:closing?info.overlay:next.route!==info.route?'navigation':JSON.stringify(next.expanded)!==JSON.stringify(info.expanded)?'disclosure':control.kind,trigger,action,value:control.value,key:control.key,reconstructed:next.reconstructed})
   record({...base,status:'captured',destination});deduplication.push({source:state.pattern,control:control.label,route:next.route,fingerprint:key,decision:'transition',destination})
  }catch(error){signal?.throwIfAborted();record({...base,status:'failed',reason:error instanceof Error?error.message:String(error)})}finally{if(win&&!win.isDestroyed())win.destroy();await persist()}
 }
 for(const state of states)if(!inspectedStates.has(state.pattern))record({state:state.pattern,selector:'',label:state.name,event:'inspect',status:'pending'})
 const counts=(status:CoverageEntry['status'])=>entries.filter(e=>e.status===status).length
 const coverage:DiscoveryCoverage={version:2,mode:options.mode??'detailed',complete:!halted&&!counts('failed')&&!counts('blocked')&&!counts('pending'),attempted:counts('captured')+counts('unchanged')+counts('failed'),captured:counts('captured'),unchanged:counts('unchanged'),blocked:counts('blocked'),failed:counts('failed'),pending:counts('pending'),entries,limits}
 if(halted)warnings.push(`Discovery paused with ${coverage.pending} pending actions. Continue discovery to explore the remaining views.`)
 if(coverage.failed)warnings.push(`${coverage.failed} actions could not be replayed. Review the interaction coverage.`)
 if(coverage.blocked)warnings.push(`${coverage.blocked} controls need manual review; they are listed in interaction coverage.`)
 await persist();signal?.throwIfAborted()
 return {states:states.filter(s=>!unrendered.has(s.pattern)),transitions,deduplication,warnings:[...new Set(warnings)],coverage}
}
