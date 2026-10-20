import {test,expect} from 'bun:test'
import {designPatch,applyDesignPatch} from '../../src/shared/designPatch'
import type {VisualDocument} from '../../src/shared/types/visualDesign'
const newDocument=(name:string)=>({id:'test',name,updatedAt:'before',pages:[{id:'first',name:'Page',width:1440,height:900,objects:[]}]} as unknown as VisualDocument)
test('routine saves send only changed fields while retaining media, page order and removals',()=>{
 const base=newDocument('Test'),first=base.pages[0];base.pages.push({...first,id:'other'})
 const next={...base,updatedAt:'next',pages:[{...first,canvasX:400}]}
 const patch=designPatch(base,next)
 expect(patch.pages).toEqual([{id:first.id,canvasX:400}])
 expect(patch.fields).toEqual({updatedAt:'next'})
 expect(applyDesignPatch(base,patch)).toEqual(next)
 expect(()=>applyDesignPatch({...base,updatedAt:'concurrent'},patch)).toThrow('saved design changed')
})

test('save baseline survives an import replacing the original library pages',async()=>{
 const {saveBaseline}=await import('../../src/shared/designPatch')
 const library=newDocument('Library');library.pages=[]
 const baseline=saveBaseline(library)
 library.pages=newDocument('Captured').pages
 const patch=designPatch(baseline,library)
 expect(patch.pages).toHaveLength(1)
 expect(applyDesignPatch(baseline,patch).pages).toEqual(library.pages)
})
