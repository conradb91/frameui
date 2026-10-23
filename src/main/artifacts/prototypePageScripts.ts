/** Executed in the prototype's main world before its scripts. No host APIs are exposed. */
export const PROTOTYPE_INSTRUMENTATION_SCRIPT=`(() => {
 if(window.__frameuiDiscovery)return;
 const listeners=new WeakMap(),original=EventTarget.prototype.addEventListener;
 const state={handlers:new WeakMap(),delegatedHandlers:[],listeners,delegated:new Set(),hints:new Set(),roots:new WeakMap(),pending:new Map(),requests:0,changed:Date.now()};
 Object.defineProperty(window,'__frameuiDiscovery',{value:state,configurable:true});
 EventTarget.prototype.addEventListener=function(type,listener,options){
  if(listener){if(typeof listener==='function'){let handlers=state.handlers.get(this);if(!handlers)state.handlers.set(this,handlers=new Map());let values=handlers.get(type);if(!values)handlers.set(type,values=new Set());values.add(Function.prototype.toString.call(listener));state.delegatedHandlers.push({owner:this,type,code:Function.prototype.toString.call(listener)})}let events=listeners.get(this);if(!events)listeners.set(this,events=new Set());events.add(type);if(typeof listener==='function'){const code=Function.prototype.toString.call(listener);for(const m of code.matchAll(/\\.(?:closest|matches)\\(\\s*['"]([^'"]+)['"]/g))state.hints.add(m[1]);for(const m of code.matchAll(/\\.target\\.id\\s*===?\\s*['"]([^'"]+)['"]/g))state.hints.add('#'+m[1])}if(this===window||this===document||this===document.documentElement||this===document.body)state.delegated.add(type)}
  return Reflect.apply(original,this,[type,listener,options]);
 };
 const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=Reflect.apply(attach,this,[options]);state.roots.set(this,root);new MutationObserver(()=>state.changed=Date.now()).observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return root};
 const timeout=window.setTimeout,clear=window.clearTimeout;window.setTimeout=function(callback,delay,...args){let id;id=timeout(function(){state.pending.delete(id);state.changed=Date.now();if(typeof callback==='function')Reflect.apply(callback,window,args);else (0,eval)(callback)},delay);if(Number(delay)<=2500)state.pending.set(id,Date.now()+Number(delay||0));return id};window.clearTimeout=function(id){state.pending.delete(id);return clear(id)};
 // Prototype exploration cannot open native system dialogs, regardless of labels.
 window.print=()=>{state.externalAction='Native print dialog'};
 for(const name of ['showOpenFilePicker','showSaveFilePicker','showDirectoryPicker'])if(typeof window[name]==='function')window[name]=()=>{state.externalAction='Native file picker';return Promise.reject(new DOMException('System dialogs are unavailable during prototype capture.','NotAllowedError'))};
 const inputClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'){state.externalAction='Native file picker';return}return Reflect.apply(inputClick,this,[])};
 const open=window.open;window.open=function(url,...args){try{state.popup=new URL(url,location.href).href}catch{}return Reflect.apply(open,this,[url,...args])};
 const fetchOriginal=window.fetch;if(fetchOriginal)window.fetch=function(...args){state.requests++;return Reflect.apply(fetchOriginal,this,args).finally(()=>{state.requests--;state.changed=Date.now()})};
 new MutationObserver(records=>{if(records.some(r=>r.type!=='attributes'||!r.attributeName.startsWith('data-frameui-')))state.changed=Date.now()}).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
})()`
/** Paths are ordinary CSS inside each root; explicit separators cross roots. */
export const DEEP_DOM_HELPERS=`
 const selectorCache=new WeakMap(),styleCache=new WeakMap(),rectCache=new WeakMap();
 const styleOf=el=>{if(!styleCache.has(el))styleCache.set(el,el.ownerDocument.defaultView.getComputedStyle(el));return styleCache.get(el)};
 const rectOf=el=>{if(!rectCache.has(el))rectCache.set(el,el.getBoundingClientRect());return rectCache.get(el)};
 const deepFind=path=>{let doc=document,result;for(const frame of path.split(' ||| ')){let root=doc;for(const segment of frame.split(' >>> ')){result=root.querySelector(segment);if(!result)return null;root=result.shadowRoot||result.ownerDocument.defaultView.__frameuiDiscovery?.roots.get(result)}doc=result.contentDocument}return result};
 const frameOwners=new WeakMap();
 const selector=el=>{if(selectorCache.has(el))return selectorCache.get(el);let c=el,parts=[];while(c&&c.nodeType===1){if(c===el.ownerDocument.documentElement){parts.unshift('html');break}const owner=c.parentElement;if(!owner){const root=c.getRootNode();if(root.host){parts.unshift(selector(root.host)+' >>> '+c.tagName.toLowerCase()+':nth-child('+(Array.prototype.indexOf.call(root.children,c)+1)+')');break}break}parts.unshift(c.tagName.toLowerCase()+':nth-child('+(Array.prototype.indexOf.call(owner.children,c)+1)+')');c=owner}let result=parts.join('>');const frame=frameOwners.get(el.ownerDocument);if(frame&&!result.includes(' ||| '))result=selector(frame)+' ||| '+result;selectorCache.set(el,result);return result};
 const all=[],inaccessibleFrames=[],documents=new Set([document]);const walk=root=>{for(const el of root.querySelectorAll('*')){all.push(el);const shadow=el.shadowRoot||el.ownerDocument.defaultView.__frameuiDiscovery?.roots.get(el);if(shadow)walk(shadow);if(el.tagName==='IFRAME'){try{const child=el.contentDocument;if(child&&!documents.has(child)){documents.add(child);frameOwners.set(child,el);walk(child)}else if(!child)inaccessibleFrames.push(el)}catch{inaccessibleFrames.push(el)}}}};walk(document);
`
export const inspectScript=`(() => {
 ${DEEP_DOM_HELPERS}
 const exposed=el=>{const r=rectOf(el),s=styleOf(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'&&!el.closest('[hidden],[inert]')};
 const modal=all.find(el=>el.matches('dialog:modal,[aria-modal="true"]')&&exposed(el));
 const overlay=modal||all.find(el=>el.matches('[data-drawer],.drawer,.side-panel,[role="dialog"],[popover]:popover-open,[role="listbox"],[role="menu"]')&&exposed(el));
 const visible=el=>exposed(el)&&(!modal||modal.ownerDocument!==el.ownerDocument||modal===el||modal.contains(el)||el.getRootNode().host&&modal.contains(el.getRootNode().host));
 const hoverSelectors=[];
 const selectorParts=value=>{const parts=[];let start=0,depth=0,quote='';for(let i=0;i<value.length;i++){const c=value[i];if(quote){if(c===quote&&value.charCodeAt(i-1)!==92)quote='';continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(c===','&&!depth){parts.push(value.slice(start,i));start=i+1}}parts.push(value.slice(start));return parts};
 const cssRoots=new Set([document,...all.map(el=>el.getRootNode()).filter(root=>root.host),...all.filter(el=>el.tagName==='IFRAME').map(el=>{try{return el.contentDocument}catch{return null}}).filter(Boolean)]);
 const cssRules=(rules,root)=>{for(const rule of rules){if(rule.selectorText&&rule.style&&['display','visibility','opacity','content','height','max-height','width','max-width'].some(property=>rule.style.getPropertyValue(property)))for(const part of selectorParts(rule.selectorText)){const at=part.indexOf(':hover');if(at<0)continue;const target=part.slice(0,at).trim()||'*';try{for(const el of root.querySelectorAll(target))hoverSelectors.push(el)}catch{}}if(rule.cssRules)cssRules(rule.cssRules,root)}};
 for(const root of cssRoots)for(const sheet of [...(root.styleSheets||[]),...(root.adoptedStyleSheets||[])]){try{cssRules(sheet.cssRules,root)}catch{}}

 const hinted=new Set();for(const hint of window.__frameuiDiscovery?.hints??[]){try{document.querySelectorAll(hint).forEach(el=>hinted.add(el))}catch{}}
 const hoverTargets=new Set(hoverSelectors),controls=[],blocked=[],reconstructed=!!document.querySelector('[data-frameui-native-menu]');
 const tabs=el=>el.matches('[role="tab"],[data-tab],[data-bs-toggle="tab"],[data-toggle="tab"]')||!!el.closest('[role="tablist"],.tabs,.tab-buttons,.tab-nav,.nav-tabs');
 // Follow available local functions by identity, irrespective of their names.
 const invokesView=(code,view,depth=0,seen=new Set())=>{if(/\\.showModal\\s*\\(|\\.showPopover\\s*\\(/.test(code))return true;if(depth>=4)return false;for(const match of code.matchAll(/\\b([A-Za-z_$][\\w$]*)\\s*\\(/g)){const name=match[1];if(seen.has(name))continue;seen.add(name);let fn;try{fn=Object.getOwnPropertyDescriptor(view,name)?.value}catch{}if(typeof fn==='function'&&invokesView(Function.prototype.toString.call(fn),view,depth+1,seen))return true}return false};
 const labelOf=el=>(el.getAttribute('aria-label')||el.getAttribute('title')||el.labels?.[0]?.textContent||el.getAttribute('placeholder')||el.innerText||el.textContent||el.getAttribute('name')||el.tagName).trim().replace(/\\s+/g,' ').slice(0,160);
 const add=(el,event,extra={})=>{const path=selector(el);el.setAttribute('data-frameui-selector',path);el.setAttribute('data-frameui-interactive','true');controls.push({selector:path,label:labelOf(el),event,componentType:tabs(el)?'tab':el.matches('summary,[aria-expanded]')?'disclosure':el.matches('select,[role=combobox],[role=option],[role=listbox]')?'dropdown':el.matches('input[type=checkbox],[role=checkbox]')?'checkbox':el.matches('input[type=radio],[role=radio]')?'radio':el.matches('input,textarea')?'input':el.matches('button,[role=button]')?'button':el.matches('a[href]')?'link':el.matches('tr,[role=row]')?'row':event==='scroll'?'scroll':'control',kind:tabs(el)?'tab':el.matches('summary,[aria-expanded]')?'disclosure':el.matches('select,[role="combobox"],[role="option"],[role="listbox"]')?'dropdown':event==='input'||event==='select'?'filter':event==='scroll'?'scroll':'control',...(el.tagName==='A'?{href:el.href}:{}),...extra})};
 for(const el of all){
  if(!visible(el))continue;
  const events=new Set([...(el.ownerDocument.defaultView.__frameuiDiscovery?.listeners.get(el)||[]),...(el.getAttribute('data-frameui-listeners')||'').split(',').filter(Boolean)]);
  const native=el.matches('a[href],button,summary,select,input:not([type="hidden"]),textarea,[role="button"],[role="tab"],[role="combobox"],[role="option"],[role="menuitem"],[aria-expanded],[aria-controls],[onclick],[data-tab],[data-go],[data-cat],[tabindex]:not([tabindex="-1"])');
  let semanticParent=el.parentElement;while(semanticParent&&!semanticParent.matches('button,a,summary,tr,[role=button],[role=tab],[role=option],[role=menuitem],[onclick]')&&!hinted.has(semanticParent)&&!semanticParent.ownerDocument.defaultView.__frameuiDiscovery?.listeners.get(semanticParent)?.has('click'))semanticParent=semanticParent.parentElement;
  const pointer=styleOf(el).cursor==='pointer'&&!!(el.textContent||'').trim()&&!semanticParent;
  const props=el[Object.keys(el).find(key=>key.startsWith('__reactProps$'))];if(props){for(const key of Object.keys(props))if(typeof props[key]==='function'){if(key==='onClick')events.add('click');if(key==='onMouseEnter'||key==='onMouseOver')events.add('mouseenter')}}if(el._vei){for(const key of Object.keys(el._vei)){if(/click/i.test(key))events.add('click');if(/mouseenter|mouseover|pointerenter/i.test(key))events.add('mouseenter')}}
  const clickCodes=[...(el.ownerDocument.defaultView.__frameuiDiscovery?.handlers.get(el)?.get('click')||[])],directClick=events.has('click')&&(!clickCodes.length||clickCodes.some(code=>!(/\\.(?:closest|matches)\\(/.test(code))||/currentTarget/.test(code)));
  const eventful=hinted.has(el)||directClick||events.has('mouseenter')||events.has('mouseover')||events.has('pointerenter');
  if(!native&&!pointer&&!eventful&&!hoverTargets.has(el))continue;
  const label=labelOf(el),type=(el.getAttribute('type')||'').toLowerCase();
  const handlerCode=[...(el.ownerDocument.defaultView.__frameuiDiscovery?.handlers.get(el)?.get('click')||[]),el.getAttribute('onclick')||'',typeof el.onclick==='function'?String(el.onclick):'',...(el.ownerDocument.defaultView.__frameuiDiscovery?.delegatedHandlers||[]).filter(h=>h.type==='click'&&h.owner?.contains?.(el)&&Array.from((h.code.matchAll(/\\.(?:closest|matches)\\(\\s*['"]([^'"]+)['"]/g)),m=>m[1]).some(selector=>{try{return el.matches(selector)}catch{return false}})).map(h=>h.code)].join(' ');
  // Names are presentation only: discover candidates from semantics and handlers,
  // then classify the saved transition from the observed destination.
  const controlled=el.getAttribute('aria-controls')||el.getAttribute('popovertarget')||el.getAttribute('data-bs-target')||el.getAttribute('data-target');
  let controlledView;try{controlledView=controlled&&(el.ownerDocument.getElementById(controlled)||el.ownerDocument.querySelector(controlled))}catch{}
  const opensView=el.hasAttribute('aria-haspopup')||el.hasAttribute('popovertarget')||!!controlledView?.matches('dialog,[role="dialog"],[role="menu"],[role="listbox"],[popover],[data-drawer]')||invokesView(handlerCode,el.ownerDocument.defaultView);
  const hasHandler=!!handlerCode.trim()||directClick||hinted.has(el);

  const form=el.form,submitCodes=form?[...(form.ownerDocument.defaultView.__frameuiDiscovery?.handlers.get(form)?.get('submit')||[]),form.getAttribute('onsubmit')||'']:[];
  const clientSubmit=!!form&&submitCodes.some(code=>/\\.preventDefault\\s*\\(/.test(code));
  const clickable=native||pointer||hinted.has(el)||directClick;
  if(el.readOnly&&!events.has('click')&&!hinted.has(el)&&!el.hasAttribute('onclick'))continue;

  let reason=el.tagName==='CANVAS'?'Canvas hit regions require manual exploration':el.disabled||el.getAttribute('aria-disabled')==='true'?'Disabled control':el.hasAttribute('download')||/\\b(?:print|showSaveFilePicker|showOpenFilePicker)\\s*\\(/.test(handlerCode)?'Action opens an external system interface':el.matches('button,input')&&(type==='submit'||type==='reset'||el.form&&el.tagName==='BUTTON'&&type!=='button')&&!clientSubmit?'Form submission requires manual review':el.matches('input')&&['password','file','hidden'].includes(type)?'Sensitive or file input':undefined;
  if(reason){blocked.push({selector:selector(el),label,event:'click',reason});continue}
  if(!clickable){if(hoverTargets.has(el)||events.has('mouseenter')||events.has('mouseover')||events.has('pointerenter'))add(el,'hover');continue}
  if(el.matches('[data-frameui-select-target]'))add(el,'select',{target:el.getAttribute('data-frameui-select-target'),value:el.getAttribute('data-frameui-option-value')||'',kind:'dropdown'});
  else if(el.tagName==='SELECT')add(el,'open-select',{kind:'dropdown'});
  else if(el.readOnly)add(el,'click');
  else if(el.matches('input')&&['range','number','date','time','color'].includes(type)){
   const minimum=Number(el.getAttribute('min')||0),maximum=Number(el.getAttribute('max')||100);
   const sample=el.getAttribute('data-frameui-sample')||(type==='date'?'2026-01-15':type==='time'?'12:30':type==='color'?'#3366ff':String(Number(el.value)===minimum?maximum:minimum));
   add(el,'input',{value:sample,kind:'filter'});
  }
  else if(el.matches('textarea,input')&&!['checkbox','radio','range','button','reset','submit','color','date','time','number'].includes(type)){
   const current=el.value||'',match=/search|filter|find/i.test(label+' '+el.type)&&!el.form?el.closest('section,main')?.querySelector('tbody td,[role=cell]')?.textContent?.trim().slice(0,100):'',sample=el.getAttribute('data-frameui-sample')||match||((el.getAttribute('type')==='email')?'review@example.test':'review');
   add(el,'input',{value:current?'':sample,kind:'filter'});
   if(match&&sample!=='review')add(el,'input',{value:'review-unmatched-item',kind:'filter'});
   if(current)add(el,'key',{key:'ENTER',kind:'filter'});
  }else add(el,'click',{...(opensView?{opensView:true}:{}),...(hasHandler?{hasHandler:true}:{}),...(clientSubmit&&el.matches('button,input')&&!['button','reset'].includes(type)?{clientSubmit:true}:{})});
  if(events.has('mouseenter')||events.has('mouseover')||events.has('pointerenter')||el.hasAttribute('onmouseenter')||el.hasAttribute('onmouseover')||hoverTargets.has(el))add(el,'hover');
 }
 // Scroll states expose lazy/virtualized content without enlarging their viewport.
 const scrolls=all.filter(el=>visible(el)&&((el.scrollHeight>el.clientHeight+8&&/auto|scroll/.test(styleOf(el).overflowY))||(el.scrollWidth>el.clientWidth+8&&/auto|scroll/.test(styleOf(el).overflowX)))&&el.clientHeight>30&&el.clientWidth>80);
 for(const el of scrolls){el.setAttribute('data-frameui-scroll',JSON.stringify({x:el.scrollLeft,y:el.scrollTop,width:el.clientWidth,height:el.clientHeight,contentWidth:el.scrollWidth,contentHeight:el.scrollHeight}));const max=el.scrollHeight-el.clientHeight;if(el.scrollTop<max-2)add(el,'scroll',{x:el.scrollLeft,y:Math.min(max,el.scrollTop+Math.max(80,el.clientHeight*.85)),kind:'scroll',label:'Scroll '+labelOf(el).slice(0,70)});const maxX=el.scrollWidth-el.clientWidth;if(el.scrollLeft<maxX-2)add(el,'scroll',{x:Math.min(maxX,el.scrollLeft+el.clientWidth*.85),y:el.scrollTop,value:'horizontal',kind:'scroll',label:'Scroll horizontally '+labelOf(el).slice(0,70)})}
 if(document.scrollingElement?.scrollHeight>innerHeight+8&&scrollY+innerHeight<document.scrollingElement.scrollHeight-2)add(document.scrollingElement,'scroll',{x:0,y:Math.min(document.scrollingElement.scrollHeight-innerHeight,scrollY+innerHeight*.85),kind:'scroll',label:'Scroll page'});
 if(overlay){overlay.setAttribute('data-frameui-selector',selector(overlay));overlay.setAttribute('data-frameui-interactive','true');controls.push({selector:selector(overlay),label:'Dismiss '+(overlay.querySelector('h1,h2,h3')?.textContent||'open view'),event:'key',key:'ESC',kind:'control'})}
 const expanded=all.filter(el=>visible(el)&&el.matches('details[open],[aria-expanded="true"]')).map(selector);
 // Stream the complete visible tree into a compact hash. Position and live form state matter.
 let h=2166136261,h2=5381;const hash=value=>{for(let i=0;i<value.length;i++){h=Math.imul(h^value.charCodeAt(i),16777619);h2=Math.imul(h2,33)^value.charCodeAt(i)}};
 let count=0,meaningful=false;const semantic=[];
 for(const el of all){if(!exposed(el))continue;count++;const r=rectOf(el),s=styleOf(el),path=selector(el),text=Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\\s+/g,' ').trim();
 if(text||el.matches('img,svg,canvas,iframe,button,input,textarea,select')||!el.matches('html,body')&&(s.backgroundColor!=='transparent'&&s.backgroundColor!=='rgba(0, 0, 0, 0)'||s.backgroundImage!=='none'||parseFloat(s.borderTopWidth)>0))meaningful=true;
 const value=el.matches('input[type="password"],input[type="file"]')?'':el.value??'';
 hash([path,text,value,el.checked,el.getAttribute('src'),el.getAttribute('class'),el.getAttribute('aria-selected'),el.getAttribute('aria-expanded'),Math.round((r.x+scrollX)*2)/2,Math.round((r.y+scrollY)*2)/2,Math.round(r.width*2)/2,Math.round(r.height*2)/2,s.display,s.visibility,s.backgroundColor,s.backgroundImage.replaceAll(location.origin,''),s.color,s.opacity,s.transform,el.scrollTop,el.scrollLeft].join(':'));
 semantic.push([path,text,value,el.checked,el.getAttribute('aria-selected'),el.getAttribute('aria-expanded'),Math.round(r.width),Math.round(r.height),el.getAttribute('d'),el.getAttribute('points')].join(':'));
 }
 const overlayKind=overlay?(/drawer|side-panel/i.test(overlay.className+' '+overlay.getAttribute('data-drawer'))?'drawer':overlay.matches('[role="menu"],[role="listbox"],[popover]')?'dropdown':'modal'):undefined;
 const title=overlay?.querySelector('h1,h2,h3')?.textContent?.trim()||Array.from(document.querySelectorAll('main h1,h1')).find(visible)?.textContent?.trim()||document.title||'Prototype';
 for(const el of inaccessibleFrames)blocked.push({selector:selector(el),label:el.getAttribute('title')||'Embedded frame',event:'frame',reason:'Embedded document is outside the allowed origin or unavailable.'});
 const priority=c=>c.event==='hover'?14:c.event==='scroll'?15:c.event==='input'?(modal?25:7):c.event==='key'?60:c.opensView?0:c.clientSubmit?-20:c.event==='select'?-20:c.kind==='tab'?3:c.hasHandler?(c.componentType==='button'?4:c.componentType==='row'?12:8):c.event==='open-select'?6:10;
 const ordered=controls.map(c=>({...c,priority:priority(c)})).sort((a,b)=>a.priority-b.priority);

 return {totalControls:controls.length+blocked.length,skippedControls:blocked.length,eligibleControls:controls.length,checkedControls:controls.length,visible:meaningful,title,signature:semantic.join('|'),visual:(h>>>0).toString(16)+':'+(h2>>>0).toString(16),controls:ordered,blocked,expanded,overlay:overlayKind,overlaySelector:overlay?selector(overlay):undefined,reconstructed,visualElements:count,popup:window.__frameuiDiscovery?.popup,externalAction:window.__frameuiDiscovery?.externalAction,frameWarnings:inaccessibleFrames.map(el=>'External embedded frame: '+(el.getAttribute('src')||'inline')+' could not be explored from this source.')};
})()`
