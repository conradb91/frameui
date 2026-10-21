import type {VisualDocument,VisualPage,VisualObject} from '../../shared/types/visualDesign'
import type {StructuredNode} from '../../shared/types/structuredDesign'
import {layoutFlowGroups} from './flowIntroductions'
/** Migrate captured legacy journeys once. User-authored shared flows keep their deliberate membership. */
export function isolateImportedFlows(document:VisualDocument):VisualDocument{
 const data=document.prototype;if(!data||!document.pages.some(p=>p.artifactSource))return document
 const counts=new Map<string,number>();for(const flow of data.flows)for(const id of flow.artboardIds)counts.set(id,(counts.get(id)??0)+1)
 if(![...counts.values()].some(count=>count>1))return document
 const next=structuredClone(document),prototype=next.prototype!,originals=new Map(next.pages.filter(p=>!p.flowIntroductionFor).map(p=>[p.id,p])),used=new Set<string>(),interactions=prototype.interactions,remapped:typeof interactions=[]
 next.pages=next.pages.filter(p=>!p.flowIntroductionFor)
 for(const flow of prototype.flows){
  const pages=new Map<string,string>(),elements=new Map<string,Map<string,string>>()
  for(const id of flow.artboardIds){const original=originals.get(id);if(!original)continue;let page:VisualPage;const ids=new Map<string,string>()
   if(!used.has(id)){page=original;used.add(id)}else{
    page=structuredClone(original);page.id=crypto.randomUUID();const walk=(nodes:(VisualObject|StructuredNode)[])=>{for(const node of nodes){const old=node.id;node.id=crypto.randomUUID();ids.set(old,node.id);walk(node.children)}};walk(page.objects);if(page.structured){page.structured.id=crypto.randomUUID();walk(page.structured.children);const parents=(nodes:StructuredNode[])=>{for(const node of nodes){node.parentId=node.parentId?ids.get(node.parentId)??null:null;parents(node.children)}};parents(page.structured.children)}next.pages.push(page)
   }
   page.canonicalStateId=original.canonicalStateId??id;page.flowInstanceFor=flow.id;pages.set(id,page.id);elements.set(id,ids)
  }
  for(const edge of interactions){if(!pages.has(edge.sourceArtboardId)||edge.destinationId&&!pages.has(edge.destinationId))continue;remapped.push({...edge,id:crypto.randomUUID(),capturedView:true,sourceArtboardId:pages.get(edge.sourceArtboardId)!,destinationId:edge.destinationId?pages.get(edge.destinationId):undefined,sourceElementId:edge.sourceElementId?(elements.get(edge.sourceArtboardId)?.get(edge.sourceElementId)??edge.sourceElementId):undefined})}
  flow.startArtboardId=flow.startArtboardId?pages.get(flow.startArtboardId):undefined;flow.artboardIds=[...pages.values()];flow.positions={}
 }
 prototype.interactions=remapped;layoutFlowGroups(next.pages,prototype);return next
}
