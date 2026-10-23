import {layoutFlowGroups} from './flowIntroductions'
import type {VisualPage,VisualObject} from '../../shared/types/visualDesign'
import type {StructuredNode} from '../../shared/types/structuredDesign'
import type {PrototypeData} from '../../shared/types/prototype'
import type {DetectedArtifactTransition,DiscoveryCoverage} from '../../shared/artifactDiscovery'
export type DetectedTransition=DetectedArtifactTransition
/** Each flow owns screen occurrences and wires, while canonicalStateId identifies the shared capture. */
export function artifactFlow(pages:VisualPage[],transitions:DetectedTransition[],name:string,coverage?:DiscoveryCoverage):PrototypeData{
 const now=new Date().toISOString(),canonical=[...pages].filter(p=>!p.flowIntroductionFor),byRoute=new Map(canonical.map(p=>[p.route,p]))
 const observed:PrototypeData['interactions']=[]
 const failed=(edge:DetectedTransition,reason:string)=>{
  if(!coverage)return
  const entry=coverage.entries.find(e=>e.state===edge.source&&e.selector===edge.selector&&e.destination===edge.destination)
  if(entry){entry.status='failed';entry.reason=reason}else coverage.entries.push({state:edge.source,selector:edge.selector,label:edge.label,event:edge.trigger??'click',status:'failed',reason})
 }
 for(const edge of transitions){
  const source=byRoute.get(edge.source),destination=byRoute.get(edge.destination);if(!source?.structured||!destination){failed(edge,'A screen required by this connection could not be captured.');continue}
  let node:StructuredNode|undefined;const find=(nodes:StructuredNode[])=>{for(const item of nodes){if(item.source.selector===edge.selector)node=item;find(item.children)}};find(source.structured.children)
  if(!node&&edge.trigger!=='key'&&edge.kind!=='scroll'){failed(edge,'The captured control could not be matched to an editable layer.');continue}
  const bold=(n:StructuredNode):string|undefined=>{if(['b','strong'].includes(n.source.tag??'')&&n.typography?.text)return n.typography.text;for(const c of n.children){const found=bold(c);if(found)return found}}
  const label=((node&&bold(node))||edge.label).replace(/[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/gu,'').replace(/\s+/g,' ').trim()
  observed.push({id:crypto.randomUUID(),sourceArtboardId:source.id,sourceElementId:node?.id,destinationId:destination.id,trigger:edge.trigger??'click',action:edge.action??'navigate',capturedView:true,kind:edge.kind,componentType:edge.componentType,key:edge.key,inputValue:edge.value,transition:'instant',label:label.slice(0,200)})
 }
 const definitions:{root:string;label:string;members:string[];tabs:boolean}[]=[],covered=new Set<string>()
 const tabs=new Set(observed.filter(e=>e.kind==='tab').map(e=>e.sourceArtboardId))
 const tabMembers=new Set(observed.filter(e=>e.kind==='tab').flatMap(e=>[e.sourceArtboardId,...(e.destinationId?[e.destinationId]:[])])),tabCovered=new Set<string>()
 const make=(root:string,label:string,destination?:string,tabsOnly=false)=>{
  const barriers=new Set(observed.filter(e=>!tabsOnly&&e.sourceArtboardId===root&&e.destinationId!==destination).map(e=>e.destinationId))
  const members=new Set([root]),queue=destination?[destination]:[root];if(destination)members.add(destination)
  const visited=new Set<string>();while(queue.length){const id=queue.shift()!;if(visited.has(id))continue;visited.add(id);for(const edge of observed){if((tabsOnly?edge.kind!=='tab':edge.kind==='tab')||edge.sourceArtboardId!==id||!edge.destinationId||edge.destinationId===root||barriers.has(edge.destinationId))continue;members.add(edge.destinationId);queue.push(edge.destinationId)}}
  definitions.push({root,label:label.slice(0,200)||name,members:[...members],tabs:tabsOnly});members.forEach(id=>{covered.add(id);if(tabsOnly)tabCovered.add(id)})
 }
 for(const page of canonical){
  if(covered.has(page.id)&&!tabMembers.has(page.id))continue
  if(tabs.has(page.id)&&!tabCovered.has(page.id))make(page.id,page.name,undefined,true)
  const outgoing=observed.filter(e=>e.sourceArtboardId===page.id&&e.destinationId!==page.id&&e.kind!=='tab').sort((a,b)=>Number(b.trigger==='click')-Number(a.trigger==='click'))
  if(outgoing.length){const destinations=new Set<string>();for(const edge of outgoing){if(!edge.destinationId||destinations.has(edge.destinationId))continue;destinations.add(edge.destinationId);make(page.id,edge.label||'Continue',edge.destinationId)}}else if(!covered.has(page.id))make(page.id,page.name||name)
 }

 const flows:PrototypeData['flows']=[],interactions:PrototypeData['interactions']=[],used=new Set<string>(),byId=new Map(canonical.map(p=>[p.id,p]))
 for(const definition of definitions){
  const id=crypto.randomUUID(),occurrences=new Map<string,string>(),elementMaps=new Map<string,Map<string,string>>()
  for(const canonicalId of definition.members){const original=byId.get(canonicalId);if(!original)continue
   const ids=new Map<string,string>();let occurrence:VisualPage
   if(!used.has(canonicalId)){occurrence=original;used.add(canonicalId)}else{
    occurrence=structuredClone(original);occurrence.id=crypto.randomUUID();occurrence.canvasX=undefined;occurrence.canvasY=undefined
    const remap=(nodes:(StructuredNode|VisualObject)[])=>{for(const node of nodes){const old=node.id;node.id=crypto.randomUUID();ids.set(old,node.id);remap(node.children)}}
    remap(occurrence.objects);if(occurrence.structured){occurrence.structured.id=crypto.randomUUID();remap(occurrence.structured.children);const parents=(nodes:StructuredNode[])=>{for(const node of nodes){if(node.parentId)node.parentId=ids.get(node.parentId)??null;parents(node.children)}};parents(occurrence.structured.children)}
    pages.push(occurrence)
   }
   occurrence.canonicalStateId=canonicalId;occurrence.flowInstanceFor=id;occurrence.folder='Flow '+(flows.length+1)+' · '+definition.label
   occurrences.set(canonicalId,occurrence.id);elementMaps.set(canonicalId,ids)
  }
  flows.push({id,name:definition.label,kind:definition.tabs?'tabs':'journey',description:`${definition.label} · ${definition.members.length} captured views`,startArtboardId:occurrences.get(definition.root),artboardIds:[...occurrences.values()],positions:{},createdAt:now,updatedAt:now})
  for(const edge of observed){if((definition.tabs?edge.kind!=='tab':edge.kind==='tab')||!occurrences.has(edge.sourceArtboardId)||!edge.destinationId||!occurrences.has(edge.destinationId))continue;interactions.push({...edge,id:crypto.randomUUID(),sourceArtboardId:occurrences.get(edge.sourceArtboardId)!,destinationId:occurrences.get(edge.destinationId),sourceElementId:edge.sourceElementId?(elementMaps.get(edge.sourceArtboardId)?.get(edge.sourceElementId)??edge.sourceElementId):undefined})}
 }
 if(coverage){coverage.captured=coverage.entries.filter(e=>e.status==='captured').length;coverage.failed=coverage.entries.filter(e=>e.status==='failed').length;if(coverage.failed)coverage.complete=false}
 const result:PrototypeData={version:1,flows,interactions,variables:{},scenarios:[],imports:[],coverage}
 layoutFlowGroups(pages,result);return result
}
