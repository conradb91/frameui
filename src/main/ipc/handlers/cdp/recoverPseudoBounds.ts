import type { CapturedElement } from '@shared/types/runtimeCapture'

/** Chromium sometimes emits a painted flex pseudo-element with a zero DOMSnapshot
 * box. Measure a temporary equivalent flex child; restore the live DOM before
 * taking the reference image. Computed colours, borders and transforms stay intact. */
export async function recoverPseudoBounds(root: CapturedElement, execute: (script: string) => Promise<unknown>): Promise<void> {
  const requests: { selector: string; pseudo: string; node: CapturedElement }[] = []
  function visit(owner: CapturedElement) {
    for (const node of owner.children) {
      const pseudo = node.attributes?.['data-frameui-pseudo']
      if (owner.attributes?.captureSelector && ['before', 'after'].includes(pseudo ?? '') && (!node.rect.width || !node.rect.height) && parseFloat(node.styles.width) > 0 && parseFloat(node.styles.height) > 0)
        requests.push({ selector: owner.attributes.captureSelector, pseudo: pseudo!, node })
      visit(node)
    }
  }
  visit(root)
  if (!requests.length) return
  const measured = await execute(`(() => {
    const requests=${JSON.stringify(requests.map(({ selector, pseudo }) => ({ selector, pseudo })))},records=[],owners=new Map(),sheet=document.createElement('style');
    sheet.textContent='[data-frameui-measuring-pseudo]::before,[data-frameui-measuring-pseudo]::after{display:none!important}';
    try {
      for(const [index,request] of requests.entries()){
        const owner=document.querySelector(request.selector);if(!owner)continue;
        const s=getComputedStyle(owner,'::'+request.pseudo),clone=document.createElement('span');
        for(const key of s)clone.style.setProperty(key,s.getPropertyValue(key),'important');
        clone.style.setProperty('transition','none','important');clone.style.setProperty('animation','none','important');
        if(!owners.has(owner))owners.set(owner,owner.getAttribute('data-frameui-measuring-pseudo'));
        records.push({index,owner,clone,pseudo:request.pseudo});
      }
      document.head.append(sheet);
      for(const owner of owners.keys())owner.setAttribute('data-frameui-measuring-pseudo','');
      for(const record of records)record.pseudo==='before'?record.owner.prepend(record.clone):record.owner.append(record.clone);
      return records.map(({index,clone})=>{const r=clone.getBoundingClientRect();return {index,x:r.x,y:r.y,width:r.width,height:r.height}});
    } finally {
      for(const {clone} of records)clone.remove();
      for(const [owner,value] of owners)value===null?owner.removeAttribute('data-frameui-measuring-pseudo'):owner.setAttribute('data-frameui-measuring-pseudo',value);
      sheet.remove();
    }
  })()`) as ({ index: number } & CapturedElement['rect'])[]
  for (const { index, ...rect } of measured) if (rect.width > 0 && rect.height > 0) requests[index].node.rect = rect
}
