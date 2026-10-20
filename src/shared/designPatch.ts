import type {VisualDocument,VisualPage} from './types/visualDesign'
export interface DesignPatch {id:string;baseUpdatedAt:string;fields:Partial<Omit<VisualDocument,'pages'>>;pageOrder:string[];pages:(Partial<VisualPage>&{id:string})[]}
/** Compare immutable page/field references without walking image bytes or layer trees. */
export function designPatch(base:VisualDocument,next:VisualDocument):DesignPatch {
 const fields:Record<string,unknown>={};for(const key of [...new Set([...Object.keys(base),...Object.keys(next)])] as (keyof VisualDocument)[])if(key!=='pages'&&next[key]!==base[key])fields[key]=next[key]
 const before=new Map(base.pages.map(p=>[p.id,p]))
 const pages=next.pages.flatMap(page=>{const old=before.get(page.id);if(old===page)return[];if(!old)return[page];const changes:Record<string,unknown>={id:page.id};for(const key of new Set([...Object.keys(old),...Object.keys(page)]))if(page[key as keyof VisualPage]!==old[key as keyof VisualPage])changes[key]=page[key as keyof VisualPage];return[changes as Partial<VisualPage>&{id:string}]})
 return{id:next.id,baseUpdatedAt:base.updatedAt,fields,pageOrder:next.pages.map(p=>p.id),pages}
}
export function applyDesignPatch(base:VisualDocument,patch:DesignPatch):VisualDocument {
 if(base.id!==patch.id||base.updatedAt!==patch.baseUpdatedAt)throw new Error('The saved design changed. Reopen it before saving again.')
 if(new Set(patch.pageOrder).size!==patch.pageOrder.length)throw new Error('Duplicate artboard ID')
 const pages=new Map(base.pages.map(p=>[p.id,p]));for(const update of patch.pages)pages.set(update.id,{...pages.get(update.id),...update} as VisualPage)
 return{...base,...patch.fields,id:base.id,pages:patch.pageOrder.map(id=>{const page=pages.get(id);if(!page)throw new Error('Missing artboard');return page})}
}
/** Retain values used by save diffs even if an import caller later reuses its root/page objects. */
export function saveBaseline(document:VisualDocument):VisualDocument {return {...document,pages:document.pages.map(page=>({...page}))}}
