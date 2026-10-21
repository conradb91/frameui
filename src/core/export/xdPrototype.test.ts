import {expect,test} from 'bun:test'
import {xdPrototype} from './xdPrototype'
import type {VisualDocument} from '../../shared/types/visualDesign'
test('XD keeps flow-local destinations and explicitly reports gesture simulations and hotspot conflicts',()=>{
 const pages=[{id:'a'},{id:'b'},{id:'c'}] as VisualDocument['pages']
 const document={pages,prototype:{flows:[{id:'flow',name:'View details',startArtboardId:'a',artboardIds:['a','b']}],interactions:[
 {id:'view',sourceArtboardId:'a',sourceElementId:'button',destinationId:'b',trigger:'click',action:'open-drawer',capturedView:true},
 {id:'hover',sourceArtboardId:'a',sourceElementId:'hint',destinationId:'b',trigger:'hover',action:'state',capturedView:true},
 {id:'conflict',sourceArtboardId:'a',sourceElementId:'button',destinationId:'c',trigger:'change',action:'state',capturedView:true},
 {id:'outside',sourceArtboardId:'b',sourceElementId:'other',destinationId:'c',trigger:'click',action:'navigate'},
 ]}} as VisualDocument
 const {interactions,report}=xdPrototype(document,pages.slice(0,2),id=>'xd-'+id,()=>{})
 expect(interactions['xd-a:button'][0]).toMatchObject({triggerEvent:'tap',action:'artboard-transition',properties:{destination:'xd-b'}})
 expect(interactions['xd-a:hint'][0].triggerEvent).toBe('tap')
 expect(report.simulated).toBe(2);expect(report.unsupported).toBe(2);expect(report.ready).toBe(false)
 expect(report.flows[0]).toMatchObject({start:'xd-a',artboards:['xd-a','xd-b']})
})
