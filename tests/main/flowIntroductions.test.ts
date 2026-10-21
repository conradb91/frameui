import {test,expect} from 'bun:test'
import {buildXdDocument} from '../../src/core/export/xdDocument'
import {visualDocumentSchema} from '../../src/core/visual/schema'
import {flowSteps,upgradeFlowGuides} from '../../src/core/prototype/flowIntroductions'
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
 expect(native).toContain('FLOW 1');expect(native).toContain('Search courses');expect(exported.report.editableText).toBe(guides.reduce((sum,g)=>sum+g.objects.length,0))
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

test('flow documentation explains observed controls and results without including sibling branches',()=>{
 const pages=[page('home'),page('search'),page('details'),page('cart')]
 const data=artifactFlow(pages,[{source:'/home',destination:'/search',selector:'a',label:'Search courses'},{source:'/home',destination:'/cart',selector:'b',label:'View cart'},{source:'/search',destination:'/details',selector:'next',label:'View course details'}],'Academy')
 const steps=flowSteps(pages,data.flows[0],data).join(' ')
 expect(steps).toContain('On “home”: Select “Search courses” → show “search”.')
 expect(steps).toContain('On “search”: Select “View course details” → show “details”.')
 expect(steps).not.toContain('View cart')
 const guide=pages.find(p=>p.flowIntroductionFor===data.flows[0].id)!
 expect(guide.objects.map(o=>o.text).join(' ')).toContain('2. Select “View course details”')
 for(let i=1;i<guide.objects.length;i++)expect(guide.objects[i].y).toBeGreaterThanOrEqual(guide.objects[i-1].y+guide.objects[i-1].height)
 expect(guide.height).toBeGreaterThan(guide.objects.at(-1)!.y+guide.objects.at(-1)!.height)
})

test('legacy guide upgrade keeps user content and screen positions while avoiding expanded-card overlap',()=>{
 const home=page('home'),details=page('details');home.canvasX=1680;home.canvasY=0;details.canvasX=1680;details.canvasY=1200
 const data=prototypeSchema.parse({version:1,flows:[{id:'flow',name:'View details',description:'Select details to continue.',startArtboardId:'home',artboardIds:['home','details'],positions:{},createdAt:'now',updatedAt:'now'}],interactions:[{id:'edge',sourceArtboardId:'home',destinationId:'details',trigger:'click',action:'open-modal',label:'View details'}],variables:{},scenarios:[],imports:[]})
 const legacy={...page('guide',300),flowIntroductionFor:'flow',canvasX:0,canvasY:0,objects:[{name:'Flow number',text:'FLOW 1'},{name:'Flow title',text:'View details'},{name:'Flow description',text:'Select details to continue.'}]} as VisualPage
 const another={...page('other',400),canvasX:0,canvasY:350}
 const pages=[home,details,legacy,another],upgraded=upgradeFlowGuides(pages,data)
 expect(upgraded[0]).toBe(home);expect(upgraded[1]).toBe(details)
 const guide=upgraded[2]
 expect(guide.id).toBe('guide');expect(guide.objects.map(o=>o.text).join(' ')).toContain('Select “View details” → open “details”')
 expect(guide.canvasY!+guide.height).toBeLessThanOrEqual(0)
 expect(upgradeFlowGuides(upgraded,data)).toBe(upgraded)
 const edited={...legacy,objects:legacy.objects.map((o,i)=>i===2?{...o,text:'My own guide notes'}:o)}
 expect(upgradeFlowGuides([home,details,edited],data)[2]).toBe(edited)
 expect(legacy.objects).toHaveLength(3)
})

test('captured button names use the visible title and strip icon-font glyphs from flow descriptions',()=>{
 const home=page('home'),details=page('details')
 home.structured!.children[0].children=[{id:'button-title',source:{tag:'b'},typography:{text:'Choose accounts'},children:[]}] as any
 const data=artifactFlow([home,details],[{source:'/home',destination:'/details',selector:'a',label:'\uec30Choose accountsA long explanatory subtitle\ue9ec'}],'Actuals')
 expect(data.interactions[0].label).toBe('Choose accounts')
 expect(data.flows[0].name).toBe('Choose accounts')
})
