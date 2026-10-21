import {MATERIALIZE_SCROLL_SCRIPT} from '../../../artifacts/materializePrototypeScroll'
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
/** Load offscreen images without resizing scroll containers or their ancestors.
 * Chromium's DOM snapshot retains laid-out overflow children; native clipping
 * hides them until the designer ungroups the container.
 */
export const PREPARE_ARTIFACT_CONTENT_SCRIPT=`(async () => {
 const images=Array.from(document.images).filter(img=>img.getClientRects().length);
 for(const img of images){img.loading='eager';img.decoding='sync'}
 await Promise.race([
  Promise.allSettled(images.map(img=>img.decode())),
  new Promise(resolve=>setTimeout(resolve,1500))
 ]);
 const result=await ${MATERIALIZE_SCROLL_SCRIPT};return result;
})()`
