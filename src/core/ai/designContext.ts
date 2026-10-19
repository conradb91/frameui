import {designPolicy,resolveDesignSettings,type AiDesignSettings} from '@shared/aiDesign'
import type { VisualPage } from '@shared/types/visualDesign'
import type { StructuredNode } from '@shared/types/structuredDesign'
import type { ProjectIndex } from '@shared/types/projectIndex'

export function hasDesign(page: VisualPage | undefined): page is VisualPage {
  return !!page && !!(page.structured?.children.length || page.objects.length)
}
/** A bounded, actionable tree: unlike layer-name lists it includes IDs and styling. */
export function designOutline(page: VisualPage, limit = 240) {
  const nodes: unknown[] = []
  const visit = (items: StructuredNode[]) => { for (const n of items) {
    if (nodes.length >= limit) return
    nodes.push({id:n.id,parentId:n.parentId,name:n.name,type:n.type,bounds:n.bounds,layout:n.layout,appearance:n.appearance,typography:n.typography,visible:n.visibility,component:n.componentBinding,proposal:n.designProposal,source:{tag:n.source.tag,file:n.source.file,component:n.source.component},tokens:n.tokenBindings})
    visit(n.children)
  } }
  if(page.structured)visit(page.structured.children)
  else { const visitLegacy=(items:VisualPage['objects'])=>{for(const n of items){if(nodes.length>=limit)return;const {children,...rest}=n;nodes.push(rest);visitLegacy(children)}};visitLegacy(page.objects) }
  return {id:page.id,name:page.name,width:page.width,height:page.height,route:page.route,nodes,truncated:nodes.length>=limit}
}
export function repositoryDesignContext(index:ProjectIndex|null,reference:VisualPage|undefined,prompt:string,design?:AiDesignSettings) {
  const model=index?.projectModel
  const bound=new Set<string>(),files=new Set<string>()
  const visit=(items:StructuredNode[])=>{for(const n of items){if(n.componentBinding)bound.add(n.componentBinding.componentId);if(n.source.file)files.add(n.source.file);visit(n.children)}}
  if(reference?.structured)visit(reference.structured.children)
  const words=new Set((prompt+' '+(reference?.name??'')+' '+(reference?.route??'')).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2))
  const components=(model?.components??[]).map(c=>({component:c,score:(bound.has(c.id)?100:0)+(files.has(c.source.filePath)?30:0)+[...words].filter(w=>(c.name+' '+c.source.filePath).toLowerCase().includes(w)).length*5})).sort((a,b)=>b.score-a.score).slice(0,18).map(({component:c})=>({id:c.id,name:c.name,source:c.source,props:model?.designSystem?.components.find(i=>i.componentId===c.id)?.props,fixtures:model?.designSystem?.components.find(i=>i.componentId===c.id)?.fixtures,category:model?.designSystem?.components.find(i=>i.componentId===c.id)?.category,captured:bound.has(c.id)}))
  const context={reference:reference?designOutline(reference,100):null,framework:index?.framework,technology:{language:index?.language,bundler:index?.bundler,routerStyle:index?.routerStyle,phpFramework:index?.phpFramework,detected:index?.technologies??[]},conventions:model?.designSystem?.observations?.slice(0,32)??[],patterns:model?.designSystem?.patterns?.slice(0,8)??[],routes:model?.pages?.slice(0,12).map(p=>({id:p.id,name:p.name,route:p.route,source:p.source}))??[],components,tokens:model?.tokens.slice(0,80)??[],assets:model?.assets.slice(0,24).map(a=>({id:a.id,kind:a.kind,source:a.source}))??[],rules:designPolicy(resolveDesignSettings(design))}
  // Keep the initial prompt complete; deeper trees remain available through inspect_artboard.
  while(JSON.stringify(context).length>20000){if(context.reference&&context.reference.nodes.length>12){context.reference.nodes.pop();context.reference.truncated=true}else if(context.tokens.length>10)context.tokens.pop();else if(context.components.length>5)context.components.pop();else if(context.conventions.length)context.conventions.pop();else if(context.patterns.length)context.patterns.pop();else break}
  return context
}

/** Candidate detection is evidence for review, not a claim of semantic suitability. */
export function componentCandidates(index:ProjectIndex|null,n:StructuredNode){
  const label=['Text','Image','Shape','SVG','Icon','Divider'].includes(n.type)?'':n.name
  const category=n.source.tag==='button'||n.type==='Button'||/\bbutton\b/i.test(label)?'Buttons':n.source.tag==='select'||/\bselect\b/i.test(label)?'Selects':n.source.control||n.type==='Input'||/\binput\b/i.test(label)?'Inputs':n.source.tag==='table'||/\btable\b/i.test(label)?'Tables':n.source.tag==='dialog'||/\bmodal\b/i.test(label)?'Modals':/\bdrawer\b/i.test(label)?'Drawers':undefined
  return category?(index?.projectModel.components??[]).filter(c=>index?.projectModel.designSystem?.components.find(i=>i.componentId===c.id)?.category===category||new RegExp(category==='Inputs'?'input|textfield':category.slice(0,-1),'i').test(c.name)):[]
}

export interface DesignReview {design?:AiDesignSettings;reference?:string;approach:'preserve'|'explore';pages:{id:string;name:string;reusedElements:number;components:string[];warnings:string[];decisions?:{id:string;name:string;kind:'new'|'variant';reason:string;componentId?:string}[];newElements?:{id:string;name:string;type:string}[]}[];errors:string[]}
export function reviewReuse(before:import('@shared/types/visualDesign').VisualDocument,after:import('@shared/types/visualDesign').VisualDocument,index:ProjectIndex|null,inherited:Set<string>,approach:'preserve'|'explore',design?:AiDesignSettings):DesignReview {
  const pages:DesignReview['pages']=[],errors:string[]=[],settings=resolveDesignSettings(design,approach)
  for(const p of after.pages){const old=before.pages.find(b=>b.id===p.id);if(old&&JSON.stringify(old)===JSON.stringify(p))continue
    const decisions:NonNullable<DesignReview['pages'][number]['decisions']>=[];const newElements:{id:string;name:string;type:string}[]=[];let reusedElements=0;const components=new Set<string>();let count=0
    const visit=(ns:StructuredNode[])=>{for(const n of ns){count++;if(inherited.has(n.id))reusedElements++;if(!inherited.has(n.id)&&!n.componentBinding)newElements.push({id:n.id,name:n.name,type:n.type});if(n.componentBinding){components.add(index?.projectModel.components.find(c=>c.id===n.componentBinding?.componentId)?.name??n.source.component??n.componentBinding.componentId)}visit(n.children)}}
    if(p.structured)visit(p.structured.children)
    const audit=(nodes:StructuredNode[],bound=false)=>{for(const n of nodes){
      const candidates=componentCandidates(index,n),proposal=n.designProposal
      if(proposal)decisions.push({id:n.id,name:n.name,...proposal})
      if(!bound&&!n.componentBinding&&!inherited.has(n.id)){
        if(candidates.length&&(!proposal?.componentId||!candidates.some(c=>c.id===proposal.componentId)))errors.push(p.name+' / '+n.name+': suitable project component candidates are available ('+candidates.slice(0,4).map(c=>c.name).join(', ')+'). Reuse or extend one, or inspect a candidate and record_design_decision with its componentId and a specific reason for the replacement.')
        if(!proposal&&(n.type==='SVG'||n.type==='Icon')&&index?.projectModel.assets.some(a=>a.kind==='icon'))errors.push(p.name+' / '+n.name+': project icon assets are available. Use an existing icon or record_design_decision explaining the missing icon and matching style.')
      }
      audit(n.children,bound||!!n.componentBinding)
    }};audit(p.structured?.children??[])
    const warnings:string[]=[]
    if(count>0&&index?.projectModel.components.length&&!reusedElements&&!components.size&&settings.approach==='improve')warnings.push('No existing elements were retained. Check that this still retains the page’s general organisation.')
    pages.push({id:p.id,name:p.name,reusedElements,components:[...components],warnings,newElements,decisions})
  }
  return {design:settings,approach,pages,errors}
}

/** Retire the old mandatory reuse gate without discarding other saved diagnostics. */
export function upgradeDesignReview(review:DesignReview):DesignReview {
  const next=structuredClone(review);next.design=resolveDesignSettings(next.design,next.approach)
  const obsolete=next.errors.filter(e=>e.includes('no repository components or captured elements were reused.'))
  next.errors=next.errors.filter(e=>!obsolete.includes(e))
  for(const message of obsolete){const page=next.pages.find(p=>message.startsWith(p.name+':'));if(page)page.warnings.push('This version introduces a new design without reusing existing elements. Review its repository compatibility.')}
  return next
}
