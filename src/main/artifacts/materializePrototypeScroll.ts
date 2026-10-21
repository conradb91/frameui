import {CAPTURED_STYLE_PROPERTIES} from '../../shared/captureStyleProperties'
import {DEEP_DOM_HELPERS} from './prototypePageScripts'
/** Capture-only harvesting. The scroll viewport is never resized. Replayed source pages remain untouched. */
export const MATERIALIZE_SCROLL_SCRIPT=`(async()=>{
 ${DEEP_DOM_HELPERS}
 const warnings=[],regions=[],deadline=Date.now()+6000;
 const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
 const clone=(row)=>{const copy=row.cloneNode(true),originals=[row,...row.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];for(let i=0;i<originals.length;i++){const style=originals[i].ownerDocument.defaultView.getComputedStyle(originals[i]);for(const key of ${JSON.stringify(CAPTURED_STYLE_PROPERTIES)}){try{copies[i].style[key]=style[key]}catch{}}for(const attr of Array.from(copies[i].attributes)){if(attr.name.startsWith('on')||attr.name==='data-frameui-selector')copies[i].removeAttribute(attr.name)}}return copy};
 for(const region of all){
  const style=styleOf(region);if(!/auto|scroll/.test(style.overflowY)||region.scrollHeight<=region.clientHeight+4||region.clientHeight<30)continue;
  const initial=Array.from(region.querySelectorAll('tbody tr,[role="rowgroup"] [role="row"]')).filter(row=>!row.querySelector('th,[role="columnheader"]'));
  if(!initial.length||initial.reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)>=region.scrollHeight-64)continue;
  const body=initial[0].parentElement;if(!initial.every(row=>row.parentElement===body))continue;
  const top=region.scrollTop,left=region.scrollLeft,bodyOrigin=body.getBoundingClientRect().top-region.getBoundingClientRect().top+top;
  const found=new Map();let lastTop=-1,repeats=0,steps=0,maxHeight=region.scrollHeight;
  const collect=()=>{for(const row of body.children){if(!row.matches('tr,[role="row"]'))continue;const r=row.getBoundingClientRect(),box=region.getBoundingClientRect(),y=r.top-box.top+region.scrollTop-bodyOrigin;if(!r.width||!r.height)continue;const identity=row.getAttribute('data-row-key')||row.getAttribute('data-id')||row.getAttribute('aria-rowindex')||Math.round(y)+':'+row.textContent.trim();if(!found.has(identity))found.set(identity,{copy:clone(row),y,width:r.width,height:r.height})}};
  collect();const initialCount=found.size;
  region.scrollTo({top:0,left,behavior:'instant'});await pause();collect();
  try{
   while(Date.now()<deadline&&steps++<160&&found.size<2000){
    const before=found.size,max=region.scrollHeight-region.clientHeight,next=Math.min(max,region.scrollTop+Math.max(40,region.clientHeight*.8));
    if(next<=lastTop+1)break;lastTop=next;region.scrollTo({top:next,left,behavior:'instant'});await pause();collect();maxHeight=Math.max(maxHeight,region.scrollHeight);
    repeats=found.size===before?repeats+1:0;
    if(repeats>=2&&found.size===initialCount)break;
   }
  }finally{region.scrollTo({top,left,behavior:'instant'});await pause()}
  // A normal table already contains every row. Retain its DOM and layout unchanged.
  if(found.size>initialCount){
   const replacement=body.cloneNode(false);replacement.style.position='relative';replacement.style.display='block';replacement.style.transform='none';replacement.style.height=Math.max(maxHeight-bodyOrigin,...Array.from(found.values(),item=>item.y+item.height))+'px';
   for(const item of [...found.values()].sort((a,b)=>a.y-b.y)){Object.assign(item.copy.style,{position:'absolute',display:item.copy.tagName==='TR'?'table':item.copy.style.display,tableLayout:'fixed',left:'0px',top:item.y+'px',width:item.width+'px',height:item.height+'px',transform:'none',margin:'0',boxSizing:'border-box'});replacement.append(item.copy)}
   body.replaceWith(replacement);region.setAttribute('data-frameui-materialized','true');regions.push({rows:found.size,complete:Date.now()<deadline&&steps<160&&found.size<2000});
   warnings.push('Virtualized table materialized as '+found.size+' editable rows'+(regions.at(-1).complete?'.':' · collection limit reached; further rows may require another capture.'));
  }
 }
 return {warnings,regions};
})()`
