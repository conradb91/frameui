import {object} from '../visual/model'
import type {VisualPage} from '../../shared/types/visualDesign'
import type {PrototypeData,PrototypeFlow} from '../../shared/types/prototype'

/** Canvas documentation, deliberately outside playable flow membership. */
export function flowIntroduction(pages:VisualPage[],flow:PrototypeFlow,index:number):VisualPage {
 const existing=pages.find(p=>p.flowIntroductionFor===flow.id)
 if(existing)return existing
 const start=pages.find(p=>p.id===flow.startArtboardId)
 const wrap=(value:string,width:number)=>value.trim().split(/\s+/).reduce((lines,word)=>{const last=lines.length-1;if(lines[last]&&lines[last].length+word.length+1>width)lines.push(word);else lines[last]+=(lines[last]?' ':'')+word;return lines},['']).join('\n')
 const title=wrap(flow.name,72),description=wrap((flow.description||`Start on ${start?.name||'the entry screen'} and follow the screens to the right.`).slice(0,340),100),titleHeight=title.split('\n').length*45,bodyY=96+titleHeight+32
 const text=(name:string,value:string,y:number,size:number,weight='400')=>object('Text',{name,text:value,x:56,y,width:1328,height:size===32?titleHeight:description.split('\n').length*28+8,fontFamily:'Arial, sans-serif',fontSize:size,fontWeight:weight,lineHeight:Math.round(size*1.4),fill:size===14?'#64748b':'#172b40'})
 return {id:crypto.randomUUID(),flowIntroductionFor:flow.id,name:`Flow ${index+1} · ${flow.name}`,folder:'Flow guides',pinned:false,state:'Flow guide',width:1440,height:Math.max(400,bodyY+description.split('\n').length*28+56),objects:[text('Flow number',`FLOW ${index+1}`,48,14,'700'),text('Flow title',title,96,32,'700'),text('Flow description',description,bodyY,20)]}
}

/** Each journey gets a white guide followed by its screens, without copying shared screens. */
export function layoutFlowGroups(pages:VisualPage[],data:PrototypeData,originX=0,originY=0,only?:ReadonlySet<string>){
 const real=pages.filter(p=>!p.flowIntroductionFor),byId=new Map(real.map(p=>[p.id,p])),placed=new Set(only?real.filter(p=>!only.has(p.id)).map(p=>p.id):[])
 const column=Math.max(1440,...real.map(p=>p.width||1440))+240
 let band=originY
 for(const [index,flow] of data.flows.entries()){
  const available=flow.artboardIds.filter(id=>byId.has(id)&&!placed.has(id))
  if(!available.length)continue
  const guide=flowIntroduction(pages,flow,index),isNew=!pages.includes(guide);if(isNew)pages.push(guide)
  if(isNew||!only||only.has(guide.id)){guide.canvasX=originX;guide.canvasY=band}
  const members=new Set(flow.artboardIds),depth=new Map<string,number>(),queue=[flow.startArtboardId??available[0]];depth.set(queue[0],0)
  while(queue.length){const id=queue.shift()!;for(const edge of data.interactions){if(edge.sourceArtboardId!==id)continue;for(const dest of [edge.destinationId,edge.elseDestinationId])if(dest&&members.has(dest)&&!depth.has(dest)){depth.set(dest,(depth.get(id)??0)+(['open-modal','open-drawer','open-overlay'].includes(edge.action)?0:1));queue.push(dest)}}}
  const firstDepth=Math.min(...available.map(id=>depth.get(id)??0)),bottoms=new Map<number,number>();let bottom=band+guide.height
  for(const id of available){const p=byId.get(id)!,level=Math.max(0,(depth.get(id)??0)-firstDepth),y=bottoms.get(level)??band;p.canvasX=originX+(level+1)*column;p.canvasY=y;bottoms.set(level,y+(p.height||1024)+180);bottom=Math.max(bottom,y+(p.height||1024));placed.add(id)}
  const graphRows=new Map<number,number>()
  for(const id of flow.artboardIds){const p=byId.get(id),level=depth.get(id)??0,row=graphRows.get(level)??0;graphRows.set(level,row+1);if(p&&(!only||only.has(id)))flow.positions[id]={x:level*340,y:row*300}}
  band=bottom+400
 }
 let index=0,rowHeight=0,y=band
 for(const p of real){if(placed.has(p.id))continue;if(index&&index%4===0){y+=rowHeight+180;rowHeight=0}p.canvasX=originX+index%4*column;p.canvasY=y;rowHeight=Math.max(rowHeight,p.height||1024);placed.add(p.id);index++}
}
