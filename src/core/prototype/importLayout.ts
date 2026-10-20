import {layoutFlowGroups} from './flowIntroductions'
import type {VisualDocument} from '@shared/types/visualDesign'
/** Arrange newly imported native screens by journey depth; never move existing canvas work. */
export function arrangeImportedScreens(current:VisualDocument,next:VisualDocument){
 const added=new Set(next.pages.filter(p=>!current.pages.some(c=>c.id===p.id)).map(p=>p.id));if(!added.size)return
 let fallbackX=0,rowHeight=0,right=0
 current.pages.forEach((p,i)=>{if(i>0&&i%2===0){fallbackX=0;rowHeight=0}right=Math.max(right,(p.canvasX??fallbackX)+p.width);fallbackX+=p.width+160;rowHeight=Math.max(rowHeight,p.height)})
 const origin=right+200
 layoutFlowGroups(next.pages,next.prototype??{version:1,flows:[],interactions:[],variables:{},scenarios:[],imports:[]},origin,0,added)
}
