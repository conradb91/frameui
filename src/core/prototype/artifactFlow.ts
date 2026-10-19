import {layoutArtifactScreens} from './artifactLayout'
import type { VisualPage } from '../../shared/types/visualDesign'
import type { StructuredNode } from '../../shared/types/structuredDesign'
import type { PrototypeData } from '../../shared/types/prototype'

export interface DetectedTransition {source:string;destination:string;selector:string;label:string}
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
    interactions.push({id:crypto.randomUUID(),sourceArtboardId:source.id,sourceElementId:node.id,trigger:'click',action:'navigate',destinationId:destination.id,transition:'instant',label:edge.label.slice(0,200)})
  }
  const result:PrototypeData={version:1,flows:pages.length?[{id:crypto.randomUUID(),name:name.slice(0,200),description:'Imported from the runnable HTML prototype. Connections reflect observed navigation and visible state changes.',startArtboardId:pages[0].id,artboardIds:pages.map(p=>p.id),positions:Object.fromEntries(pages.map((p,i)=>[p.id,{x:(i%4)*360,y:Math.floor(i/4)*300}])),createdAt:now,updatedAt:now}]:[],interactions,variables:{},scenarios:[],imports:[]}
  layoutArtifactScreens(pages,result)
  return result
}
