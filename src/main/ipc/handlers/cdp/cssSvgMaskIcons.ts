import type {CapturedElement} from '../../../../shared/types/runtimeCapture'
/** Recover monochrome CSS SVG-mask icons, including offscreen pseudo-elements
 * omitted from Chromium's DOMSnapshot layout table. Keep their source vectors. */
export const CSS_SVG_MASK_ICONS_SCRIPT=`(() => {
 const result=[];const tags=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon']);
 const keys=['d','points','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','width','height','viewBox','transform','stroke-linecap','stroke-linejoin','stroke-dasharray','fill-rule','vector-effect'];
 function selector(el){const parts=[];while(el&&el.parentElement&&el!==document.documentElement){parts.unshift(el.tagName.toLowerCase()+':nth-child('+(Array.prototype.indexOf.call(el.parentElement.children,el)+1)+')');el=el.parentElement}return 'html>'+parts.join('>')}
 for(const el of document.querySelectorAll('*')){if(result.length>=2000)break;
  for(const pseudo of [null,'::before','::after']){
   const s=getComputedStyle(el,pseudo);if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0'||(pseudo&&['none','normal'].includes(s.content)))continue;
   const match=/^url\\(["']?(data:image\\/svg\\+xml[^"')]+)["']?\\)$/.exec(s.maskImage);if(!match)continue;
   let xml;try{const comma=match[1].indexOf(',');xml=match[1].slice(0,comma).includes(';base64')?atob(match[1].slice(comma+1)):decodeURIComponent(match[1].slice(comma+1))}catch{continue}
   if(xml.length>100000||/<(?:linearGradient|radialGradient|filter|mask|image|use)\\b/i.test(xml))continue;
   const svg=new DOMParser().parseFromString(xml,'image/svg+xml').documentElement;if(svg.localName!=='svg')continue;
   const owner=el.getBoundingClientRect(),width=pseudo?parseFloat(s.width):owner.width,height=pseudo?parseFloat(s.height):owner.height;if(!width||!height)continue;
   if(pseudo&&s.position!=='absolute'&&(Math.abs(width-owner.width)>1||Math.abs(height-owner.height)>1))continue;
   const paint=s.backgroundColor;if(!paint||paint==='transparent'||paint==='rgba(0, 0, 0, 0)')continue;
   let x=owner.x,y=owner.y;
   if(pseudo&&s.position==='absolute'){x+=s.left.endsWith('px')?parseFloat(s.left):owner.width-(parseFloat(s.right)||0)-width;y+=s.top.endsWith('px')?parseFloat(s.top):owner.height-(parseFloat(s.bottom)||0)-height}
   const nonScaling=/vector-effect\\s*:\\s*non-scaling-stroke/.test(xml);
   function node(e,fill=paint,stroke='none',strokeWidth='1'){
    if(!tags.has(e.localName))return null;fill=(e.getAttribute('fill')||e.style.fill||fill)==='none'?'none':paint;stroke=(e.getAttribute('stroke')||e.style.stroke||stroke)==='none'?'none':paint;strokeWidth=e.getAttribute('stroke-width')||e.style.strokeWidth||strokeWidth;
    const attributes={};for(const key of keys)if(e.hasAttribute(key))attributes[key]=e.getAttribute(key);if(nonScaling)attributes['vector-effect']='non-scaling-stroke';
    return {tag:e.localName,rect:{x,y,width,height},attributes,styles:{display:'block',fill,stroke,strokeWidth,strokeLinecap:e.getAttribute('stroke-linecap')||'round',strokeLinejoin:e.getAttribute('stroke-linejoin')||'round',opacity:'1'},children:Array.from(e.children).map(c=>node(c,fill,stroke,strokeWidth)).filter(Boolean)};
   }
   const captured=node(svg);captured.styles.opacity=pseudo?s.opacity:'1';result.push({selector:selector(el),pseudo:pseudo?.slice(2),node:captured});
  }
 }
 return result;
})()`
export function attachCssSvgMaskIcons(root:CapturedElement,icons:{selector:string;pseudo?:string;node:CapturedElement}[]){
 const bySelector=new Map<string,typeof icons>();for(const icon of icons){const items=bySelector.get(icon.selector)??[];items.push(icon);bySelector.set(icon.selector,items)}
 function walk(el:CapturedElement){
  for(const icon of bySelector.get(el.attributes?.captureSelector??'')??[]){
   if(icon.pseudo){el.children=el.children.filter(n=>n.attributes?.['data-frameui-pseudo']!==icon.pseudo);if(icon.pseudo==='before')el.children.unshift(icon.node);else el.children.push(icon.node)}
   else{el.styles.maskImage='none';el.styles.backgroundColor='transparent';el.children.push(icon.node)}
  }
  el.children.forEach(walk)
 }
 walk(root)
}
