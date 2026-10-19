import {test,expect} from 'bun:test'
import {buildDeveloperHandoff} from '../../src/core/handoff/developerPackage'
import {createArtboard,createCanvasNode} from '../../src/core/ai/canvas'
import {prototype} from '../../src/core/prototype/model'
import type {VisualDocument} from '../../src/shared/types/visualDesign'
test('developer bundle preserves editable native styles, component props and the full prototype graph',()=>{
 const doc:VisualDocument={id:'handoff',name:'Approved design',version:1,updatedAt:'1',pages:[],components:[],variables:[]}
 const page=createArtboard(doc,'Login',1280,900),drawer=createArtboard(doc,'Settings',400,900)
 const id=createCanvasNode(page,'Frame',{name:'Real Button',radius:[14,14,14,14],width:240,height:48})
 page.structured!.children[0].componentBinding={componentId:'button',confidence:1,variant:{variant:'quiet',children:'Continue'}}
 page.structured!.children[0].source.file='src/Button.tsx'
 createCanvasNode(page,'Text',{name:'Heading',text:'Welcome back',fontSize:32,lineHeight:40,width:500,height:44})
 const p=prototype(doc);p.flows.push({id:'flow',name:'Account',description:'',startArtboardId:page.id,artboardIds:[page.id,drawer.id],positions:{},createdAt:'1',updatedAt:'1'})
 p.interactions.push({id:'open',sourceArtboardId:page.id,sourceElementId:id,trigger:'click',action:'open-drawer',destinationId:drawer.id,transition:'slide'})
 const built=buildDeveloperHandoff(doc,null,'Reuse the existing sign-in API.'),files=new Map(built.files.map(f=>[f.path,f.content]))
 const native=JSON.parse(files.get('native-design.json')!)
 expect(native.pages[0].structured.children[0].appearance.radius).toEqual([14,14,14,14])
 expect(native.pages[0].structured.children[1].typography.fontSize).toBe(32)
 expect(JSON.parse(files.get('component-map.json')!)[0]).toMatchObject({file:'src/Button.tsx',props:{variant:'quiet',children:'Continue'}})
 expect(JSON.parse(files.get('prototype.json')!).interactions[0].action).toBe('open-drawer')
 expect(files.get('implementation.md')).toContain('Reuse the existing sign-in API.')
 expect(files.get('CLAUDE_HANDOFF.md')).toContain('developer\'s existing repository')
 expect(files.get('README.md')).toContain('Show me the implementation plan before editing')
 expect(built.editableFiles.some(f=>f.path==='document.json')).toBe(true)
 expect(doc.pages[0].structured!.children[0].appearance.radius[0]).toBe(14)
})
