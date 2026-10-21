import {DEEP_DOM_HELPERS} from '../../../artifacts/prototypePageScripts'
import type {CapturedElement} from '@shared/types/runtimeCapture'
export const TOP_LAYER_SCRIPT=`(() => {
 ${DEEP_DOM_HELPERS}
 return all.filter(el=>el.matches('dialog:modal')).map(el=>{const view=el.ownerDocument.defaultView,s=view.getComputedStyle(el,'::backdrop');let x=0,y=0,current=view;while(current.frameElement){const frame=current.frameElement,r=frame.getBoundingClientRect();x+=r.x+frame.clientLeft;y+=r.y+frame.clientTop;current=frame.ownerDocument.defaultView}return {selector:selector(el),styles:{backgroundColor:s.backgroundColor,backgroundImage:s.backgroundImage,backdropFilter:s.backdropFilter,opacity:s.opacity},rect:{x,y,width:view.innerWidth,height:view.innerHeight}}});
})()`

export function attachTopLayer(root:CapturedElement,layers:{selector:string;styles:Record<string,string>;rect:CapturedElement['rect']}[]){
 for(const [index,layer] of layers.entries()){
  const detach=(owner:CapturedElement):CapturedElement|undefined=>{
   const i=owner.children.findIndex(c=>c.attributes?.captureSelector===layer.selector)
   if(i>=0)return owner.children.splice(i,1)[0]
   for(const child of owner.children){const found=detach(child);if(found)return found}
  }
  let owner=root;const framePath=layer.selector.split(' ||| ').slice(0,-1).join(' ||| ');if(framePath){const find=(node:CapturedElement):CapturedElement|undefined=>node.attributes?.captureSelector===framePath?node:node.children.map(find).find(Boolean);owner=find(root)??root}
  const dialog=detach(owner);if(!dialog)continue
  owner.children.push({tag:'frameui-visual',attributes:{'data-frameui-pseudo':'backdrop'},rect:layer.rect,styles:{...layer.styles,position:'fixed',zIndex:String(2147483600+index*2)},children:[]})
  dialog.styles={...dialog.styles,zIndex:String(2147483601+index*2)}
  owner.children.push(dialog)
 }
}
