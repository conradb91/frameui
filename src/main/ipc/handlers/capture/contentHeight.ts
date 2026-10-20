/** Preserve natural document height, including overflow, without padding short pages to the viewport. */
export const CONTENT_METRICS_SCRIPT=`(() => {
 const body=document.body,rect=body.getBoundingClientRect(),style=getComputedStyle(body);
 const viewport=innerHeight,scroll=document.scrollingElement;
 let height=rect.bottom+scrollY+(parseFloat(style.marginBottom)||0);
 if(scroll.scrollHeight>viewport+1)height=Math.max(height,scroll.scrollHeight);
 for(const el of document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true],[data-drawer],[data-side-panel],.drawer,.side-panel,[popover]:popover-open')){const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden')height=Math.max(height,r.bottom+scrollY)}
 // Absolutely positioned artifact content may not contribute to body height or scrollHeight.
 const cache=new WeakMap(),styles=el=>{if(!cache.has(el))cache.set(el,getComputedStyle(el));return cache.get(el)};
 for(const el of body.querySelectorAll('*')){
  const r=el.getBoundingClientRect();if(!r.width||!r.height||r.bottom+scrollY<=height)continue;
  let top=r.top+scrollY,bottom=r.bottom+scrollY,hidden=false;
  for(let owner=el;owner&&owner!==document.documentElement;owner=owner.parentElement){
   const s=styles(owner);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0){hidden=true;break}
   const clip=/^rect\\((.*)\\)$/.exec(s.clip),edges=clip?.[1].split(/[,\\s]+/).filter(Boolean).map(parseFloat);
   if(edges?.length===4&&(edges[2]<=edges[0]||edges[1]<=edges[3])){hidden=true;break}
   if(owner!==el&&owner!==scroll&&/hidden|clip|auto|scroll/.test(s.overflowY)){const box=owner.getBoundingClientRect();top=Math.max(top,box.top+scrollY);bottom=Math.min(bottom,box.bottom+scrollY)}
  }
  if(!hidden&&bottom>top)height=Math.max(height,bottom);
 }
 return {width:rect.width,height:Math.max(1,Math.ceil(height))};
})()`
/** Expand document and drawer scroll regions without changing their rendered width.
 * Fixed top/bottom constraints must be released, otherwise height:auto remains viewport-bound.
 */
export const EXPAND_ARTIFACT_PANELS_SCRIPT=`(() => {
 const drawerSelector='dialog[open],[role="dialog"],[aria-modal="true"],[data-drawer],[data-side-panel],.drawer,.side-panel';
 const candidates=Array.from(document.querySelectorAll('main,section,article,aside,dialog,div,[data-drawer],[data-side-panel]')).filter(el=>{
  const r=el.getBoundingClientRect(),s=getComputedStyle(el),drawer=el.closest(drawerSelector);
  if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;
  return r.width>=(drawer?160:innerWidth*.4)&&r.height>=(drawer?80:200)&&el.scrollHeight>el.clientHeight+2&&/auto|scroll/.test(s.overflowY);
 });
 const expanded=new Set();
 const expand=el=>{
  if(expanded.has(el))return;expanded.add(el);
  const s=getComputedStyle(el),r=el.getBoundingClientRect();
  if(s.position==='fixed'||s.position==='absolute'){
   const m=new DOMMatrixReadOnly(s.transform==='none'?undefined:s.transform),translation=m.a===1&&m.b===0&&m.c===0&&m.d===1;
   el.style.setProperty('width',(translation?r.width:el.offsetWidth)+'px','important');el.style.setProperty('box-sizing','border-box','important');
   if(translation&&s.transform!=='none')el.style.setProperty('transform',s.transform,'important');
   el.style.setProperty('top',(s.position==='fixed'?(translation?r.top-m.f:parseFloat(s.top)||r.top):el.offsetTop)+'px','important');el.style.setProperty('bottom','auto','important');
  }
  if(el.matches(drawerSelector)||s.position==='fixed'||s.position==='absolute')el.style.setProperty('min-height',r.height+'px','important');
  el.style.setProperty('height','auto','important');el.style.setProperty('max-height','none','important');el.style.setProperty('overflow-y','visible','important');
  if(getComputedStyle(el.parentElement||el).display.includes('flex'))el.style.setProperty('flex-shrink','0','important');
 };
 for(const el of candidates){
  expand(el);let parent=el.parentElement;
  while(parent&&parent!==document.documentElement){
   const s=getComputedStyle(parent);
   if(/hidden|clip|auto|scroll/.test(s.overflowY)||parent.clientHeight<=innerHeight+1||parent.matches(drawerSelector))expand(parent);
   parent=parent.parentElement;
  }
 }
 // Extend full-window backdrops to the revealed panel content, not just the viewport.
 const drawers=Array.from(document.querySelectorAll(drawerSelector)).filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'});
 const pageRect=document.body.getBoundingClientRect(),pageMargin=parseFloat(getComputedStyle(document.body).marginBottom)||0;
 const bottom=Math.ceil(Math.max(pageRect.bottom+scrollY+pageMargin,document.documentElement.scrollHeight,...drawers.map(el=>{let fixed=false;for(let owner=el;owner;owner=owner.parentElement)if(getComputedStyle(owner).position==='fixed'){fixed=true;break}return el.getBoundingClientRect().bottom+(fixed?0:scrollY)})));
 const backdrops=new Set([...expanded,...document.querySelectorAll('.scrim,.backdrop,[class*="-scrim"],[class*="-backdrop"],[data-backdrop]')]);
 for(const el of backdrops){const r=el.getBoundingClientRect(),s=getComputedStyle(el),explicit=el.matches('.scrim,.backdrop,[class*="-scrim"],[class*="-backdrop"],[data-backdrop]');if(drawers.length&&s.position==='fixed'&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.x<=1&&r.y<=1&&r.width>=innerWidth-2&&(explicit||drawers.some(drawer=>el!==drawer&&el.contains(drawer)))){el.style.setProperty('bottom','auto','important');el.style.setProperty('height',Math.max(r.height,bottom-r.top)+'px','important')}}
 return candidates.length;
})()`
