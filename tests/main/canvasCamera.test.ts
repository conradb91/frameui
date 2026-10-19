import {test,expect} from 'bun:test'
import {zoomAt} from '../../src/core/visual/camera'
test('zoom keeps the same canvas point under the cursor or viewport centre, including overview scales',()=>{
 const anchor={x:350,y:240},start={x:-4000,y:-200,zoom:.02};let current=start
 for(let i=0;i<100;i++){current=zoomAt(current,current.zoom*1.01,anchor);expect(Math.abs((anchor.x-current.x)/current.zoom-(anchor.x-start.x)/start.zoom)).toBeLessThan(.000001)}
 expect(zoomAt(start,start.zoom*.8,anchor).zoom).toBeLessThan(start.zoom)
 expect(zoomAt(start,0,anchor).zoom).toBe(.001)
})
