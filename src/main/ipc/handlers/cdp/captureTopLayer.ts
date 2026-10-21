import type {CapturedElement} from '@shared/types/runtimeCapture'
export const TOP_LAYER_SCRIPT=`(() => Array.from(document.querySelectorAll('dialog:modal')).map(el=>{
 const path=[];for(let c=el;c&&c.parentElement&&c!==document.documentElement;c=c.parentElement)path.unshift(c.tagName.toLowerCase()+':nth-child('+(Array.prototype.indexOf.call(c.parentElement.children,c)+1)+')');
 const s=getComputedStyle(el,'::backdrop');
 return {selector:'html>'+path.join('>'),styles:{backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage,backdropFilter:s.backdropFilter,opacity:s.opacity},rect:{x:0,y:0,width:innerWidth,height:innerHeight}};
}))()`
export function attachTopLayer(root:CapturedElement,layers:{selector:string;styles:Record<string,string>;rect:CapturedElement['rect']}[]){
 for(const [index,layer] of layers.entries()){
  const detach=(owner:CapturedElement):CapturedElement|undefined=>{
   const i=owner.children.findIndex(c=>c.attributes?.captureSelector===layer.selector)
   if(i>=0)return owner.children.splice(i,1)[0]
   for(const child of owner.children){const found=detach(child);if(found)return found}
  }
  const dialog=detach(root);if(!dialog)continue
  root.children.push({tag:'frameui-visual',attributes:{'data-frameui-pseudo':'backdrop'},rect:layer.rect,styles:{...layer.styles,position:'fixed',zIndex:String(2147483600+index*2)},children:[]})
  dialog.styles={...dialog.styles,zIndex:String(2147483601+index*2)}
  root.children.push(dialog)
 }
}
