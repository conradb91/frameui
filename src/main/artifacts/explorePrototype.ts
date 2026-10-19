import { abortable } from './importJob'
import type { ArtifactImportProgress } from '../../shared/types/artifactImport'
import type { BrowserWindow, WebContents } from 'electron'
import { createHash } from 'node:crypto'

export interface ArtifactState {pattern:string;url:string;name:string;steps:string[]}
export interface ArtifactTransition {source:string;destination:string;selector:string;label:string}
const inspectScript = `(() => {
  function selector(el) { const parts=[]; while(el.parentElement && el!==document.documentElement) {parts.unshift(el.tagName.toLowerCase()+':nth-child('+(Array.from(el.parentElement.children).indexOf(el)+1)+')');el=el.parentElement} return 'html>'+parts.join('>') }
  const visible=el=>{const modal=Array.from(document.querySelectorAll('dialog:modal,[aria-modal="true"]')).find(m=>m.getClientRects().length&&getComputedStyle(m).visibility!=='hidden'&&getComputedStyle(m).display!=='none');if(modal&&!modal.contains(el))return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
  return {visible:!!(document.body.innerText.trim()||document.querySelector('img,svg,canvas')),title:document.querySelector('[role="dialog"] h1,dialog[open] h1,main h1,h1')?.textContent?.trim()||document.title||'Prototype',
    signature:document.body.innerText.replace(/\\s+/g,' ').trim()+'|'+Array.from(document.querySelectorAll('dialog[open],[aria-expanded="true"],[aria-selected="true"],details[open]')).map(selector).join('|'),
    controls:Array.from(document.querySelectorAll('a[href],button,[role="button"],[role="tab"],summary')).filter(visible).filter(el=>!el.disabled&&!/delete|remove|purchase|pay now|logout|log out|sign out/i.test(el.textContent||'')).map(el=>({selector:selector(el),label:(el.getAttribute('aria-label')||el.textContent||'Open state').trim().slice(0,100),href:el.tagName==='A'?el.href:undefined})).slice(0,16)};
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
  const states:ArtifactState[]=[],transitions:ArtifactTransition[]=[],warnings:string[]=[]
  const fingerprints=new Map<string,string>(),unrendered=new Set<string>()
  const origin=new URL(url).origin
  let attempts=0
  async function inspect(state:ArtifactState){
    const win=await abortable(open(state.url),signal)
    try{await replayPrototype(win.webContents,state.steps,signal);return await abortable(win.webContents.executeJavaScript(inspectScript),signal) as {visible:boolean;title:string;signature:string;controls:{selector:string;label:string;href?:string}[]}}
    finally{if(!win.isDestroyed())win.destroy()}
  }
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
    try{info=await inspect(state)}catch{signal?.throwIfAborted();warnings.push(`Could not explore ${state.name}. Open it in Capture to review.`);continue}
    if(!info.visible){unrendered.add(state.pattern);warnings.push(`${state.name} did not render visible content. Export runnable HTML rather than a source-only project.`);continue}
    if(!state.steps.length)state.name=info.title.slice(0,180)
    fingerprints.set(fingerprint(new URL(state.url).pathname+'|'+info.signature),state.pattern)
    for(const control of info.controls){
      signal?.throwIfAborted()
      if(attempts>=60||states.length>=40||state.steps.length>=4){warnings.push('Automatic exploration reached its limit. Open the prototype in Capture to add remaining screens or states.');break}
      if(control.href){
        const target=new URL(control.href)
        if(target.origin!==origin||!/^https?:$/.test(target.protocol))continue
        // Ordinary anchors scroll within a screen; hash routers change screens.
        if(target.pathname===new URL(state.url).pathname&&target.hash&&!/^#!?\//.test(target.hash))continue
        const existing=states.find(s=>s.url===target.href&&!s.steps.length)
        if(existing){transitions.push({source:state.pattern,destination:existing.pattern,selector:control.selector,label:control.label});continue}
      }
      progress?.({completed:attempts,screens:states.length,connections:transitions.length,detail:`Checking ${control.label || 'interaction'} on ${state.name}`})
      attempts++
      const win=await abortable(open(state.url),signal)
      try{
        await replayPrototype(win.webContents,[...state.steps,control.selector],signal)
        if(new URL(win.webContents.getURL()).origin!==origin)continue
        const next=await abortable(win.webContents.executeJavaScript(inspectScript),signal) as typeof info
        const key=fingerprint(new URL(win.webContents.getURL()).pathname+'|'+next.signature)
        const same=fingerprint(new URL(state.url).pathname+'|'+info.signature)===key
        if(same)continue
        let destination=fingerprints.get(key)
        if(!destination){
          destination='/__prototype_state_'+states.length
          fingerprints.set(key,destination)
          states.push({pattern:destination,url:state.url,name:control.label||next.title,steps:[...state.steps,control.selector]})
        }
        transitions.push({source:state.pattern,destination,selector:control.selector,label:control.label})
      }catch{signal?.throwIfAborted();warnings.push(`“${control.label}” could not be replayed automatically.`)}finally{if(!win.isDestroyed())win.destroy()}
    }
  }
  signal?.throwIfAborted()
  return {states:states.filter(s=>!unrendered.has(s.pattern)),transitions,warnings:[...new Set(warnings)]}
}
