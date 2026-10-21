import type {VisualDocument,VisualPage} from '../../shared/types/visualDesign'
import type {XdExportReport} from '../../shared/types/xdExport'
type Agc=Record<string,unknown>
/** Only serialize mappings verified against Adobe's native example format. Other gestures use explicit tap simulations. */
export function xdPrototype(document:VisualDocument,selected:VisualPage[],idFor:(id:string)=>string,warn:(message:string)=>void){
 const interactions:Record<string,Agc[]>={},details:NonNullable<XdExportReport['prototype']>['details']=[],pages=new Map(selected.map(p=>[p.id,p])),occupied=new Set<string>()
 const edges=[...document.prototype?.interactions??[]].sort((a,b)=>Number(b.trigger==='click')-Number(a.trigger==='click'))
 for(const edge of edges){
  if(!pages.has(edge.sourceArtboardId))continue
  const source=edge.sourceElementId?idFor(edge.sourceArtboardId+':'+edge.sourceElementId):idFor(edge.sourceArtboardId)
  const result={id:edge.id,source:edge.sourceArtboardId,destination:edge.destinationId,trigger:edge.trigger,status:'exact' as 'exact'|'simulated'|'unsupported',reason:''}
  const destination=edge.destinationId&&pages.get(edge.destinationId)
  let action:Agc|undefined
  if(destination&&(edge.capturedView||['navigate','open-modal','open-drawer','open-overlay','state','show','hide'].includes(edge.action))){
   action={action:'artboard-transition',properties:{destination:idFor(destination.id),transition:edge.transition==='fade'?'dissolve':edge.transition==='slide'?'slide-left':'none',duration:edge.transition==='instant'?0:.3,easing:'ease-out',preserveScrollPosition:!!edge.capturedView}}
   if(edge.trigger!=='click'||!['navigate','state'].includes(edge.action)){result.status='simulated';result.reason=edge.trigger!=='click'?`${edge.trigger} is represented by a tap to its captured outcome.`:'The captured complete view is shown as a linked artboard.'}
  }else if(edge.action==='back'||['close-modal','close-drawer','close-overlay'].includes(edge.action))action={action:'previous-artboard',properties:{}}
  else{result.status='unsupported';result.reason=edge.destinationId&&!destination?'Destination is outside the selected export scope.':`No verified XD mapping for ${edge.action}.`}
  if(action&&occupied.has(source)){result.status='unsupported';result.reason='Multiple outcomes require the same XD tap hotspot. Separate the source states before delivery.';action=undefined}
  if(action){occupied.add(source);(interactions[source]??=[]).push({...action,id:idFor(edge.id),triggerEvent:'tap'})}
  if(result.status!=='exact')warn(`${result.status==='unsupported'?'Unmapped interaction':'Simulated interaction'}: ${edge.label??edge.id} · ${result.reason}`)
  details.push(result)
 }
 const flows=(document.prototype?.flows??[]).filter(flow=>flow.artboardIds.some(id=>pages.has(id))).map(flow=>({id:flow.id,name:flow.name,start:flow.startArtboardId&&pages.has(flow.startArtboardId)?idFor(flow.startArtboardId):undefined,artboards:flow.artboardIds.filter(id=>pages.has(id)).map(idFor)}))
 const unsupported=details.filter(d=>d.status==='unsupported').length,pending=document.prototype?.coverage&&!document.prototype.coverage.complete?1:0
 const report:NonNullable<XdExportReport['prototype']>={exact:details.filter(d=>d.status==='exact').length,simulated:details.filter(d=>d.status==='simulated').length,unsupported,details,flows,ready:false,status:unsupported?'unsupported-interactions':pending?'partial-discovery':'application-validation-required'}
 return {interactions,report}
}
