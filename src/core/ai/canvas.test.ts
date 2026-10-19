import { test,expect } from 'bun:test'
import { createArtboard,createCanvasNode,changeCanvasNode,duplicateArtboard,deleteCanvasNode,bindToken } from './canvas'
import type { VisualDocument } from '@shared/types/visualDesign'
import { structuredFrameSchema } from '@core/capture-compiler/schema'
import { renderStructuredFrameToHtml } from '@core/capture-compiler/renderStructuredFrameToHtml'
function document(){return {pages:[],components:[],variables:[]} as unknown as VisualDocument}
test('Claude creates actual editable nodes, retains IDs and exports through the shared renderer',()=>{
 const doc=document(),page=createArtboard(doc,'Users',1440,1000)
 const frame=createCanvasNode(page,'Frame',{name:'Header',fill:'transparent',width:1000,height:80})
 const text=createCanvasNode(page,'Text',{name:'Title',text:'Users',fill:'#123456'},frame)
 changeCanvasNode(page,text,{text:'Customers',x:16,y:20})
 const parsed=structuredFrameSchema.parse(page.structured)
 expect(parsed.children[0].children[0].id).toBe(text)
 expect(parsed.children[0].children[0].parentId).toBe(frame)
 expect(renderStructuredFrameToHtml(parsed)).toContain('Customers')
 expect(renderStructuredFrameToHtml(parsed)).not.toContain('>Users<')
 bindToken(page,text,'fill',{id:'primary',name:'Primary',category:'color',value:'#123456',confidence:'full'})
 expect(page.structured?.children[0].children[0].tokenBindings?.color?.token).toBe('primary')
 const copy=duplicateArtboard(page,'Alternative')
 expect(copy.structured?.children[0].id).not.toBe(frame)
 expect(copy.structured?.children[0].children[0].parentId).toBe(copy.structured?.children[0].id)
 deleteCanvasNode(page,text)
 expect(page.structured?.children[0].children).toHaveLength(0)
})
test('vector remains a real path and locked nodes cannot be modified',()=>{
 const page=createArtboard(document(),'Icons',400,400)
 const id=createCanvasNode(page,'Vector',{path:'M0 0L24 24Z',viewBox:'0 0 24 24',fill:'#345'})
 expect(renderStructuredFrameToHtml(page.structured!)).toContain('M0 0L24 24Z')
 page.structured!.children[0].locked=true
 expect(()=>changeCanvasNode(page,id,{x:100})).toThrow('Unlock')
})
test('new children honour a previously assigned layout and preserve the authored origin',()=>{
 const page=createArtboard(document(),'Layout',800,600)
 const parent=createCanvasNode(page,'Frame',{width:500,height:100})
 changeCanvasNode(page,parent,{layout:{direction:'row',alignment:'start',distribution:'start',gap:16,padding:12,wrap:false,constraints:'left-top'}})
 createCanvasNode(page,'Text',{text:'First',width:80},parent)
 createCanvasNode(page,'Text',{text:'Second',width:100},parent)
 expect(page.structured?.children[0].children.map(n=>n.bounds.x)).toEqual([12,108])
 expect(page.structured?.captureMetadata.engine).toBe('design')
 expect(page.structured?.captureMetadata.visualMatch).toBeUndefined()
})
