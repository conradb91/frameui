/** Resolve AOS scroll-reveal elements to their authored end state for a full
 * document capture. Scrolling back to the top otherwise resets offscreen
 * images to their hidden/edge-on entrance transforms. Restore the live page. */
export const SETTLE_REVEALS_SCRIPT=`(() => {
 if(window.__frameuiCaptureReveals)return;
 const sheet=document.createElement('style');sheet.textContent='[data-aos]{transition:none!important}';document.head.append(sheet);
 const records=[];
 for(const el of document.querySelectorAll('[data-aos]')){
  const box=el.getBoundingClientRect();if(!box.width||!box.height||getComputedStyle(el).display==='none')continue;
  const hadClass=el.classList.contains('aos-animate'),values={};for(const key of ['transform','opacity','visibility'])values[key]=[el.style.getPropertyValue(key),el.style.getPropertyPriority(key)];
  el.classList.add('aos-animate');const computed=getComputedStyle(el);const final={transform:computed.transform,opacity:computed.opacity,visibility:computed.visibility};
  for(const key of Object.keys(final))el.style.setProperty(key,final[key],'important');records.push({el,hadClass,values});
 }
 window.__frameuiCaptureReveals={sheet,records};
})()`
export const RESTORE_REVEALS_SCRIPT=`(() => {const state=window.__frameuiCaptureReveals;if(!state)return;for(const {el,hadClass,values} of state.records){for(const [key,[value,priority]] of Object.entries(values))value?el.style.setProperty(key,value,priority):el.style.removeProperty(key);el.classList.toggle('aos-animate',hadClass)}state.sheet.remove();delete window.__frameuiCaptureReveals})()`
