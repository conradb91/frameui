import {test,expect} from 'bun:test'
import {layoutArtifactScreens} from '../../src/core/prototype/artifactLayout'
import type {VisualPage} from '../../src/shared/types/visualDesign'
import type {PrototypeData} from '../../src/shared/types/prototype'
const page=(id:string,height:number)=>({id,width:1440,height} as VisualPage)
test('journeys use directed depth, branch heights do not overlap, disconnected screens form a grid',()=>{
 const pages=[page('a',300),page('b',3000),page('c',800),...Array.from({length:6},(_,i)=>page('unlinked'+i,400+i*100))]
 const data={version:1,flows:[{artboardIds:pages.map(p=>p.id),positions:{}}],interactions:[{sourceArtboardId:'a',destinationId:'b'},{sourceArtboardId:'a',destinationId:'c'},{sourceArtboardId:'b',destinationId:'a'}]} as PrototypeData
 layoutArtifactScreens(pages,data)
 expect(pages[1].canvasX).toBeGreaterThan(pages[0].canvasX!)
 expect(pages[2].canvasX).toBe(pages[1].canvasX)
 expect(pages[2].canvasY).toBeGreaterThanOrEqual(pages[1].canvasY!+pages[1].height+160)
 expect(new Set(pages.slice(3).map(p=>p.canvasX)).size).toBe(4)
 for(let i=0;i<pages.length;i++)for(let j=i+1;j<pages.length;j++){
  const a=pages[i],b=pages[j]
  expect(a.canvasX!+a.width<=b.canvasX!||b.canvasX!+b.width<=a.canvasX!||a.canvasY!+a.height<=b.canvasY!||b.canvasY!+b.height<=a.canvasY!).toBe(true)
 }
 expect(data.flows[0].positions.b.x).toBeGreaterThan(data.flows[0].positions.a.x)
})
