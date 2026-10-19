import {test,expect} from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {defaultDesignSettings,resolveDesignSettings,designStructure} from '../../src/shared/aiDesign'
import {DesignTools} from '../../src/main/ai/tools'
import {createArtboard,createCanvasNode} from '../../src/core/ai/canvas'
import {buildDeveloperHandoff} from '../../src/core/handoff/developerPackage'
import type {AiRequest} from '../../src/shared/types/ai'
import type {ProjectIndex} from '../../src/shared/types/projectIndex'

const design={approach:'redesign'} as const
function fixture(){
 const document:AiRequest['document']={id:'approach',name:'Workspace',version:1,updatedAt:'1',pages:[],components:[],variables:[]}
 const page=createArtboard(document,'Legacy dashboard',1280,900)
 createCanvasNode(page,'Text',{text:'Projects',width:300,height:40,fontSize:24,fontFamily:'Arial'})
 const index={framework:'php',phpFramework:'codeigniter',language:'php',routerStyle:'codeigniter',technologies:[{name:'Bootstrap',kind:'ui-library'}],projectModel:{components:[{id:'old-table',name:'LegacyTable',source:{filePath:'table.php'}}],pages:[],tokens:[],assets:[]}} as unknown as ProjectIndex
 return {document,page,index}
}
function toolsFor(f:ReturnType<typeof fixture>,root:string|null=null){return new DesignTools({document:f.document,pageId:f.page.id,selection:[],prompt:'Redesign the project dashboard',mode:'design',style:'project',design},f.index,root,new AbortController().signal,'grounded')}
test('approaches control structural retention; old policies migrate to grounded approaches',()=>{
 expect(defaultDesignSettings('redesign')).toEqual(design)
 expect(defaultDesignSettings('create')).toEqual({approach:'create'})
 expect(designStructure(defaultDesignSettings())).toBe('preserve')
 expect(resolveDesignSettings({direction:'redesign',freedom:'creative'})).toEqual(design)
 expect(resolveDesignSettings(undefined,'preserve')).toEqual({approach:'improve'})
 expect(designStructure(resolveDesignSettings(design,'preserve'))).toBe('explore')
})
test('new missing components are editable proposals with actual technology context and transparent handoff',async()=>{
 const f=fixture(),before=structuredClone(f.document),tools=toolsFor(f)
 const context=await tools.execute('get_design_context',{}) as any
 expect(context.rules.design).toEqual(design)
 expect(context.technology).toMatchObject({language:'php',phpFramework:'codeigniter',routerStyle:'codeigniter'})
 expect(context.rules.foundation).toContain('Do not introduce another UI library')
 await tools.execute('find_component',{})
 const page=await tools.execute('create_artboard',{name:'New dashboard',width:1280,height:900}) as {id:string}
 expect(tools.result.document.pages.find(p=>p.id===page.id)?.structured?.children.length).toBe(0)
 const card=await tools.execute('create_frame',{pageId:page.id,name:'Analytics card',width:360,height:200,radius:24,fill:'#f0ecff'}) as {id:string}
 await tools.execute('record_design_decision',{pageId:page.id,id:card.id,query:'new',reason:'No analytics card exists; this groups existing project metrics using the established card spacing and typography.'})
 const report=tools.reuseReview()
 expect(report.errors).toEqual([]);expect(report.design).toEqual(design)
 expect(report.pages[0].decisions?.[0].reason).toContain('No analytics card')
 expect(f.document).toEqual(before)
 const files=new Map(buildDeveloperHandoff(tools.result.document,f.index,'',before,design).files.map(f=>[f.path,f.content]))
 expect(JSON.parse(files.get('design-approach.json')!).design).toEqual(design)
 expect(JSON.parse(files.get('component-proposals.json')!)[0]).toMatchObject({name:'Analytics card',kind:'new'})
 expect(JSON.parse(files.get('design-changes.json')!).newElements[0]).toMatchObject({name:'Analytics card',origin:'new native design proposal'})
 expect(JSON.parse(files.get('repository.json')!)).toMatchObject({framework:'php',phpFramework:'codeigniter',language:'php'})
})
test('ignoring an available component requires inspection and a concrete recorded reason, not token reuse',async()=>{
 const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-grounded-'))
 try{
  fs.writeFileSync(path.join(root,'table.php'),'<?php /* legacy table requires full-page server rendering */ ?>')
  const tools=toolsFor(f,root);await tools.execute('find_component',{query:'Table'})
  const page=await tools.execute('create_artboard',{name:'New analytics'}) as {id:string}
  await tools.execute('clone_element',{pageId:page.id,templateId:f.page.id,id:f.page.structured!.children[0].id})
  const table=await tools.execute('create_frame',{pageId:page.id,name:'Projects table',width:900,height:300}) as {id:string}
  expect(tools.reuseReview().pages[0].reusedElements).toBeGreaterThan(0)
  expect(tools.reuseReview().errors[0]).toContain('LegacyTable')
  await expect(tools.execute('record_design_decision',{pageId:page.id,id:table.id,query:'variant',componentId:'old-table',reason:'Extend the existing table with compact rows and keyboard-accessible column filters.'})).rejects.toThrow('Inspect')
  await tools.execute('inspect_component',{componentId:'old-table'})
  await tools.execute('record_design_decision',{pageId:page.id,id:table.id,query:'variant',componentId:'old-table',reason:'Extend the existing table with compact rows and keyboard-accessible column filters.'})
  expect(tools.reuseReview().errors).toEqual([])
  expect(tools.reuseReview().pages[0].decisions?.[0].kind).toBe('variant')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('unrelated fonts are rejected on creation and editing even with attached-reference styling',async()=>{
 const f=fixture(),tools=toolsFor(f);tools.request.style='reference'
 await expect(tools.execute('create_text',{pageId:f.page.id,text:'New',fontFamily:'Unrelated display font'})).rejects.toThrow('resolved project font')
 await expect(tools.execute('set_typography',{pageId:f.page.id,id:f.page.structured!.children[0].id,fontFamily:'Unrelated display font'})).rejects.toThrow('resolved project font')
})
test('proposed shared tokens retain identity, update linked elements and export separately from repository tokens',async()=>{
 const f=fixture(),before=structuredClone(f.document),tools=toolsFor(f)
 const token=await tools.execute('propose_design_token',{name:'Card radius',query:'radius',text:'16px'}) as {tokenId:string}
 const card=await tools.execute('create_frame',{pageId:f.page.id,name:'Card',width:300,height:160}) as {id:string}
 await tools.execute('set_radius',{pageId:f.page.id,id:card.id,tokenId:token.tokenId})
 const updated=await tools.execute('propose_design_token',{name:'Card radius',query:'radius',text:'20px'}) as {tokenId:string}
 expect(updated.tokenId).toBe(token.tokenId)
 expect(tools.result.document.variables).toHaveLength(1)
 expect(tools.result.document.pages[0].structured!.children.find(n=>n.id===card.id)?.appearance.radius).toEqual([20,20,20,20])
 expect(f.document).toEqual(before)
 const files=new Map(buildDeveloperHandoff(tools.result.document,f.index,'',before,design).files.map(f=>[f.path,f.content]))
 expect(JSON.parse(files.get('design-changes.json')!).designTokens[0].value).toBe('20px')
 expect(f.index.projectModel.tokens).toEqual([])
})
test('old quota-only failures become review notices while genuine saved errors are retained',async()=>{
 const {upgradeDesignReview}=await import('../../src/core/ai/designContext')
 const old={approach:'explore' as const,pages:[{id:'screen',name:'Screen',reusedElements:0,components:[],warnings:[]}],errors:['Screen: no repository components or captured elements were reused. Use create_component_instance or clone_element; new layouts and colours are welcome.','Unresolved destination']}
 const migrated=upgradeDesignReview(old)
 expect(migrated.errors).toEqual(['Unresolved destination']);expect(migrated.pages[0].warnings[0]).toContain('repository compatibility');expect(old.errors).toHaveLength(2)
})

test('new icons are justified against available project assets and proposal metadata survives persistence',async()=>{
 const f=fixture();f.index.projectModel.assets.push({id:'icons',name:'Existing icons',kind:'icon',source:{filePath:'assets/icons.svg'}})
 const tools=toolsFor(f);await tools.execute('find_component',{query:'icon'})
 const icon=await tools.execute('create_vector',{pageId:f.page.id,name:'Security icon',width:24,height:24,vectorPath:'M 12 2 L 22 12 L 12 22 L 2 12 Z',fill:'#148b82'}) as {id:string}
 expect(tools.reuseReview().errors[0]).toContain('project icon assets')
 await tools.execute('record_design_decision',{pageId:f.page.id,id:icon.id,query:'new',reason:'The available asset set has no security mark; use the same filled silhouette and 24px icon grid.'})
 expect(tools.reuseReview().errors).toEqual([])
 const {visualDocumentSchema}=await import('../../src/core/visual/schema')
 const parsed=visualDocumentSchema.parse(tools.result.document)
 expect(parsed.pages[0].structured!.children.find(n=>n.id===icon.id)?.designProposal?.reason).toContain('24px icon grid')
})


test('component candidate checks do not mistake ordinary text labels for new controls',async()=>{
 const f=fixture(),tools=toolsFor(f);await tools.execute('create_text',{pageId:f.page.id,name:'Table section title',text:'Project activity',width:300,height:40})
 expect(tools.reuseReview().errors).toEqual([])
})
