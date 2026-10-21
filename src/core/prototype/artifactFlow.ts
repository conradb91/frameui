import {layoutFlowGroups} from './flowIntroductions'
import type { VisualPage } from '../../shared/types/visualDesign'
import type { StructuredNode } from '../../shared/types/structuredDesign'
import type { PrototypeData } from '../../shared/types/prototype'

export interface DetectedTransition {source:string;destination:string;selector:string;label:string;kind?:'tab'}
/** Wire only transitions observed in the actual prototype, using captured DOM identities. */
export function artifactFlow(pages:VisualPage[],transitions:DetectedTransition[],name:string):PrototypeData {
  const now=new Date().toISOString()
  const interactions:PrototypeData['interactions']=[]
  for(const edge of transitions){
    const source=pages.find(p=>p.route===edge.source),destination=pages.find(p=>p.route===edge.destination)
    if(!source?.structured||!destination)continue
    let node:StructuredNode|undefined
    const find=(nodes:StructuredNode[])=>{for(const item of nodes){if(item.source.selector===edge.selector)node=item;find(item.children)}}
    find(source.structured.children)
    if(!node)continue
    const boldLabel=(item:StructuredNode):string|undefined=>{
      if(['b','strong'].includes(item.source.tag??'')&&item.typography?.text)return item.typography.text
      for(const child of item.children){const found=boldLabel(child);if(found)return found}
    }
    const label=(boldLabel(node)||edge.label).replace(/[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/gu,'').replace(/\s+/g,' ').trim()
    interactions.push({id:crypto.randomUUID(),sourceArtboardId:source.id,sourceElementId:node.id,trigger:'click',action:'navigate',destinationId:destination.id,transition:'instant',label:label.slice(0,200)})
  }
  const tabSources=new Set(transitions.filter(e=>e.kind==='tab').flatMap(e=>pages.filter(p=>p.route===e.source).map(p=>p.id)))
  const flows:PrototypeData['flows']=[],covered=new Set<string>()
  const make=(root:string,label:string,destination?:string)=>{
    const barriers=new Set(interactions.filter(e=>!tabSources.has(root)&&e.sourceArtboardId===root).map(e=>e.destinationId).filter((id):id is string=>!!id&&id!==destination))
    const members=new Set<string>([root]),queue=destination?[destination]:[root]
    if(destination)members.add(destination)
    const visited=new Set<string>()
    while(queue.length){const id=queue.shift()!;if(visited.has(id))continue;visited.add(id);for(const edge of interactions){if(edge.sourceArtboardId!==id||!edge.destinationId||edge.destinationId===root||barriers.has(edge.destinationId))continue;members.add(edge.destinationId);queue.push(edge.destinationId)}}
    const start=pages.find(p=>p.id===root)
    const description=destination?`Start on ${start?.name||'the entry screen'}. Select “${label}”, then follow the screens to the right.`:'Follow the captured screens from left to right.'
    flows.push({id:crypto.randomUUID(),name:label.slice(0,200)||name.slice(0,200),description,startArtboardId:root,artboardIds:[...members],positions:{},createdAt:now,updatedAt:now})
    members.forEach(id=>covered.add(id))
  }
  for(const page of [...pages]){
    if(covered.has(page.id))continue
    const outgoing=interactions.filter(edge=>edge.sourceArtboardId===page.id&&edge.destinationId&&edge.destinationId!==page.id)
    const destinations=new Set<string>()
    if(tabSources.has(page.id)){make(page.id,'Tabs · '+page.name);continue}
    if(outgoing.length){for(const edge of outgoing){if(destinations.has(edge.destinationId!))continue;destinations.add(edge.destinationId!);make(page.id,edge.label||pages.find(p=>p.id===edge.destinationId)?.name||'Continue',edge.destinationId)}}
    else make(page.id,page.name||name)
  }
  const result:PrototypeData={version:1,flows,interactions,variables:{},scenarios:[],imports:[]}
  layoutFlowGroups(pages,result)
  return result
}
