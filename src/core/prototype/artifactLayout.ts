import type {VisualPage} from '../../shared/types/visualDesign'
import type {PrototypeData} from '../../shared/types/prototype'

/** Lay out observed journeys left-to-right. Unlinked screens get their own compact grid. */
export function layoutArtifactScreens(pages:VisualPage[],data:PrototypeData){
 const byId=new Map(pages.map(p=>[p.id,p])),links=data.interactions.filter(e=>e.destinationId&&byId.has(e.sourceArtboardId)&&byId.has(e.destinationId))
 const neighbors=new Map<string,Set<string>>()
 for(const e of links){if(e.sourceArtboardId===e.destinationId)continue;for(const [a,b] of [[e.sourceArtboardId,e.destinationId!],[e.destinationId!,e.sourceArtboardId]]){if(!neighbors.has(a))neighbors.set(a,new Set());neighbors.get(a)!.add(b)}}
 const placed=new Set<string>(),positions:Record<string,{x:number;y:number}>={}
 const columnWidth=Math.max(1,...pages.map(p=>p.width))+240
 let band=0,graphBand=0
 for(const first of pages){
  if(placed.has(first.id)||!neighbors.has(first.id))continue
  const members=new Set<string>(),queue=[first.id]
  while(queue.length){const id=queue.shift()!;if(members.has(id))continue;members.add(id);for(const other of neighbors.get(id)??[])queue.push(other)}
  const root=[...members].find(id=>!links.some(e=>e.destinationId===id&&e.sourceArtboardId!==id))??first.id
  const depth=new Map([[root,0]]),pending=[root]
  while(pending.length){const id=pending.shift()!;for(const e of links){if(e.sourceArtboardId!==id||!e.destinationId||depth.has(e.destinationId))continue;depth.set(e.destinationId,depth.get(id)!+1);pending.push(e.destinationId)}}
  const offsets=new Map<number,number>(),rows=new Map<number,number>();let bottom=band,maxRows=0
  for(const p of pages){if(!members.has(p.id))continue;const level=depth.get(p.id)??0,y=offsets.get(level)??band,row=rows.get(level)??0;p.canvasX=level*columnWidth;p.canvasY=y;offsets.set(level,y+p.height+180);rows.set(level,row+1);positions[p.id]={x:level*340,y:graphBand+row*280};bottom=Math.max(bottom,y+p.height);maxRows=Math.max(maxRows,row+1);placed.add(p.id)}
  band=bottom+320;graphBand+=maxRows*280+100
 }
 const unlinked=pages.filter(p=>!placed.has(p.id));let rowHeight=0,y=band
 unlinked.forEach((p,i)=>{if(i>0&&i%4===0){y+=rowHeight+180;rowHeight=0}p.canvasX=i%4*columnWidth;p.canvasY=y;rowHeight=Math.max(rowHeight,p.height);positions[p.id]={x:i%4*340,y:graphBand+Math.floor(i/4)*280}})
 for(const flow of data.flows)for(const id of flow.artboardIds)if(positions[id])flow.positions[id]=positions[id]
}
