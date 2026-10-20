import { parse } from 'culori'
import type { FrameUiExportNode, FrameUiPaint } from '@shared/types/frameuiExport'
import type { VisualPage } from '@shared/types/visualDesign'
/** Remove only proven synthetic, inert capture roots. Real DOM/layout groups remain editable. */
export function xdArtboardProjection(
  page: VisualPage,
  nodes: FrameUiExportNode[],
  interactionTargets: ReadonlySet<string>,
): { children: FrameUiExportNode[]; background?: FrameUiPaint } {
  const synthetic = new Set<string>()
  const scan = (children: NonNullable<VisualPage['structured']>['children']) => {
    for (const child of children) {
      if (child.source.tag === 'frameui-root') synthetic.add(child.id)
      scan(child.children)
    }
  }
  if (page.structured) scan(page.structured.children)
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const inert = (n: FrameUiExportNode) => {
    const a = n.captureAppearance
    const transform = a?.transform
    const matrix = transform
      ?.match(/^matrix\(([^)]+)\)$/)?.[1]
      .split(/[, ]+/)
      .map(Number)
    const identity =
      !transform ||
      transform === 'none' ||
      (matrix?.length === 6 && matrix.every((v, i) => near(v, [1, 0, 0, 1, 0, 0][i])))
    return (
      synthetic.has(n.id) &&
      !interactionTargets.has(n.id) &&
      identity &&
      near(n.x, 0) &&
      near(n.y, 0) &&
      near(n.width, page.width) &&
      near(n.height, page.height) &&
      near(n.opacity, 1) &&
      near(n.rotation, 0) &&
      n.visible &&
      !n.locked &&
      !n.component &&
      (!n.strokes.length || n.strokeWidth <= 0) &&
      !n.effects.length &&
      n.radius.every((r) => near(r, 0)) &&
      (!a?.clipPath || a.clipPath === 'none') &&
      (!a?.maskImage || a.maskImage === 'none') &&
      (!a?.filter || a.filter === 'none') &&
      (!a?.backdropFilter || a.backdropFilter === 'none') &&
      (!a?.mixBlendMode || a.mixBlendMode === 'normal')
    )
  }
  let background: FrameUiPaint | undefined
  const visit = (items: FrameUiExportNode[]): FrameUiExportNode[] =>
    items.flatMap((n, index) => {
      if (!inert(n)) return [n]
      if (n.fills.length) {
        const fill = n.fills[0]
        if (
          index !== 0 ||
          n.fills.length !== 1 ||
          fill.type !== 'SOLID' ||
          fill.opacity !== 1 ||
          !parse(fill.color) ||
          (parse(fill.color)?.alpha ?? 1) !== 1
        )
          return [n]
        background = fill
      }
      return visit(n.children)
    })
  return { children: visit(nodes), background }
}

type CanvasPage = Pick<VisualPage, 'id' | 'width' | 'height' | 'canvasX' | 'canvasY' | 'flowIntroductionFor'>
type Bounds = { x: number; y: number; width: number; height: number }
/** Use XD's full -25,000..25,000 canvas without scaling any artboard.
 * Translate a fitting composition intact; otherwise pack whole flow groups together.
 */
export function xdCanvasPlacement(pages: CanvasPage[], flows: {id:string;artboardIds:string[]}[] = []): { bounds: Map<string, Bounds>; rearranged: boolean } {
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
 // Each group is a small shelf composition. Try several widths, keeping the full canvas
 // available to the outer shelves rather than forcing everything into a narrow square.
 const shelf=(items:CanvasPage[],width:number)=>{
  let x=0,y=0,rowHeight=0,usedWidth=0
  const positions=new Map<string,Bounds>()
  for(const p of items){if(x&&x+p.width>width){x=0;y+=rowHeight+gap;rowHeight=0}positions.set(p.id,{x,y,width:p.width,height:p.height});usedWidth=Math.max(usedWidth,x+p.width);x+=p.width+gap;rowHeight=Math.max(rowHeight,p.height)}
  return {positions,width:usedWidth,height:y+rowHeight}
 }
 let best: {positions:Map<string,Bounds>;width:number;height:number;score:number}|undefined
 for(const groupWidth of [6000,10000,16000,24000,32000,limit]){
  const units=groups.map(g=>shelf(g,Math.max(groupWidth,...g.map(p=>p.width))))
  if(units.some(u=>u.height>limit||u.width>limit))continue
  let x=0,y=0,rowHeight=0,width=0
  const positions=new Map<string,Bounds>()
  for(const unit of units){
   if(x&&x+unit.width>limit){x=0;y+=rowHeight+gap;rowHeight=0}
   for(const [id,b] of unit.positions)positions.set(id,{...b,x:b.x+x,y:b.y+y})
   width=Math.max(width,x+unit.width);x+=unit.width+gap;rowHeight=Math.max(rowHeight,unit.height)
  }
  const height=y+rowHeight,score=Math.max(width,height)
  if(height<=limit&&(!best||score<best.score))best={positions,width,height,score}
 }
 if(!best)throw new Error('The selected flow groups exceed Adobe XD canvas limits. Export fewer flows; dimensions were not scaled.')
 for(const b of best.positions.values()){b.x-=best.width/2;b.y-=best.height/2}
 return {bounds:best.positions,rearranged:true}
}
