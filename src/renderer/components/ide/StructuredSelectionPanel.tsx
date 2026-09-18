import { memo } from 'react'
import { ChevronDown, Frame, Lock, Type } from 'lucide-react'
import type { StructuredNode } from '@shared/types/structuredDesign'

export const StructuredLayers = memo(function StructuredLayers({ nodes, selected, query, onSelect, depth = 0 }: {
  nodes: StructuredNode[]; selected: string[]; query: string; onSelect: (ids: string[]) => void; depth?: number
}) {
  const matches = (node: StructuredNode): boolean => !query || node.name.toLowerCase().includes(query.toLowerCase()) || node.children.some(matches)
  const containsSelection = (node: StructuredNode): boolean => selected.includes(node.id) || node.children.some(containsSelection)
  return <>{nodes.filter(matches).map(node => <details key={node.id} open={query || depth===0 || node.children.some(containsSelection) ? true : undefined} className="ide-captured-layer">
    <summary data-structured-layer-id={node.id} className={selected.includes(node.id) ? 'selected' : ''} style={{paddingLeft:12+depth*12}} onClick={event=>{event.preventDefault();onSelect(event.shiftKey ? selected.includes(node.id) ? selected.filter(id=>id!==node.id) : [...selected,node.id] : [node.id])}}>
      {node.children.length ? <button aria-label={`Expand ${node.name}`} onClick={event=>{event.stopPropagation();event.preventDefault();const details=event.currentTarget.closest('details')!;details.open=!details.open}}><ChevronDown size={12}/></button> : <span className="ide-layer-spacer"/>}
      {node.type==='Text'?<Type size={13}/>:<Frame size={13}/>}<span title={node.name}>{node.name}</span>{node.locked&&<Lock size={12}/>}
    </summary>
    {!!node.children.length && <StructuredLayers nodes={node.children} selected={selected} query={query} onSelect={onSelect} depth={depth+1}/>}
  </details>)}</>
})

function NumberField({label,value,min,onChange}:{label:string;value:number;min?:number;onChange:(value:number)=>void}) {
  return <label>{label}<input key={value} aria-label={`Captured ${label.toLowerCase()}`} type="number" step="any" min={min} defaultValue={Math.round(value*100)/100} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} onBlur={event=>{const next=Number(event.currentTarget.value);if(event.currentTarget.value!==''&&Number.isFinite(next)&&next!==value)onChange(min===undefined?next:Math.max(min,next));else event.currentTarget.value=String(Math.round(value*100)/100)}}/></label>
}

export function StructuredSelectionPanel({node,count,onBounds,onPatch,onEditText}: {
  node?:StructuredNode; count:number; onBounds:(bounds:Partial<StructuredNode['bounds']>)=>void
  onPatch:(patch:Partial<StructuredNode>)=>void; onEditText:()=>void
}) {
  if(!node || count!==1) return <div className="ide-captured-inspector"><h3>{count} layers selected</h3><p>Drag to move together. Shift-click to change your selection.</p></div>
  return <div className="ide-captured-inspector">
    <header><strong>{node.name}</strong><small>{node.type}</small></header>
    <fieldset disabled={node.locked}><legend>Position & size</legend><div className="ide-captured-fields">{(['x','y','width','height'] as const).map(key=><NumberField key={key} label={key==='x'?'X':key==='y'?'Y':key==='width'?'Width':'Height'} value={node.bounds[key]} min={key==='width'||key==='height'?1:undefined} onChange={value=>onBounds({[key]:value})}/>)}</div></fieldset>
    {node.typography && <fieldset disabled={node.locked}><legend>Text</legend><button onClick={onEditText}>Edit text</button><NumberField label="Font size" value={node.typography.fontSize} min={1} onChange={fontSize=>onPatch({typography:{...node.typography!,fontSize}})}/></fieldset>}
    <button onClick={()=>onPatch({locked:!node.locked})}>{node.locked?'Unlock layer':'Lock layer'}</button>
  </div>
}
