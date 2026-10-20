import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'

type BoundsUpdate = { id: string; bounds: Partial<StructuredNode['bounds']> }
type Box = { x: number; y: number; width: number; height: number }
type Target = { node: StructuredNode; el: HTMLElement | SVGElement; transform: string }
type Gesture = { pointer: number; x: number; y: number; dx: number; dy: number; zoom: number; box: Box; ids: string[]; targets: Target[]; direction?: string; marquee?: boolean; moved: boolean; shift: boolean }

/** Only gesture previews touch the DOM. One model/undo commit happens on release.
 * Hit testing uses the browser, not a measurement pass over every captured node. */
export function StructuredCanvasInteraction({frame,selected,onSelect,onCommitBounds,zoom,containerRef,editingId,enabled=true}: {
  frame: StructuredFrame; selected: string[]; onSelect:(ids:string[])=>void; onCommitBounds:(updates:BoundsUpdate[])=>void
  zoom:number; containerRef:RefObject<HTMLElement|null>; editingId?:string|null; enabled?:boolean
}) {
  const outline = useRef<HTMLDivElement>(null)
  const marquee = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture|null>(null)
  const raf = useRef(0)
  const space = useRef(false)
  const elements = useRef(new Map<string,HTMLElement|SVGElement>())
  const model = useMemo(()=>{
    const nodes = new Map<string,StructuredNode>(), parents = new Map<string,string>(), locked = new Set<string>()
    const walk=(items:StructuredNode[],parent?:string,parentLocked=false)=>items.forEach(node=>{
      nodes.set(node.id,node);if(parent)parents.set(node.id,parent)
      if(parentLocked||node.locked)locked.add(node.id)
      walk(node.children,node.id,parentLocked||node.locked)
    });walk(frame.children);return {nodes,parents,locked}
  },[frame.children])
  const live = useRef({selected,onSelect,onCommitBounds,zoom,editingId,enabled,model})
  live.current = {selected,onSelect,onCommitBounds,zoom,editingId,enabled,model}
  const topLevel=useCallback((ids:string[]) => {
    const set=new Set(ids)
    return ids.filter(id=>{let parent=live.current.model.parents.get(id);while(parent){if(set.has(parent))return false;parent=live.current.model.parents.get(parent)}return true})
  },[])
  const targets=useCallback((ids:string[]) => {return topLevel(ids).flatMap(id=>{
    const node=live.current.model.nodes.get(id)
    const el=elements.current.get(id) ?? containerRef.current?.querySelector<HTMLElement|SVGElement>(`[data-structured-frame="${CSS.escape(frame.id)}"] [data-structured-id="${CSS.escape(id)}"]`)
    if(el) elements.current.set(id,el)
    return node&&el&&!live.current.model.locked.has(id)&&el.dataset.structuredDraggable==='true'?[{node,el,transform:el.style.transform}]:[]
  })},[containerRef,frame.id,topLevel])
  const boxFor=useCallback((items:Target[]):Box|null => {
    const stage=containerRef.current;if(!stage||!items.length)return null
    const origin=stage.getBoundingClientRect(), boxes=items.map(t=>t.el.getBoundingClientRect())
    const x=Math.min(...boxes.map(b=>b.left)),y=Math.min(...boxes.map(b=>b.top))
    return {x:x-origin.left,y:y-origin.top,width:Math.max(...boxes.map(b=>b.right))-x,height:Math.max(...boxes.map(b=>b.bottom))-y}
  },[containerRef])
  function showBox(box:Box|null,count=0) {
    const el=outline.current;if(!el)return
    el.hidden=!box;if(!box)return
    // The outline follows actual geometry; the single tiny-object handle sits
    // outside it, leaving the object itself available for clicking/dragging.
    Object.assign(el.style,{transform:`translate(${box.x}px, ${box.y}px)`,width:`${Math.max(1,box.width)}px`,height:`${Math.max(1,box.height)}px`})
    el.dataset.tiny=String(box.width<40||box.height<28)
    el.dataset.resizable=String(count===1)
  }
  useLayoutEffect(()=>{
    const stage=containerRef.current
    elements.current=new Map(Array.from(stage?.querySelectorAll<HTMLElement|SVGElement>(`[data-structured-frame="${CSS.escape(frame.id)}"] [data-structured-id]`)??[]).map(el=>[el.dataset.structuredId!,el]))
  },[frame,editingId,containerRef])
  useLayoutEffect(()=>{
    if(gesture.current)return
    const list=targets(selected)
    showBox(enabled&&!editingId?boxFor(list):null,list.length)
  })
  useEffect(()=>{
    const stage=containerRef.current;if(!stage)return
    // Parent refs attach after child layout effects on first mount. Populate
    // here as well so the first press and marquee already have live targets.
    elements.current=new Map(Array.from(stage.querySelectorAll<HTMLElement|SVGElement>(`[data-structured-frame="${CSS.escape(frame.id)}"] [data-structured-id]`)).map(el=>[el.dataset.structuredId!,el]))
    function draw() {
      raf.current=0;const g=gesture.current;if(!g)return
      let dx=g.dx,dy=g.dy
      if(g.shift&&!g.direction&&!g.marquee) {if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0}
      if(g.marquee){const box=marquee.current;if(box){box.hidden=false;Object.assign(box.style,{left:`${g.box.x+Math.min(0,dx)}px`,top:`${g.box.y+Math.min(0,dy)}px`,width:`${Math.abs(dx)}px`,height:`${Math.abs(dy)}px`})}return}
      let box={...g.box,x:g.box.x+dx,y:g.box.y+dy}
      if(g.direction){
        const t=g.targets[0],west=g.direction.includes('w'),north=g.direction.includes('n')
        const width=Math.max(1,t.node.bounds.width+(west?-dx:dx)/g.zoom),height=Math.max(1,t.node.bounds.height+(north?-dy:dy)/g.zoom)
        dx=west?(t.node.bounds.width-width)*g.zoom:0;dy=north?(t.node.bounds.height-height)*g.zoom:0
        t.el.style.width=`${width}px`;t.el.style.height=`${height}px`
        box={x:g.box.x+dx,y:g.box.y+dy,width:width*g.zoom,height:height*g.zoom}
      }
      for(const t of g.targets)t.el.style.transform=`translate(${dx/g.zoom}px, ${dy/g.zoom}px) ${t.transform}`
      showBox(box,g.targets.length)
    }
    function down(e:PointerEvent) {
      const state=live.current,target=e.target as Element
      if(!state.enabled||state.editingId||space.current||e.button!==0||target.closest('.ide-tools,[contenteditable="true"]'))return
      const owner=target.closest('[data-structured-frame]')
      if(owner&&owner.getAttribute('data-structured-frame')!==frame.id)return
      const direction=target.closest('[data-structured-resize]')?.getAttribute('data-structured-resize')
      // A captured SVG is a single icon by default, not a collection of tiny paths.
      const direct=target.closest('svg[data-structured-id]')??target.closest('[data-structured-id]')
      if(!direct&&!direction && (target.closest('[data-object-id],[data-selection-id],[data-handle],[data-frame-resize-handle],[data-canvas-surface],.ide-canvas-frame-title-wrap')||!target.closest('svg')))return
      const id=direct?.getAttribute('data-structured-id');let ids=state.selected
      if(id&&state.model.locked.has(id))return
      if(id&&!direction)ids=e.shiftKey?(ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]):ids.includes(id)?ids:[id]
      if(direction&&!ids.length)return
      if (id && !ids.length) { e.stopPropagation(); live.current.onSelect([]); showBox(null); return }
      const list=targets(ids),origin=stage!.getBoundingClientRect()
      const isMarquee=!direct&&!direction
      const box=isMarquee?{x:e.clientX-origin.left,y:e.clientY-origin.top,width:0,height:0}:boxFor(list)
      if(!box)return
      e.stopPropagation()
      gesture.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,dx:0,dy:0,zoom:state.zoom,box,ids:isMarquee?(e.shiftKey?[...ids]:[]):ids,targets:list,direction:direction??undefined,marquee:isMarquee,moved:false,shift:e.shiftKey}
      if(!isMarquee)showBox(box,list.length)
      // Do not capture/prevent the initial click: native double-click must
      // still reach the text node. Capture starts only beyond the drag threshold.
    }
    function move(e:PointerEvent) {
      const g=gesture.current;if(!g||g.pointer!==e.pointerId)return
      g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;g.shift=e.shiftKey
      if(!g.moved&&Math.hypot(g.dx,g.dy)<3)return
      g.moved=true;e.preventDefault();e.stopPropagation()
      if(!stage!.hasPointerCapture(e.pointerId))stage!.setPointerCapture(e.pointerId)
      stage!.classList.add('ide-direct-dragging')
      if(!raf.current)raf.current=requestAnimationFrame(draw)
    }
    function finish(cancel=false) {
      const g=gesture.current;if(!g)return
      cancelAnimationFrame(raf.current);raf.current=0
      if(g.moved)draw()
      gesture.current=null
      if(stage!.hasPointerCapture(g.pointer))stage!.releasePointerCapture(g.pointer)
      stage!.classList.remove('ide-direct-dragging')
      if(marquee.current)marquee.current.hidden=true
      let ids=g.ids,updates:BoundsUpdate[]=[]
      if(g.moved&&!cancel){
        if(g.marquee){
          const origin=stage!.getBoundingClientRect(),x=g.box.x+Math.min(0,g.dx)+origin.left,y=g.box.y+Math.min(0,g.dy)+origin.top,w=Math.abs(g.dx),h=Math.abs(g.dy)
          for(const [id,el] of elements.current){if(live.current.model.locked.has(id)||el.dataset.structuredDraggable!=='true')continue;const b=el.getBoundingClientRect();if(b.width&&b.height&&b.left>=x&&b.top>=y&&b.right<=x+w&&b.bottom<=y+h)ids.push(id)}
          ids=topLevel([...new Set(ids)])
        } else updates=g.targets.map(t=>{
          let dx=g.dx/g.zoom,dy=g.dy/g.zoom
          if(g.shift&&!g.direction){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0}
          if(g.direction){const width=parseFloat(t.el.style.width),height=parseFloat(t.el.style.height);return{id:t.node.id,bounds:{width,height,x:t.node.bounds.x+(g.direction.includes('w')?t.node.bounds.width-width:0),y:t.node.bounds.y+(g.direction.includes('n')?t.node.bounds.height-height:0)}}}
          return{id:t.node.id,bounds:{x:t.node.bounds.x+dx,y:t.node.bounds.y+dy}}
        })
      }
      // Restore previews before React commits identical final geometry.
      for(const t of g.targets){t.el.style.transform=t.transform;if(g.direction){t.el.style.width=`${t.node.bounds.width}px`;t.el.style.height=`${t.node.bounds.height}px`}}
      if(!cancel)flushSync(()=>{if(updates.length)live.current.onCommitBounds(updates);if(ids.length!==live.current.selected.length||ids.some((id,i)=>id!==live.current.selected[i]))live.current.onSelect(ids)})
      const list=targets(cancel?live.current.selected:ids);showBox(boxFor(list),list.length)
    }
    const up=(e:PointerEvent)=>{if(gesture.current?.pointer===e.pointerId)finish()}
    const cancel=()=>finish(true)
    const keydown=(e:KeyboardEvent)=>{if(e.code==='Space')space.current=true;if(e.key==='Escape'&&gesture.current){e.preventDefault();e.stopPropagation();finish(true)}}
    const keyup=(e:KeyboardEvent)=>{if(e.code==='Space')space.current=false}
    const blur=()=>{space.current=false;finish(true)}
    stage.addEventListener('pointerdown',down,true)
    window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true)
    window.addEventListener('keydown',keydown,true);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur)
    return()=>{cancel();stage.removeEventListener('pointerdown',down,true);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('keydown',keydown,true);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur)}
  },[containerRef,frame.id,targets,boxFor,topLevel])
  return <><div ref={outline} hidden className="ide-direct-selection" aria-label="Selected captured objects">{['nw','ne','sw','se'].map(direction=><button key={direction} type="button" data-structured-resize={direction} className={`ide-direct-handle ${direction}`} aria-label={`Resize selection ${direction}`} tabIndex={-1}/>)}</div><div ref={marquee} hidden className="ide-direct-marquee"/></>
}
