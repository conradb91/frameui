import {test,expect} from 'bun:test'
import {buildXdDocument} from '../../src/core/export/xdDocument'
import {visualDocumentSchema} from '../../src/core/visual/schema'
import {artifactFlow} from '../../src/core/prototype/artifactFlow'
import {arrangeImportedScreens} from '../../src/core/prototype/importLayout'
import {prototypeSchema} from '../../src/core/prototype/schema'
import type {VisualPage,VisualDocument} from '../../src/shared/types/visualDesign'
const page=(id:string,height=800):VisualPage=>({id,name:id,route:'/'+id,width:1440,height,objects:[],folder:'',pinned:false,state:'Desktop',structured:{id:'frame-'+id,name:id,width:1440,height,children:['a','b','next'].map(k=>({id:id+'-'+k,source:{selector:k},children:[]}))} as any})
test('imported action journeys get editable white guide frames and non-overlapping screen groups',()=>{
 const pages=[page('home'),page('search',1800),page('details'),page('cart'),page('standalone')]
 const data=artifactFlow(pages,[{source:'/home',destination:'/search',selector:'a',label:'Search courses'},{source:'/home',destination:'/cart',selector:'b',label:'View cart'},{source:'/search',destination:'/details',selector:'next',label:'View details'},{source:'/details',destination:'/home',selector:'a',label:'Back'}],'Academy')
 expect(data.flows.map(f=>f.name)).toEqual(['Search courses','View cart','standalone'])
 expect(prototypeSchema.safeParse(data).success).toBe(true)
 const guides=pages.filter(p=>p.flowIntroductionFor)
 expect(guides).toHaveLength(3)
 const persisted=visualDocumentSchema.parse({version:1,id:'guides-save',name:'Guides',updatedAt:'now',pages:guides,components:[],variables:[]})
 expect(persisted.pages.map(p=>p.flowIntroductionFor)).toEqual(guides.map(p=>p.flowIntroductionFor))
 expect(guides[0].name).toBe('Flow 1 · Search courses')
 expect(guides[0].objects.map(n=>n.text).join(' ')).toContain('Select “Search courses”')
 expect(guides.every(g=>!data.flows.some(f=>f.artboardIds.includes(g.id)||f.startArtboardId===g.id))).toBe(true)
 expect(pages.filter(p=>p.id==='home')).toHaveLength(1)
 const exported=buildXdDocument({jobId:'flow-guides',scope:'all',includePrototype:false,document:{version:1,id:'guide-export',name:'Guides',updatedAt:'now',pages:guides,components:[],variables:[]}})
 const native=exported.entries.filter(e=>e.path.startsWith('artwork/')&&e.path.endsWith('.agc')).map(e=>e.data.toString()).join('')
 expect(native).toContain('FLOW 1');expect(native).toContain('Search courses');expect(exported.report.editableText).toBe(9)
 for(let i=0;i<pages.length;i++)for(let j=i+1;j<pages.length;j++){const a=pages[i],b=pages[j];expect(a.canvasX!+a.width<=b.canvasX!||b.canvasX!+b.width<=a.canvasX!||a.canvasY!+a.height<=b.canvasY!||b.canvasY!+b.height<=a.canvasY!).toBe(true)}
})
test('approved flow import adds guides without moving existing canvas work or playable start',()=>{
 const old=page('existing');old.canvasX=110;old.canvasY=220
 const current={pages:[old]} as VisualDocument,next={pages:[structuredClone(old),page('new')],prototype:{version:1,flows:[{id:'flow',name:'Open details',description:'Select the details button.',startArtboardId:'existing',artboardIds:['existing','new'],positions:{existing:{x:20,y:40}},createdAt:'now',updatedAt:'now'}],interactions:[{id:'link',sourceArtboardId:'existing',destinationId:'new',trigger:'click',action:'navigate',transition:'instant'}],variables:{},scenarios:[],imports:[]}} as VisualDocument
 arrangeImportedScreens(current,next)
 expect(next.pages[0]).toEqual(old)
 expect(next.pages.filter(p=>p.flowIntroductionFor)).toHaveLength(1)
 expect(next.prototype!.flows[0].startArtboardId).toBe('existing')
 expect(next.prototype!.flows[0].positions.existing).toEqual({x:20,y:40})
 const again=structuredClone(next);arrangeImportedScreens(next,again);expect(again).toEqual(next)
})
