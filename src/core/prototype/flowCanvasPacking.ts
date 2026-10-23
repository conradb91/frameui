import type {VisualPage} from '../../shared/types/visualDesign'
type CanvasPage = Pick<VisualPage, 'id' | 'width' | 'height' | 'canvasX' | 'canvasY' | 'flowIntroductionFor'>
type Bounds = { x: number; y: number; width: number; height: number }
/** Use XD's full -25,000..25,000 canvas without scaling any artboard.
 * Translate a fitting composition intact; otherwise pack whole flow groups together.
 */
export function boundedFlowPlacement(pages: CanvasPage[], flows: {id:string;artboardIds:string[]}[] = []): { bounds: Map<string, Bounds>; rearranged: boolean } {
 const gap=240, limit=49000
 const bounds=new Map(pages.map((p,i)=>[p.id,{x:p.canvasX??i*(p.width+gap),y:p.canvasY??0,width:p.width,height:p.height}]))
 if(!pages.length)return {bounds,rearranged:false}
 for(const p of pages)if(p.width>limit||p.height>limit)throw new Error('An artboard exceeds Adobe XD canvas limits. Split the source screen before exporting; dimensions were not scaled.')
 const values=[...bounds.values()],left=Math.min(...values.map(b=>b.x)),top=Math.min(...values.map(b=>b.y)),right=Math.max(...values.map(b=>b.x+b.width)),bottom=Math.max(...values.map(b=>b.y+b.height))
 if(right-left<=limit&&bottom-top<=limit){
  if(values.every(b=>b.x>=-25000&&b.y>=-25000&&b.x+b.width<=25000&&b.y+b.height<=25000))return {bounds,rearranged:false}
  const dx=-(left+right)/2,dy=-(top+bottom)/2
  for(const b of values){b.x+=dx;b.y+=dy}
  return {bounds,rearranged:true}
 }
 const byId=new Map(pages.map(p=>[p.id,p])),placed=new Set<string>()
 const groups:CanvasPage[][]=[]
 for(const flow of flows){
  const guide=pages.find(p=>p.flowIntroductionFor===flow.id)
  const ids=[...(guide?[guide.id]:[]),...flow.artboardIds]
  const group=ids.flatMap(id=>{const p=byId.get(id);if(!p||placed.has(id))return [];placed.add(id);return [p]})
  if(group.length)groups.push(group)
 }
 for(const p of pages)if(!placed.has(p.id))groups.push([p])
 // Translate whole journeys as rigid units. Never reorder screens inside a flow.
 const units=groups.map(group=>{
  const items=group.map(p=>[p.id,bounds.get(p.id)!] as const)
  const x=Math.min(...items.map(([,b])=>b.x)),y=Math.min(...items.map(([,b])=>b.y))
  const width=Math.max(...items.map(([,b])=>b.x+b.width))-x,height=Math.max(...items.map(([,b])=>b.y+b.height))-y
  return {width,height,positions:new Map(items.map(([id,b])=>[id,{...b,x:b.x-x,y:b.y-y}]))}
 })
 if(units.some(u=>u.width>limit||u.height>limit))throw new Error('A flow exceeds Adobe XD canvas limits. Export a smaller flow; its screen arrangement was not changed.')
 let best:{positions:Map<string,Bounds>;width:number;height:number;score:number}|undefined
 // Maximal free rectangles let short flows use the space beside tall journeys.
 // Whole groups translate together: no scaling, rotation or internal reordering.
 for(const canvasWidth of [10000,16000,24000,32000,limit]){
  type Rect={x:number;y:number;width:number;height:number}
  let free:Rect[]=[{x:0,y:0,width:canvasWidth+gap,height:limit+gap}],width=0,height=0,failed=false
  const positions=new Map<string,Bounds>()
  const ordered=[...units].sort((a,b)=>Math.max(b.width,b.height)-Math.max(a.width,a.height)||b.width*b.height-a.width*a.height)
  for(const unit of ordered){
   const w=unit.width+gap,h=unit.height+gap
   const candidates=free.filter(r=>w<=r.width&&h<=r.height).map(r=>({r,short:Math.min(r.width-w,r.height-h),long:Math.max(r.width-w,r.height-h)})).sort((a,b)=>a.short-b.short||a.long-b.long||a.r.y-b.r.y||a.r.x-b.r.x)
   const spot=candidates[0]?.r;if(!spot){failed=true;break}
   const used={x:spot.x,y:spot.y,width:w,height:h},next:Rect[]=[]
   for(const r of free){
    if(used.x>=r.x+r.width||used.x+used.width<=r.x||used.y>=r.y+r.height||used.y+used.height<=r.y){next.push(r);continue}
    if(used.x>r.x)next.push({...r,width:used.x-r.x})
    if(used.x+used.width<r.x+r.width)next.push({...r,x:used.x+used.width,width:r.x+r.width-used.x-used.width})
    if(used.y>r.y)next.push({...r,height:used.y-r.y})
    if(used.y+used.height<r.y+r.height)next.push({...r,y:used.y+used.height,height:r.y+r.height-used.y-used.height})
   }
   const unique=[...new Map(next.map(r=>[JSON.stringify(r),r])).values()]
   free=unique.filter((a,i)=>!unique.some((b,j)=>i!==j&&a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height))
   for(const [id,b] of unit.positions)positions.set(id,{...b,x:b.x+used.x,y:b.y+used.y})
   width=Math.max(width,used.x+unit.width);height=Math.max(height,used.y+unit.height)
  }
  const score=Math.max(width,height)
  if(!failed&&width<=limit&&height<=limit&&(!best||score<best.score))best={positions,width,height,score}
 }
 if(!best)throw new Error('The selected flow groups exceed Adobe XD canvas limits. Export fewer flows; dimensions were not scaled.')
 for(const b of best.positions.values()){b.x-=best.width/2;b.y-=best.height/2}
 return {bounds:best.positions,rearranged:true}
}
