import {layoutFlowGroups} from '../../../src/core/prototype/flowIntroductions'
import type {VisualPage} from '../../../src/shared/types/visualDesign'
import type {PrototypeData} from '../../../src/shared/types/prototype'
export function recordedFlow(pages:VisualPage[],session:any):PrototypeData {
 const now=new Date().toISOString(),byRoute=new Map(pages.map(p=>[p.route,p])),warnings:string[]=[]
 for(const action of session.actions??[])if(action.status==='missed')warnings.push('A '+action.componentType+' was clicked before the previous screen finished saving: '+action.label)
 const interactions:PrototypeData['interactions']=[]
 for(const edge of session.transitions){const source=byRoute.get(edge.source),destination=byRoute.get(edge.destination);if(!source||!destination)continue
  let nodeId:string|undefined
  const find=(nodes:any[])=>{for(const n of nodes){if(n.source?.selector===edge.selector)nodeId=n.id;find(n.children??[])}};find(source.structured?.children??[])
  if(!nodeId)warnings.push('A recorded '+edge.componentType+' could not be matched to a layer: '+edge.label)
  interactions.push({id:crypto.randomUUID(),sourceArtboardId:source.id,sourceElementId:nodeId,destinationId:destination.id,trigger:edge.trigger??'click',action:edge.action??'state',capturedView:true,kind:edge.kind,componentType:edge.componentType,transition:'instant',label:edge.label})
 }
 const journeys=session.journeys?.length?session.journeys:[{id:crypto.randomUUID(),name:session.name,pageIds:pages.map(p=>p.id)}]
 const flows:PrototypeData['flows']=journeys.filter((j:any)=>j.pageIds.length).map((j:any,i:number)=>{const ids=j.pageIds.filter((id:string)=>pages.some(p=>p.id===id));for(const page of pages.filter(p=>ids.includes(p.id))){page.flowInstanceFor=j.id;page.canonicalStateId=page.id;page.folder='Flow '+(i+1)+' · '+j.name}return {id:j.id,name:j.name,kind:'journey',description:j.name+' · '+ids.length+' recorded views in click order',startArtboardId:ids[0],artboardIds:ids,positions:{},createdAt:now,updatedAt:now}})
 const prototype:PrototypeData={version:1,flows,interactions,variables:{},scenarios:[],imports:[],coverage:{version:2,mode:'detailed',complete:false,attempted:session.actions?.length??session.transitions.length,captured:interactions.length,unchanged:session.unchanged??0,blocked:1,failed:warnings.length,pending:0,entries:[{state:'',selector:'',label:'Recorded journey',event:'review',status:'blocked',reason:'Only the states visited while following this flow are included.'},...warnings.map(reason=>({state:'',selector:'',label:'Unmatched layer',event:'click',status:'failed' as const,reason}))],limits:{states:pages.length,attempts:session.actions?.length??session.transitions.length,depth:0,milliseconds:0}}}
 layoutFlowGroups(pages,prototype);return prototype
}
