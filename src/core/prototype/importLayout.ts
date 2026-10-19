import type {VisualDocument} from '@shared/types/visualDesign'
/** Arrange newly imported native screens by journey depth; never move existing canvas work. */
export function arrangeImportedScreens(current:VisualDocument,next:VisualDocument){
 const added=new Set(next.pages.filter(p=>!current.pages.some(c=>c.id===p.id)).map(p=>p.id));if(!added.size)return
 let fallbackX=0,fallbackY=0,rowHeight=0,right=0
 current.pages.forEach((p,i)=>{if(i>0&&i%2===0){fallbackX=0;fallbackY+=rowHeight+160;rowHeight=0}right=Math.max(right,(p.canvasX??fallbackX)+p.width);fallbackX+=p.width+160;rowHeight=Math.max(rowHeight,p.height)})
 const origin=right+200,cellWidth=Math.max(...next.pages.filter(p=>added.has(p.id)).map(p=>p.width))+160,cellHeight=Math.max(...next.pages.filter(p=>added.has(p.id)).map(p=>p.height))+180
 let band=0;const placed=new Set<string>(),links=next.prototype?.interactions??[]
 for(const flow of next.prototype?.flows??[]){
  if(!flow.artboardIds.some(id=>added.has(id)&&!placed.has(id)))continue
  const members=new Set(flow.artboardIds),levels=new Map<string,number>(),queue=[flow.startArtboardId??flow.artboardIds[0]]
  if(queue[0])levels.set(queue[0],0)
  while(queue.length){const id=queue.shift();if(!id)continue;for(const i of links.filter(i=>i.sourceArtboardId===id)){for(const dest of [i.destinationId,i.elseDestinationId]){if(!dest||!members.has(dest)||levels.has(dest))continue;levels.set(dest,(levels.get(id)??0)+(['open-modal','open-drawer','open-overlay'].includes(i.action)?0:1));queue.push(dest)}}}
  for(const id of flow.artboardIds)if(!levels.has(id))levels.set(id,0)
  const rows=new Map<number,number>();let maxRows=1
  for(const id of flow.artboardIds){const level=levels.get(id)??0,row=rows.get(level)??0;rows.set(level,row+1);maxRows=Math.max(maxRows,row+1)
   if(!flow.positions[id])flow.positions[id]={x:level*340,y:row*300}
   if(!added.has(id)||placed.has(id))continue;const p=next.pages.find(p=>p.id===id);if(!p)continue;p.canvasX=origin+level*cellWidth;p.canvasY=band+row*cellHeight;placed.add(id)
  }
  band+=maxRows*cellHeight+160
 }
 let index=0;for(const p of next.pages){if(!added.has(p.id)||placed.has(p.id))continue;p.canvasX=origin+(index%2)*cellWidth;p.canvasY=band+Math.floor(index/2)*cellHeight;index++}
}
