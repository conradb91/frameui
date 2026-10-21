import {object} from '../visual/model'
import type {VisualPage} from '../../shared/types/visualDesign'
import type {PrototypeData,PrototypeFlow} from '../../shared/types/prototype'

/** Describe only observed interactions; a branch is not an invented linear journey. */
export function flowSteps(pages: VisualPage[], flow: PrototypeFlow, data?: PrototypeData): string[] {
 const byId = new Map(pages.map(p => [p.id, p])), members = new Set(flow.artboardIds)
 const edges = (data?.interactions ?? []).filter(e => members.has(e.sourceArtboardId) && (!e.destinationId || members.has(e.destinationId)))
 const visited = new Set<string>(), queue = [flow.startArtboardId ?? flow.artboardIds[0]], result: string[] = []
 while (queue.length) {
  const id = queue.shift()!; if (visited.has(id)) continue; visited.add(id)
  for (const edge of edges.filter(e => e.sourceArtboardId === id)) {
   const source = byId.get(id)?.name ?? 'the source screen', destination = edge.destinationId && byId.get(edge.destinationId)?.name
   const label = edge.label?.trim() || (edge.sourceElementId ? byId.get(id)?.objects.find(o => o.id === edge.sourceElementId)?.name : undefined)
   const control = label ? `“${label}”` : 'the linked control (no captured label)'
   const verb = ({click:'Select',doubleclick:'Double-click',hover:'Hover over',submit:'Submit',change:'Change',key:'Press',timer:'Wait for',swipe:'Swipe on'} as const)[edge.trigger]
   const outcome = destination ? `${['open-modal','open-drawer','open-overlay'].includes(edge.action) ? 'open' : 'show'} “${destination}”` : ({back:'return to the previous screen','close-modal':'close the modal','close-drawer':'close the drawer','close-overlay':'close the overlay',external:'open the external link',show:'show the linked element',hide:'hide the linked element',scroll:'scroll to the linked section'} as Record<string,string>)[edge.action] ?? `run the ${edge.action} action`
   result.push(`On “${source}”: ${verb} ${control} → ${outcome}.`)
   if (edge.destinationId && !visited.has(edge.destinationId)) queue.push(edge.destinationId)
   if (edge.elseDestinationId && members.has(edge.elseDestinationId)) {
    result.push(`Otherwise, show “${byId.get(edge.elseDestinationId)?.name ?? edge.elseDestinationId}”.`)
    queue.push(edge.elseDestinationId)
   }
  }
 }
 return result
}

/** Canvas documentation, deliberately outside playable flow membership. */
export function flowIntroduction(pages:VisualPage[],flow:PrototypeFlow,index:number,data?:PrototypeData):VisualPage {
 const existing=pages.find(p=>p.flowIntroductionFor===flow.id)
 if(existing)return existing
 const start=pages.find(p=>p.id===flow.startArtboardId)
 const wrap=(value:string,width:number)=>value.trim().split(/\s+/).reduce((lines,word)=>{const last=lines.length-1;if(lines[last]&&lines[last].length+word.length+1>width)lines.push(word);else lines[last]+=(lines[last]?' ':'')+word;return lines},['']).join('\n')
 const objects: VisualPage['objects']=[]
 let y=48
 const text=(name:string,value:string,size:number,weight='400',color='#172b40')=>{
  const content=wrap(value,size===32?60:96),height=content.split('\n').length*Math.round(size*1.5)
  objects.push(object('Text',{name,text:content,x:56,y,width:1328,height,fontFamily:'Arial, sans-serif',fontSize:size,fontWeight:weight,lineHeight:Math.round(size*1.5),fill:color}));y+=height+24
 }
 text('Flow number',`FLOW ${index+1}`,14,'700','#64748b')
 text('Flow title',flow.name,32,'700')
 text('Flow description',`Start on “${start?.name||'the entry screen'}”. Follow the labelled actions below.`,20)
 const steps=[...new Set(flowSteps(pages,flow,data).map(step=>step.replace(/^On “[^”]*”: /,'')))]
 if(steps.length) steps.forEach((step,i)=>text(`Step ${i+1}`,`${i+1}. ${step}`,20))
 else text('Flow notes',flow.description||'No linked actions were captured for this screen. Explore it in the prototype to capture further states.',20)
 return {id:crypto.randomUUID(),flowIntroductionFor:flow.id,name:`Flow ${index+1} · ${flow.name}`,folder:'Flow guides',pinned:false,state:'Flow guide',width:1440,height:Math.max(400,y+32),objects}
}

/** Upgrade only untouched legacy generated guides, preserving all actual screen positions. */
export function upgradeFlowGuides(pages:VisualPage[],data:PrototypeData):VisualPage[] {
 const normal=(s:string)=>s.replace(/\s+/g,' ').trim()
 let result=pages
 for(const [index,flow] of data.flows.entries()){
  const old=result.find(p=>p.flowIntroductionFor===flow.id)
  const start=pages.find(p=>p.id===flow.startArtboardId)
  const legacyDescription=(flow.description||`Start on ${start?.name||'the entry screen'} and follow the screens to the right.`).slice(0,340)
  if(!old||old.objects.length!==3||old.objects.map(o=>o.name).join('|')!=='Flow number|Flow title|Flow description'||normal(old.objects[1].text??'')!==normal(flow.name)||normal(old.objects[2].text??'')!==normal(legacyDescription))continue
  const fresh=flowIntroduction(result.filter(p=>p.id!==old.id),flow,index,data)
  const next={...old,objects:fresh.objects,height:fresh.height}
  const overlap=(p:VisualPage)=>p.id!==old.id&&(next.canvasX??0)<(p.canvasX??0)+p.width&&(next.canvasX??0)+next.width>(p.canvasX??0)&&(next.canvasY??0)<(p.canvasY??0)+p.height&&(next.canvasY??0)+next.height>(p.canvasY??0)
  // If the longer explanation reaches another frame, move the guide above the composition.
  if(result.some(overlap))next.canvasY=Math.min(...result.map(p=>p.canvasY??0))-next.height-240
  result=result.map(p=>p.id===old.id?next:p)
 }
 return result
}

/** Each journey gets a white guide followed by its screens, without copying shared screens. */
export function layoutFlowGroups(pages:VisualPage[],data:PrototypeData,originX=0,originY=0,only?:ReadonlySet<string>){
 const real=pages.filter(p=>!p.flowIntroductionFor),byId=new Map(real.map(p=>[p.id,p])),placed=new Set(only?real.filter(p=>!only.has(p.id)).map(p=>p.id):[])
 const column=Math.max(1440,...real.map(p=>p.width||1440))+240
 let band=originY
 for(const [index,flow] of data.flows.entries()){
  const available=flow.artboardIds.filter(id=>byId.has(id)&&!placed.has(id))
  if(!available.length)continue
  const guide=flowIntroduction(pages,flow,index,data),isNew=!pages.includes(guide);if(isNew)pages.push(guide)
  if(isNew||!only||only.has(guide.id)){guide.canvasX=originX;guide.canvasY=band}
  const members=new Set(flow.artboardIds),depth=new Map<string,number>(),queue=[flow.startArtboardId??available[0]];depth.set(queue[0],0)
  while(queue.length){const id=queue.shift()!;for(const edge of data.interactions){if(edge.sourceArtboardId!==id)continue;for(const dest of [edge.destinationId,edge.elseDestinationId])if(dest&&members.has(dest)&&!depth.has(dest)){depth.set(dest,(depth.get(id)??0)+(['open-modal','open-drawer','open-overlay'].includes(edge.action)?0:1));queue.push(dest)}}}
  const firstDepth=Math.min(...available.map(id=>depth.get(id)??0)),bottoms=new Map<number,number>();let bottom=band+guide.height
  for(const id of available){const p=byId.get(id)!,level=flow.name.startsWith('Tabs · ')?available.indexOf(id):Math.max(0,(depth.get(id)??0)-firstDepth),y=bottoms.get(level)??band;p.canvasX=originX+(level+1)*column;p.canvasY=y;bottoms.set(level,y+(p.height||1024)+180);bottom=Math.max(bottom,y+(p.height||1024));placed.add(id)}
  const graphRows=new Map<number,number>()
  for(const id of flow.artboardIds){const p=byId.get(id),level=depth.get(id)??0,row=graphRows.get(level)??0;graphRows.set(level,row+1);if(p&&(!only||only.has(id)))flow.positions[id]={x:level*340,y:row*300}}
  band=bottom+400
 }
 let index=0,rowHeight=0,y=band
 for(const p of real){if(placed.has(p.id))continue;if(index&&index%4===0){y+=rowHeight+180;rowHeight=0}p.canvasX=originX+index%4*column;p.canvasY=y;rowHeight=Math.max(rowHeight,p.height||1024);placed.add(p.id);index++}
}
