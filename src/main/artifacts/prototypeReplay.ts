import type {WebContents} from 'electron'
import type {ArtifactStep,ReplayStep} from '../../shared/artifactDiscovery'
import {stepOf} from '../../shared/artifactDiscovery'
import {abortable} from './importJob'
export const resolvePrototypeElement=`const find=path=>{let doc=document,result;for(const frame of path.split(' ||| ')){let root=doc;for(const part of frame.split(' >>> ')){result=root.querySelector(part);if(!result)return null;root=result.shadowRoot||result.ownerDocument.defaultView.__frameuiDiscovery?.roots.get(result)}doc=result.contentDocument}return result}`
export const SETTLE_PROTOTYPE_SCRIPT=`(async()=>{
 let changed=Date.now();const observer=new MutationObserver(records=>{if(records.some(r=>r.type!=='attributes'||!r.attributeName.startsWith('data-frameui-')))changed=Date.now()});
 observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true});const deadline=Date.now()+2500;
 try{do{await new Promise(resolve=>setTimeout(resolve,40))}while(Date.now()<deadline&&(Date.now()-changed<120||document.fonts?.status==='loading'||(window.__frameuiDiscovery?.requests??0)>0||(window.__frameuiDiscovery?.pending.size??0)>0||Array.from(document.images).some(img=>{const r=img.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0&&!img.complete})))}finally{observer.disconnect()}
 return {settled:Date.now()<deadline};
})()`
function actionScript(step:ArtifactStep){return `(() => {
 ${resolvePrototypeElement};const step=${JSON.stringify(step)},el=find(step.selector);if(!el)return false;const owner=el.ownerDocument,innerHeight=owner.defaultView.innerHeight;
 if(step.event==='open-select'){
  owner.querySelectorAll('[data-frameui-native-menu]').forEach(n=>n.remove());
  const rect=el.getBoundingClientRect(),menu=owner.createElement('div');menu.setAttribute('role','listbox');menu.setAttribute('aria-label',(el.getAttribute('aria-label')||el.name||'Select')+' options');menu.setAttribute('data-frameui-native-menu','true');
  Object.assign(menu.style,{position:'fixed',left:rect.left+'px',top:Math.min(rect.bottom,innerHeight-240)+'px',width:Math.max(rect.width,160)+'px',maxHeight:'240px',overflowY:'auto',background:'#fff',color:'#172b40',border:'1px solid #b8c0cc',boxShadow:'0 6px 18px #0003',zIndex:'2147483647',font:getComputedStyle(el).font});
  for(const option of el.options){const row=owner.createElement('button');row.type='button';row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));row.setAttribute('data-frameui-select-target',step.selector);row.setAttribute('data-frameui-option-value',option.value);row.disabled=option.disabled;row.textContent=option.label;Object.assign(row.style,{display:'block',width:'100%',border:'0',padding:'8px 12px',textAlign:'left',font:'inherit',color:'inherit',background:option.selected?'#e7efff':'#fff'});menu.append(row)}
  owner.body.append(menu);return true;
 }
 if(step.event==='select'){
  owner.querySelectorAll('[data-frameui-native-menu]').forEach(n=>n.remove());
  el.value=step.value??'';el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return true;
 }
 if(step.event==='scroll'){el.scrollTo({left:step.x??0,top:step.y??0,behavior:'instant'});return true}
 if(step.event==='input'){const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,step.value??'');el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return true}
 if(step.event==='key'){if(step.key==='ESC')owner.querySelectorAll('[data-frameui-native-menu]').forEach(n=>n.remove());el.dispatchEvent(new KeyboardEvent('keydown',{key:step.key==='ESC'?'Escape':step.key==='ENTER'?'Enter':step.key,bubbles:true,composed:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:step.key==='ESC'?'Escape':step.key==='ENTER'?'Enter':step.key,bubbles:true,composed:true}));return true}
 if(step.event==='hover'){for(const event of ['pointerover','pointerenter','mouseover','mouseenter'])el.dispatchEvent(new MouseEvent(event,{bubbles:!event.endsWith('enter'),composed:true}));return true}
 el.click();return true;
})()`}
export async function replayPrototype(web:WebContents,steps:ReplayStep[],signal?:AbortSignal){
 for(const raw of steps){
  signal?.throwIfAborted();const step=stepOf(raw)
  const hasPointer=typeof web.sendInputEvent==='function';let performed=false
  if(hasPointer&&['click','hover'].includes(step.event)){
   const target=await abortable(web.executeJavaScript(`(() => {${resolvePrototypeElement};const el=find(${JSON.stringify(step.selector)});if(!el)return null;if(el.tagName==='A'&&el.target==='_blank')el.target='_self';el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const doc=el.ownerDocument,r=el.getBoundingClientRect();let x=Math.round(Math.max(1,Math.min(doc.defaultView.innerWidth-2,r.left+r.width/2))),y=Math.round(Math.max(1,Math.min(doc.defaultView.innerHeight-2,r.top+r.height/2))),hit=doc.elementFromPoint(x,y);while(hit&&(hit.shadowRoot||hit.ownerDocument.defaultView.__frameuiDiscovery?.roots.get(hit))){const deeper=(hit.shadowRoot||hit.ownerDocument.defaultView.__frameuiDiscovery.roots.get(hit)).elementFromPoint(x,y);if(!deeper||deeper===hit)break;hit=deeper}if(!hit||!(el===hit||el.contains(hit)))return null;let view=doc.defaultView;while(view.frameElement){const frame=view.frameElement,box=frame.getBoundingClientRect();x+=Math.round(box.left+frame.clientLeft);y+=Math.round(box.top+frame.clientTop);const parentHit=frame.ownerDocument.elementFromPoint(x,y);if(parentHit!==frame)return null;view=frame.ownerDocument.defaultView}return {x,y}})()`),signal) as {x:number;y:number}|null
   if(!target)throw new Error('The prototype control is obscured or no longer available.')
   web.sendInputEvent({type:'mouseMove',...target})
   if(step.event==='click'){web.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...target});web.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...target})}
   performed=true
  }else if(hasPointer&&step.event==='key'){
   const keyCode=step.key==='ESC'?'Escape':step.key==='ENTER'?'Enter':step.key??'Enter'
   await abortable(web.executeJavaScript(`(() => {${resolvePrototypeElement};find(${JSON.stringify(step.selector)})?.focus();${step.key==='ESC'?`document.querySelectorAll('[data-frameui-native-menu]').forEach(n=>n.remove())`:''}})()`),signal)
   web.sendInputEvent({type:'keyDown',keyCode});web.sendInputEvent({type:'keyUp',keyCode});performed=true
  }
  if(!performed&&!await abortable(web.executeJavaScript(actionScript(step)),signal))throw new Error('A prototype control changed. Recapture this state from the live prototype.')
  if(typeof web.loadURL==='function'){const popup=await abortable(web.executeJavaScript('window.__frameuiDiscovery?.popup'),signal) as string|undefined;if(popup&&new URL(popup).origin===new URL(web.getURL()).origin)await abortable(web.loadURL(popup),signal)}
  if(step.event!=='scroll')await abortable(web.executeJavaScript('window.scrollTo({left:0,top:0,behavior:"instant"})'),signal)
  await abortable(web.executeJavaScript(SETTLE_PROTOTYPE_SCRIPT),signal)
 }
}
