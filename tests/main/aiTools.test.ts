import {test,expect} from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {DesignTools} from '../../src/main/ai/tools'
import {resolveProjectFonts} from '../../src/main/ai/fonts'
import type {AiRequest} from '../../src/shared/types/ai'
import type {ProjectIndex} from '../../src/shared/types/projectIndex'
function request(mode:'design'|'code'='design'):AiRequest{return {document:{pages:[],components:[],variables:[]} as unknown as AiRequest['document'],pageId:'',selection:[],prompt:'test',mode,style:'project'}}
test('tool boundary blocks source writes and commands in default design mode',async()=>{
 const tools=new DesignTools(request(),null,null,new AbortController().signal,'test')
 for(const name of ['propose_file_change','propose_new_file','run_tests','run_build','run_project'])await expect(tools.execute(name,{path:'a.ts',content:'new'})).rejects.toThrow()
 await expect(tools.execute('read_file',{path:'a.ts',unexpected:'argument'})).rejects.toThrow()
 await expect(tools.execute('run_shell',{content:'ls'})).rejects.toThrow('Unknown')
})
test('code tools stage concrete proposals without modifying source; new files require component search',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-ai-tools-'))
 try{
  fs.writeFileSync(path.join(root,'a.ts'),'original')
  const tools=new DesignTools(request('code'),null,root,new AbortController().signal,'test')
  await tools.execute('propose_file_change',{path:'a.ts',content:'proposed'})
  expect(fs.readFileSync(path.join(root,'a.ts'),'utf8')).toBe('original')
  expect(tools.result.changes[0]).toMatchObject({before:'original',after:'proposed'})
  await expect(tools.execute('propose_new_file',{path:'b.ts',content:'new'})).rejects.toThrow('Search')
  await tools.execute('find_component',{query:'Button'})
  await tools.execute('propose_new_file',{path:'b.ts',content:'new'})
  expect(fs.existsSync(path.join(root,'b.ts'))).toBe(false)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('font resolver embeds only actual local bytes and rejects external and escaping URLs',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameui-ai-fonts-'))
 try{
  fs.mkdirSync(path.join(root,'public'));fs.writeFileSync(path.join(root,'public','fixture.woff2'),'fixture-font-bytes')
  fs.writeFileSync(path.join(root,'font.css'),'@font-face{font-family:"Fixture";font-weight:100 900;src:url(/fixture.woff2)} @font-face{font-family:Remote;src:url(https://example.com/font.woff2)}')
  const fonts=resolveProjectFonts(root,{files:{'font.css':{}}} as unknown as ProjectIndex)
  expect(fonts).toHaveLength(1);expect(fonts[0].family).toBe('Fixture');expect(fonts[0].weight).toBe('100 900')
  expect(Buffer.from(fonts[0].data.split(',')[1],'base64').toString()).toBe('fixture-font-bytes')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('atomic batches resolve screen and control IDs into complete navigation and roll back failures',async()=>{
 const tools=new DesignTools(request(),null,null,new AbortController().signal,'test')
 const result=await tools.execute('apply_design_batch',{operations:[
  {tool:'create_artboard',args:{name:'Home'},ref:'home'},
  {tool:'create_text',args:{pageId:'$home',text:'Open details'},ref:'button'},
  {tool:'create_artboard',args:{name:'Details'},ref:'details'},
  {tool:'configure_interaction',args:{data:JSON.stringify({sourceArtboardId:'$home',sourceElementId:'$button',trigger:'click',action:'open-drawer',destinationId:'$details',transition:'slide'})}},
  {tool:'configure_flow',args:{data:JSON.stringify({name:'Review',startArtboardId:'$home',artboardIds:['$home','$details']})}}
 ]}) as {refs:Record<string,string>}
 expect(tools.result.document.pages).toHaveLength(2)
 expect(tools.result.document.prototype?.interactions[0]).toMatchObject({sourceArtboardId:result.refs.home,sourceElementId:result.refs.button,destinationId:result.refs.details,action:'open-drawer'})
 const before=structuredClone(tools.result.document)
 await expect(tools.execute('apply_design_batch',{operations:[{tool:'create_artboard',args:{name:'Rolled back'}},{tool:'set_fill',args:{id:'missing',fill:'red'}}]})).rejects.toThrow()
 expect(tools.result.document).toEqual(before)
 await expect(tools.execute('apply_design_batch',{operations:[{tool:'propose_new_file',args:{path:'x',content:'unsafe'}}]})).rejects.toThrow('not allowed')
})

test('project context exposes usable components and native structure, not just inventory counts',async()=>{
 const {createArtboard,createCanvasNode}=await import('../../src/core/ai/canvas')
 const doc={version:1,id:'design',name:'Login',updatedAt:'1',pages:[],components:[],variables:[]} as AiRequest['document']
 const page=createArtboard(doc,'Login',1280,900),button=createCanvasNode(page,'Frame',{name:'Passkey Button',x:40,y:200,width:300,height:44,fill:'#138f85',radius:[12,12,12,12]})
 page.structured!.children[0].componentBinding={componentId:'button',confidence:1}
 const index={framework:'React',files:{},projectModel:{components:[{id:'card',name:'Card',source:{filePath:'Card.tsx'}},{id:'button',name:'Button',source:{filePath:'Button.tsx'}}],tokens:[{id:'primary',name:'--primary',category:'color',value:'#138f85'}],assets:[],designSystem:{components:[{componentId:'button',props:[{name:'variant',values:['primary','secondary']}],fixtures:[]}]}}} as unknown as ProjectIndex
 const tools=new DesignTools({...request(),document:doc,pageId:page.id,prompt:'Redesign the login'},index,null,new AbortController().signal,'test')
 const context=(tools.summary() as any).designContext
 expect(context.components[0].id).toBe('button');expect(context.components[0].props[0].name).toBe('variant')
 expect(context.reference.nodes[0]).toMatchObject({id:button,bounds:{width:300},component:{componentId:'button'}})
 await tools.execute('find_component',{query:'button'})
 const screen=await tools.execute('create_artboard',{name:'New composition',width:1200,height:800}) as {id:string}
 expect(tools.result.document.pages.find(p=>p.id===screen.id)?.structured?.children).toHaveLength(0)
 await tools.execute('create_text',{pageId:screen.id,text:'A new composition',fontSize:24})
 expect(tools.reuseReview().errors).toHaveLength(0)
 expect(tools.reuseReview().pages.find(p=>p.id===screen.id)?.newElements?.length).toBeGreaterThan(0)
 const reused=await tools.execute('clone_element',{templateId:page.id,pageId:screen.id,id:button,x:200,y:300}) as {id:string}
 const clone=tools.result.document.pages.find(p=>p.id===screen.id)!.structured!.children.find(n=>n.id===reused.id)!
 expect(clone.appearance.radius).toEqual([12,12,12,12]);expect(clone.componentBinding?.componentId).toBe('button')
 await tools.execute('set_fill',{pageId:screen.id,id:clone.id,fill:'#6546df'})
 expect(clone.appearance.backgroundColor).toBe('#6546df');expect(page.structured!.children[0].appearance.backgroundColor).toBe('#138f85')
 expect(tools.reuseReview().errors).toHaveLength(0)
 expect(tools.reuseReview().pages.find(p=>p.id===screen.id)?.components).toEqual(['Button'])
 const constrained=new DesignTools({...request(),document:doc,pageId:page.id,structure:'preserve'},index,null,new AbortController().signal,'test')
 await constrained.execute('find_component',{})
 const variant=await constrained.execute('create_artboard',{name:'Alternative'}) as {id:string}
 const alternative=constrained.result.document.pages.find(p=>p.id===variant.id)!
 expect(alternative.width).toBe(1280);expect(alternative.height).toBe(900)
 expect(alternative.structured!.children[0].componentBinding?.componentId).toBe('button')
 expect(alternative.structured!.children[0].id).not.toBe(button)
})

test('AI creation honours supplied corner radius, border, shadow and font sizing instead of dropping styling arguments',async()=>{
 const tools=new DesignTools(request(),null,null,new AbortController().signal,'test')
 const page=await tools.execute('create_artboard',{name:'Card styles'}) as {id:string}
 await tools.execute('create_frame',{pageId:page.id,name:'Card',radius:20,borderWidth:1,borderColor:'#dedee8',fill:'#ffffff',shadow:'0 4px 20px #00000010'})
 await tools.execute('create_text',{pageId:page.id,text:'Exact type',fontSize:30,lineHeight:38,fontWeight:'600',textAlign:'center'})
 const nodes=tools.result.document.pages[0].structured!.children
 expect(nodes[0].appearance.radius).toEqual([20,20,20,20]);expect(nodes[0].appearance.border).toMatchObject({width:1,color:'#dedee8'})
 expect(nodes[0].appearance.boxShadow).toBe('0 4px 20px #00000010')
 expect(nodes[1].typography).toMatchObject({fontSize:30,lineHeight:38,fontWeight:'600',textAlign:'center'})
})

test('mobile artboard resizing retains component geometry and rolls back in a failed batch',async()=>{
 const tools=new DesignTools(request(),null,null,new AbortController().signal,'mobile')
 const page=await tools.execute('create_artboard',{name:'Login',width:1440,height:1024}) as {id:string}
 const text=await tools.execute('create_text',{pageId:page.id,text:'Welcome back',x:24,y:80,width:300,height:40,fontSize:24}) as {id:string}
 await tools.execute('resize_artboard',{pageId:page.id,width:390,height:844})
 expect(tools.result.document.pages[0]).toMatchObject({width:390,height:844,structured:{width:390,height:844}})
 const inspected=await tools.execute('inspect_artboard',{pageId:page.id}) as any
 expect(JSON.stringify(inspected)).toContain('Welcome back')
 await expect(tools.execute('apply_design_batch',{operations:[{tool:'resize_artboard',args:{pageId:page.id,width:320}},{tool:'move_element',args:{pageId:page.id,id:'missing',x:0}}]})).rejects.toThrow()
 expect(tools.result.document.pages[0].width).toBe(390)
 expect(text.id).toBeTruthy()
})

test('native prototype inputs support meaningful placeholders and date/time values without using placeholder text as data',async()=>{
 const tools=new DesignTools(request(),null,null,new AbortController().signal,'input')
 const page=await tools.execute('create_artboard',{name:'Reminder'}) as {id:string}
 const input=await tools.execute('create_input',{pageId:page.id,name:'Due date',inputType:'date',placeholder:'Choose a date',text:'',width:240,height:44}) as {id:string}
 expect(tools.result.document.pages[0].structured!.children.find(n=>n.id===input.id)?.source.control).toMatchObject({type:'date',placeholder:'Choose a date',value:''})
})
