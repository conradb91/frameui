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
 const start=pages.find(p=>p.id===flow.startArtboardId),width=Math.max(390,Math.min(1440,start?.width??1440)),objects:VisualPage['objects']=[]
 let y=20
 const add=(name:string,value:string,size:number,weight='400',maxLines=2)=>{
  const capacity=Math.max(20,Math.floor((width-56)/(size*.58))),words=value.split(/\s+/),lines=['']
  for(const word of words){const last=lines.length-1;if(lines[last]&&lines[last].length+word.length+1>capacity)lines.push(word);else lines[last]+=(lines[last]?' ':'')+word}
  const content=lines.slice(0,maxLines).map(line=>line.length>capacity?line.slice(0,capacity-1)+'…':line).join('\n')+(lines.length>maxLines?'…':''),height=content.split('\n').length*size*1.5
  objects.push(object('Text',{name,text:content,x:28,y,width:width-56,height,fontFamily:'Arial, sans-serif',fontSize:size,fontWeight:weight,lineHeight:size*1.5,fill:'#172b40'}));y+=height+10
 }
 add('Flow number',`FLOW ${index+1} · ${flow.artboardIds.length} views`,12,'700',1)
 add('Flow title',flow.name,24,'700')
 const steps=flowSteps(pages,flow,data),first=steps[0]?.replace(/^On “[^”]*”: /,'')
 add('Flow description',first||flow.description||`Start on ${start?.name??'the first screen'}.`,14)
 add('Flow notes',`${steps.length} observed actions · Follow the labelled connections.`,12,'400',2)
 return {id:crypto.randomUUID(),flowIntroductionFor:flow.id,name:`Flow ${index+1} · ${flow.name}`,folder:'Flow guides',pinned:false,state:'Flow guide',width,height:Math.max(176,y+10),objects}

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

/** One compact header per journey. Branch columns and tab lanes use actual screen heights. */
export function layoutFlowGroups(pages:VisualPage[],data:PrototypeData,originX=0,originY=0,only?:ReadonlySet<string>){
 const real=pages.filter(p=>!p.flowIntroductionFor),byId=new Map(real.map(p=>[p.id,p])),placed=new Set(only?real.filter(p=>!only.has(p.id)).map(p=>p.id):[])
 const column=Math.max(390,...real.map(p=>p.width||1440))+200
 let band=originY
 for(const [index,flow] of data.flows.entries()){
  const available=flow.artboardIds.filter(id=>byId.has(id)&&!placed.has(id));if(!available.length)continue
  const guide=flowIntroduction(pages,flow,index,data);if(!pages.includes(guide))pages.push(guide)
  if(!only||!pages.includes(guide)||guide.canvasX===undefined){guide.canvasX=originX;guide.canvasY=band}
  const members=new Set(flow.artboardIds),root=flow.startArtboardId??available[0],depth=new Map([[root,0]]),queue=[root]
  const links=data.interactions.filter(e=>members.has(e.sourceArtboardId)&&[e.destinationId,e.elseDestinationId].some(id=>id&&members.has(id)))
  while(queue.length){const id=queue.shift()!;for(const edge of links)if(edge.sourceArtboardId===id)for(const destination of [edge.destinationId,edge.elseDestinationId])if(destination&&members.has(destination)&&!depth.has(destination)){depth.set(destination,depth.get(id)!+(!edge.capturedView&&['open-modal','open-drawer','open-overlay'].includes(edge.action)?0:1));queue.push(destination)}}
  const tabRoots=[root,...new Set(links.filter(e=>e.kind==='tab'&&e.destinationId!==root).map(e=>e.destinationId!))],owner=new Map<string,string>()
  if(flow.kind==='tabs'){
   for(const tab of tabRoots)owner.set(tab,tab)
   for(const tab of tabRoots){const pending=[tab];while(pending.length){const id=pending.shift()!;for(const edge of links)if(edge.sourceArtboardId===id&&edge.kind!=='tab'&&edge.destinationId&&!owner.has(edge.destinationId)){owner.set(edge.destinationId,tab);pending.push(edge.destinationId)}}}
  }
  const offsets=new Map<number,number>(),rows=new Map<number,number>(),screenTop=band+guide.height+80;let bottom=screenTop
  const ordered=[...available].sort((a,b)=>flow.kind==='tabs'?Number(!tabRoots.includes(a))-Number(!tabRoots.includes(b))||(depth.get(a)??0)-(depth.get(b)??0):(depth.get(a)??0)-(depth.get(b)??0))
  for(const id of ordered){const p=byId.get(id)!,level=flow.kind==='tabs'?Math.max(0,tabRoots.indexOf(owner.get(id)??root)):depth.get(id)??0,y=offsets.get(level)??screenTop,row=rows.get(level)??0;p.canvasX=originX+level*column;p.canvasY=y;offsets.set(level,y+p.height+140);rows.set(level,row+1);bottom=Math.max(bottom,y+p.height);placed.add(id);flow.positions[id]={x:level*340,y:row*300}}
  band=bottom+280
 }
 let index=0,rowHeight=0,y=band
 for(const p of real){if(placed.has(p.id))continue;if(index&&index%4===0){y+=rowHeight+140;rowHeight=0}p.canvasX=originX+index%4*column;p.canvasY=y;rowHeight=Math.max(rowHeight,p.height||1024);placed.add(p.id);index++}
}
