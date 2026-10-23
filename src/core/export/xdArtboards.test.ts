import {expect,test} from 'bun:test'
import {xdCanvasPlacement} from './xdArtboards'
const valid=(bounds:ReturnType<typeof xdCanvasPlacement>['bounds'])=>{
 const all=[...bounds.values()]
 for(const b of all){expect(b.x).toBeGreaterThanOrEqual(-25000);expect(b.y).toBeGreaterThanOrEqual(-25000);expect(b.x+b.width).toBeLessThanOrEqual(25000);expect(b.y+b.height).toBeLessThanOrEqual(25000)}
 for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){const a=all[i],b=all[j];expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true)}
}
test('off-origin composition translates intact instead of separating its flow guide',()=>{
 const pages=[{id:'guide',width:1440,height:1000,canvasX:80000,canvasY:80000},{id:'screen',width:1440,height:5000,canvasX:81680,canvasY:80000}]
 const {bounds}=xdCanvasPlacement(pages)
 valid(bounds);expect(bounds.get('screen')!.x-bounds.get('guide')!.x).toBe(1680);expect(bounds.get('screen')!.y).toBe(bounds.get('guide')!.y)
})
test('large journeys retain adjacent flow guides and original dimensions across the full XD canvas',()=>{
 const pages=Array.from({length:8},(_,i)=>[{id:`guide${i}`,flowIntroductionFor:`flow${i}`,width:1440,height:1200,canvasX:0,canvasY:i*12000},...Array.from({length:5},(_,j)=>({id:`screen${i}-${j}`,width:1440,height:8000,canvasX:(j+1)*1680,canvasY:i*12000}))]).flat()
 const flows=Array.from({length:8},(_,i)=>({id:`flow${i}`,artboardIds:Array.from({length:5},(_,j)=>`screen${i}-${j}`)}))
 const {bounds,rearranged}=xdCanvasPlacement(pages,flows)
 expect(rearranged).toBe(true);valid(bounds)
 for(const p of pages){expect(bounds.get(p.id)!.width).toBe(p.width);expect(bounds.get(p.id)!.height).toBe(p.height)}
 for(let i=0;i<8;i++){const g=bounds.get(`guide${i}`)!,first=bounds.get(`screen${i}-0`)!;expect(first.x).toBe(g.x+1680);expect(first.y).toBe(g.y)}
})
test('XD refuses an oversized journey instead of silently rearranging its screens',()=>{
 const pages=[{id:'a',width:1440,height:900,canvasX:0,canvasY:0},{id:'b',width:1440,height:900,canvasX:60000,canvasY:0}]
 expect(()=>xdCanvasPlacement(pages,[{id:'flow',artboardIds:['a','b']}])).toThrow('screen arrangement was not changed')
})

test('tall flows and many short flows fit together without losing their arrangement',()=>{
 const units=Array.from({length:50},(_,i)=>({id:'p'+i,width:i===0||i===25?4720:3080,height:i===0?35984:i===25?30860:2678,canvasX:0,canvasY:i*40000}))
 const flows=units.map(p=>({id:'flow'+p.id,artboardIds:[p.id]}))
 const {bounds,rearranged}=xdCanvasPlacement(units,flows)
 expect(rearranged).toBe(true);valid(bounds)
 for(const p of units){expect(bounds.get(p.id)!.width).toBe(p.width);expect(bounds.get(p.id)!.height).toBe(p.height)}
})
