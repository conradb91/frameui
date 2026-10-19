import {test,expect} from 'bun:test'
import {applicationAddress} from '../../src/core/runtime/address'
import {createArtboard,createCanvasNode,addScreenToDocument} from '../../src/core/ai/canvas'
import {visualDocumentSchema} from '../../src/core/visual/schema'
import type {VisualDocument} from '../../src/shared/types/visualDesign'
const blank=():VisualDocument=>({version:1,id:'design',name:'Draft',updatedAt:'1',pages:[],components:[],variables:[]})
test('app entry accepts localhost and HTTPS hosted domains while rejecting insecure or credentialed addresses',()=>{
 expect(applicationAddress(' localhost:3000 ')).toBe('http://localhost:3000/')
 expect(applicationAddress('[::1]:5173')).toBe('http://[::1]:5173/')
 expect(applicationAddress('product.localhost:3000')).toBe('http://product.localhost:3000/')
 expect(applicationAddress('app.example.com/products')).toBe('https://app.example.com/products')
 expect(applicationAddress('https://staging.example.com')).toBe('https://staging.example.com/')
 for(const invalid of ['', 'http://example.com', 'https://name:secret@example.com','file:///tmp/test.html','ftp://example.com'])expect(()=>applicationAddress(invalid)).toThrow()
})
test('starting a design from a native capture preserves editable trees, fonts and independent identifiers',()=>{
 const library=blank(),page=createArtboard(library,'Dashboard',1440,900)
 createCanvasNode(page,'Text',{text:'Editable title',name:'Title',x:24,y:24,width:400,height:50})
 page.fonts=[{family:'Project Sans',weight:'400',style:'normal',data:'data:font/woff2;base64,AA=='}]
 const design=blank();createArtboard(design,'Untitled',1440,900)
 const added=addScreenToDocument(design,page)
 expect(design.pages).toHaveLength(1)
 expect(added.structured?.children[0].typography?.text).toBe('Editable title')
 expect(added.structured?.children[0].id).not.toBe(page.structured?.children[0].id)
 expect(added.id).not.toBe(page.id)
 expect(added.fonts).toEqual(page.fonts)
 expect(added.canvasX).toBe(0)
 visualDocumentSchema.parse(design)
 added.structured!.children[0].typography!.text='New idea'
 expect(page.structured?.children[0].typography?.text).toBe('Editable title')
})
test('adding another capture preserves existing design artboards and places new screens without overlap',()=>{
 const doc=blank(),existing=createArtboard(doc,'Existing',390,844)
 createCanvasNode(existing,'Text',{text:'Keep my edits'})
 existing.canvasX=1000
 const library=blank(),captured=createArtboard(library,'Captured',390,844)
 createCanvasNode(captured,'Text',{text:'New capture'})
 const next=addScreenToDocument(doc,captured)
 expect(doc.pages).toHaveLength(2)
 expect(doc.pages[0]).toBe(existing)
 expect(next.canvasX).toBeGreaterThan(existing.canvasX+existing.width)
})
test('new prototype input retains readable typography independently of its background',()=>{
 const doc=blank(),page=createArtboard(doc,'Form',390,844)
 createCanvasNode(page,'Input',{text:'Readable field',fill:'#ffffff',fontFamily:'Arial',fontSize:18,lineHeight:24,width:300,height:44,radius:[10,10,10,10]})
 const input=page.structured!.children[0]
 expect(input.source.control?.value).toBe('Readable field')
 expect(input.appearance.backgroundColor).toBe('#ffffff')
 expect(input.appearance.radius).toEqual([10,10,10,10])
 expect(input.typography).toMatchObject({fontSize:18,lineHeight:24,color:'#111827'})
})
