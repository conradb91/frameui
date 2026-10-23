import {test,expect} from 'bun:test'
import {createHash as nodeHash} from 'node:crypto'
import {createHash} from '../../integrations/chrome-extension/src/crypto'
import {recordedFlow} from '../../integrations/chrome-extension/src/flow'
import {chromeCaptureDocument} from '../../src/core/prototype/chromeCapture'
import {packDocument} from '../../src/shared/documentResources'
import type {VisualPage} from '../../src/shared/types/visualDesign'
const page=(id:string):VisualPage=>({id,name:id,route:'/'+id,folder:'',state:'Desktop',pinned:false,width:1440,height:900,objects:[]})
test('browser hash adapter produces native XD resource hashes byte-for-byte',()=>{
 for(const algorithm of ['md5','sha256'])for(const data of ['', 'FrameUI 🛳️',new Uint8Array([0,255,10,128])])expect(createHash(algorithm).update(data).digest('hex')).toBe(nodeHash(algorithm).update(data).digest('hex'))
 expect(()=>createHash('unsupported')).toThrow()
})
test('recorded tab, modal and disclosure states remain one ordered journey',()=>{
 const pages=['home','tab','modal','closed','expanded'].map(page),transitions=pages.slice(1).map((p,i)=>({source:pages[i].route,destination:p.route,selector:'#control',label:'Open '+p.id,componentType:i===0?'tab':'button',kind:['tab','modal','modal','disclosure'][i],action:i===1?'open-modal':'state',trigger:'click'}))
 const data=recordedFlow(pages,{name:'Journey',transitions,journeys:[{id:'flow',name:'Journey',pageIds:pages.map(p=>p.id)}]})
 expect(data.flows).toHaveLength(1);expect(data.flows[0].artboardIds).toEqual(['home','tab','modal','closed','expanded']);expect(data.interactions).toHaveLength(4)
 expect(pages.filter(p=>p.flowIntroductionFor)).toHaveLength(1)
 for(let i=1;i<5;i++)expect(pages[i].canvasX).toBeGreaterThan(pages[i-1].canvasX!)
 expect(data.coverage?.complete).toBe(false);expect(data.coverage?.failed).toBe(4)
})
test('separate follow-flow recordings stay in separate flows',()=>{
 const pages=['a','b','c','d'].map(page),data=recordedFlow(pages,{name:'Work',transitions:[],journeys:[{id:'one',name:'First',pageIds:['a','b']},{id:'two',name:'Second',pageIds:['c','d']}]})
 expect(data.flows.map(f=>f.artboardIds)).toEqual([['a','b'],['c','d']]);expect(pages[2].canvasY).toBeGreaterThan(pages[0].canvasY!+pages[0].height)
})
test('desktop capture import validates the envelope and isolates source document ownership',()=>{
 const source={version:1,id:'old',name:'Capture',projectId:'source-project',libraryId:'source-library',updatedAt:'now',pages:[page('a')],components:[],variables:[]}
 const imported=chromeCaptureDocument({format:'frameui-chrome-capture',version:1,document:packDocument(source)})
 expect(imported.id).not.toBe('old');expect(imported.projectId).toBeUndefined();expect(imported.libraryId).toBeUndefined();expect(imported.pages).toEqual(source.pages)
 expect(()=>chromeCaptureDocument(source)).toThrow();expect(()=>chromeCaptureDocument({format:'frameui-chrome-capture',version:1,document:{...source,pages:[]}})).toThrow('no screens')
 expect(()=>chromeCaptureDocument({format:'frameui-chrome-capture',version:1,document:{...source,pages:[{id:'invalid'}]}})).toThrow()
})
