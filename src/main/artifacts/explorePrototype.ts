import { abortable } from './importJob'
import type { ArtifactImportProgress } from '../../shared/types/artifactImport'
import type { BrowserWindow, WebContents } from 'electron'
import { createHash } from 'node:crypto'

export interface ArtifactState {pattern:string;url:string;name:string;steps:string[]}
export interface ArtifactTransition {source:string;destination:string;selector:string;label:string}
export function prototypeRouteIdentity(address:string) {
  const url=new URL(address)
  url.searchParams.sort()
  // Query parameters define application state; ordinary fragment anchors do not.
  return url.pathname+url.search+(/^#!?\//.test(url.hash)?url.hash:'')
}
export const inspectScript = `(() => {
  const selectorCache=new WeakMap(),styleCache=new WeakMap(),rectCache=new WeakMap(),siblingCache=new WeakMap();
  const positionOf=el=>{const parent=el.parentElement;if(!siblingCache.has(parent))siblingCache.set(parent,new Map(Array.from(parent.children).map((node,index)=>[node,index+1])));return siblingCache.get(parent).get(el)||0};
  const styleOf=el=>{if(!styleCache.has(el))styleCache.set(el,getComputedStyle(el));return styleCache.get(el)};
  const rectOf=el=>{if(!rectCache.has(el))rectCache.set(el,el.getBoundingClientRect());return rectCache.get(el)};
  function selector(el) { if(selectorCache.has(el))return selectorCache.get(el);const original=el,parts=[]; while(el.parentElement && el!==document.documentElement) {parts.unshift(el.tagName.toLowerCase()+':nth-child('+positionOf(el)+')');el=el.parentElement} const result='html>'+parts.join('>');selectorCache.set(original,result);return result }
  const modal=Array.from(document.querySelectorAll('dialog:modal,[aria-modal="true"]')).find(m=>m.getClientRects().length&&styleOf(m).visibility!=='hidden'&&styleOf(m).display!=='none');
  const visible=el=>{if(modal&&!modal.contains(el))return false;const r=rectOf(el),s=styleOf(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
  const candidates=Array.from(document.querySelectorAll('a[href],button,[role="button"],[role="tab"],summary')).filter(visible);
  const safe=el=>{const name=(el.getAttribute('aria-label')||el.textContent||el.getAttribute('title')||'').trim();if(el.disabled||el.getAttribute('aria-disabled')==='true'||el.form||el.closest('form')||['submit','reset'].includes(el.getAttribute('type')))return false;if(/delete|remove|purchase|pay|logout|log out|sign out|save|send|submit|confirm|create|upload|download|install/i.test(name))return false;return el.tagName==='A'||el.tagName==='SUMMARY'||el.getAttribute('role')==='tab'||el.hasAttribute('aria-controls')||el.hasAttribute('aria-expanded')||el.getAttribute('aria-haspopup')==='dialog'||el.hasAttribute('aria-pressed')||el.hasAttribute('data-go')||el.hasAttribute('data-tab')||el.hasAttribute('data-cat')||/^(open|view|show|close|back|next|previous|toggle|menu|filter|settings|cancel)\\b/i.test(name)};
  const visualElements=[];for(const el of document.querySelectorAll('body *')){if(visible(el))visualElements.push(el);if(visualElements.length===500)break}
  const eligible=candidates.filter(safe).sort((a,b)=>Number(b.tagName==='A')-Number(a.tagName==='A'));
  return {totalControls:candidates.length,skippedControls:candidates.length-eligible.length,eligibleControls:eligible.length,checkedControls:Math.min(eligible.length,32),visible:!!(document.body.innerText.trim()||document.querySelector('img,svg,canvas')),title:document.querySelector('[role="dialog"] h1,dialog[open] h1,main h1,h1')?.innerText?.replace(/\\s+/g,' ').trim()||document.title||'Prototype',
    signature:document.body.innerText.replace(/\\s+/g,' ').trim()+'|'+Array.from(document.querySelectorAll('dialog[open],[aria-expanded="true"],[aria-selected="true"],details[open]')).map(selector).join('|'),
    visual:visualElements.map(el=>{const r=rectOf(el),s=styleOf(el);return [selector(el),el.getAttribute('src'),el.getAttribute('viewBox'),el.getAttribute('class'),el.getAttribute('aria-selected'),el.getAttribute('aria-expanded'),Math.round(r.width),Math.round(r.height),s.display,s.visibility,s.backgroundColor,s.backgroundImage,s.color,s.opacity,s.transform,el.getAttribute('d')?.slice(0,256)].join(':')}).join('|'),
    controls:eligible.slice(0,32).map(el=>({selector:selector(el),label:(el.getAttribute('aria-label')||el.textContent||'Open state').trim().slice(0,100),href:el.tagName==='A'?el.href:undefined}))};
})()`
export async function replayPrototype(web:WebContents,steps:string[],signal?:AbortSignal) {
  for(const selector of steps){
    signal?.throwIfAborted()
    const clicked=await abortable(web.executeJavaScript(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();const hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.y+r.height/2)));if(!hit||!el.contains(hit))return false;el.click();return true})()`),signal)
    if(!clicked)throw new Error('A prototype control changed. Recapture this state from the live prototype.')
    await abortable(new Promise(resolve=>setTimeout(resolve,180)),signal)
  }
}
/** Bounded exploration of a user-selected, locally served prototype. Never submits forms. */
export async function explorePrototype(url:string,paths:string[],open:(url:string)=>Promise<BrowserWindow>,signal?:AbortSignal,progress?:(value:Omit<ArtifactImportProgress,'id'|'stage'>)=>void) {
  const states:ArtifactState[]=[],transitions:ArtifactTransition[]=[],warnings:string[]=[],deduplication:{source:string;control:string;route:string;fingerprint:string;decision:string;destination?:string}[]=[]
  const fingerprints=new Map<string,string>(),unrendered=new Set<string>()
  const origin=new URL(url).origin
  let attempts=0
  async function openOwned(address:string){
    const pending=open(address).then(win=>{if(signal?.aborted){if(!win.isDestroyed())win.destroy();signal.throwIfAborted()}return win})
    return abortable(pending,signal)
  }
  async function inspect(state:ArtifactState){
    const win=await openOwned(state.url)
    try{await replayPrototype(win.webContents,state.steps,signal);return {...await abortable(win.webContents.executeJavaScript(inspectScript),signal),route:prototypeRouteIdentity(win.webContents.getURL())} as {route:string;totalControls:number;skippedControls:number;eligibleControls:number;checkedControls:number;visible:boolean;title:string;signature:string;visual:string;controls:{selector:string;label:string;href?:string}[]}}
    finally{if(!win.isDestroyed())win.destroy()}
  }
  const inspected=new Map<string,Awaited<ReturnType<typeof inspect>>>()
  const fingerprint=(value:string)=>createHash('sha256').update(value).digest('hex')
  // Include unlinked HTML files as well as the entry point.
  for(const path of paths){
    const state:ArtifactState={pattern:path,url:new URL(path,url).href,name:decodeURIComponent(path.split('/').pop()||'Prototype').replace(/\.html?$/i,''),steps:[]}
    states.push(state)
  }
  if(states.length>40)warnings.push('All HTML pages will be captured; automatic interaction exploration is limited to the first 40 screens.')
  for(let cursor=0;cursor<states.length && cursor<40;cursor++){
    signal?.throwIfAborted()
    const state=states[cursor]
    progress?.({completed:cursor,screens:states.length,connections:transitions.length,detail:`Reading ${state.name}`})
    let info:Awaited<ReturnType<typeof inspect>>
    try{info=inspected.get(state.pattern)??await inspect(state);inspected.delete(state.pattern)}catch{signal?.throwIfAborted();warnings.push(`Could not explore ${state.name}. Open it in Capture to review.`);continue}
    if(info.skippedControls)warnings.push(`Partial discovery: ${state.name} has ${info.skippedControls} controls excluded from automatic interaction for safety. Open Capture to review these controls manually.`)
    if(info.eligibleControls>info.checkedControls)warnings.push(`Partial discovery: ${state.name} has ${info.eligibleControls-info.checkedControls} unexamined controls (32-control limit). Open Capture to continue manually.`)
    if(!info.visible){unrendered.add(state.pattern);warnings.push(`${state.name} did not render visible content. Export runnable HTML rather than a source-only project.`);continue}
    if(!state.steps.length)state.name=info.title.slice(0,180)
    fingerprints.set(fingerprint(info.route+'|'+info.signature+'|'+info.visual),state.pattern)
    for(const control of info.controls){
      signal?.throwIfAborted()
      if(attempts>=60||states.length>=40||state.steps.length>=4){warnings.push('Partial discovery: automatic exploration reached its 40-screen, 60-attempt or four-step limit. Open the prototype in Capture to add remaining screens or states.');break}
      if(control.href){
        const target=new URL(control.href)
        if(target.origin!==origin||!/^https?:$/.test(target.protocol))continue
        // Ordinary anchors scroll within a screen; hash routers change screens.
        if(target.pathname===new URL(state.url).pathname&&target.search===new URL(state.url).search&&target.hash&&!/^#!?\//.test(target.hash))continue
        const existing=states.find(s=>s.url===target.href&&!s.steps.length)
        if(existing){transitions.push({source:state.pattern,destination:existing.pattern,selector:control.selector,label:control.label});continue}
      }
      progress?.({completed:attempts,screens:states.length,connections:transitions.length,detail:`Checking ${control.label || 'interaction'} on ${state.name}`})
      attempts++
      const win=await openOwned(state.url)
      try{
        await replayPrototype(win.webContents,[...state.steps,control.selector],signal)
        if(new URL(win.webContents.getURL()).origin!==origin)continue
        const next=await abortable(win.webContents.executeJavaScript(inspectScript),signal) as typeof info
        const key=fingerprint(prototypeRouteIdentity(win.webContents.getURL())+'|'+next.signature+'|'+next.visual)
        const same=fingerprint(info.route+'|'+info.signature+'|'+info.visual)===key
        if(same){deduplication.push({source:state.pattern,control:control.label,route:prototypeRouteIdentity(win.webContents.getURL()),fingerprint:key,decision:'unchanged'});continue}
        let destination=fingerprints.get(key)
        if(!destination){
          destination='/__prototype_state_'+states.length
          fingerprints.set(key,destination)
          states.push({pattern:destination,url:state.url,name:control.label||next.title,steps:[...state.steps,control.selector]})
          inspected.set(destination,{...next,route:prototypeRouteIdentity(win.webContents.getURL())})
        }
        deduplication.push({source:state.pattern,control:control.label,route:prototypeRouteIdentity(win.webContents.getURL()),fingerprint:key,decision:'transition',destination})
        transitions.push({source:state.pattern,destination,selector:control.selector,label:control.label})
      }catch{signal?.throwIfAborted();warnings.push(`“${control.label}” could not be replayed automatically.`)}finally{if(!win.isDestroyed())win.destroy()}
    }
  }
  signal?.throwIfAborted()
  return {states:states.filter(s=>!unrendered.has(s.pattern)),transitions,deduplication,warnings:[...new Set(warnings)]}
}
