/** Preserve natural document height, including overflow, without padding short pages to the viewport. */
export const CONTENT_METRICS_SCRIPT=`(() => {
 const body=document.body,rect=body.getBoundingClientRect(),style=getComputedStyle(body);
 const viewport=innerHeight,scroll=document.scrollingElement;
 let height=rect.bottom+scrollY+(parseFloat(style.marginBottom)||0);
 if(scroll.scrollHeight>viewport+1)height=Math.max(height,scroll.scrollHeight);
 for(const el of document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true],[data-drawer],[popover]:popover-open')){const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden')height=Math.max(height,r.bottom+scrollY)}
 return {width:rect.width,height:Math.max(1,Math.ceil(height))};
})()`
/** Expand large application scroll panels for full-page artifact capture; never small widgets. */
export const EXPAND_ARTIFACT_PANELS_SCRIPT=`(() => {
 const candidates=Array.from(document.querySelectorAll('main,section,article,div')).filter(el=>{
 const r=el.getBoundingClientRect(),s=getComputedStyle(el);
 return r.width>=innerWidth*.4&&r.height>=200&&el.scrollHeight>el.clientHeight+2&&/auto|scroll/.test(s.overflowY);
 });
 for(const el of candidates){
  el.style.setProperty('height','auto','important');el.style.setProperty('max-height','none','important');el.style.setProperty('overflow-y','visible','important');
  let parent=el.parentElement;
  while(parent&&parent!==document.documentElement){
   const s=getComputedStyle(parent);
   if(/hidden|clip|auto|scroll/.test(s.overflowY)||parent.clientHeight<=innerHeight+1){parent.style.setProperty('height','auto','important');parent.style.setProperty('max-height','none','important');parent.style.setProperty('overflow-y','visible','important')}
   parent=parent.parentElement;
  }
 }
 return candidates.length;
})()`
