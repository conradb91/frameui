import {capturedControlText} from '@core/capture-compiler/controlText'
import './captured-controls.css'
import {inheritedTextPaint,childTextPaint} from '@core/capture-compiler/textPaint'
import {StructuredTextContent} from './StructuredTextContent'
import { renderSvgDefinitions, scopeSvgValue } from '@core/capture-compiler/svgDefinitions'
import { memo, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'
import { controlStyleFor, appearanceStyleFor, capturedPositionStyleFor, containerStyleFor, typographyStyleFor } from '@core/capture-compiler/structuredNodeStyle'
import { FontDefinitions } from './VisualSvg'
import { InlineRichTextEditor } from './InlineRichTextEditor'
import type { TextStyleRun } from '@shared/types/richText'

interface TextEditProps {
  inheritedGradient?:import('@shared/types/richText').TextGradient
  prototype?: {state: import('@core/prototype/runtime').RuntimeState; onInput:(id:string,value:string|boolean)=>void}
  /** The `StructuredNode.id` currently in inline text-edit mode, if any. */
  editingId?: string | null
  /** Double-click (or Enter, from `DesignIde.tsx`'s keyboard handling) on a
   * Text node — selects it and enters edit mode. */
  onEnterTextEdit?: (id: string) => void
  /** Fired on blur (Escape and Cmd/Ctrl+Enter both just trigger blur) with
   * the edited text content. */
  onCommitText?: (id: string, text: string, runs?: TextStyleRun[]) => void
}

/**
 * The HTML/CSS design renderer (Stage 3 of the capture-engine rebuild,
 * docs/CAPTURE_ENGINE_REBUILD_SPEC.md §14) — renders a `StructuredFrame`
 * (Stage 2's model) as real DOM/CSS, mirroring `VisualSvg.tsx`'s shape (a
 * `memo`-wrapped recursive node view) but targeting native HTML elements
 * and real flex/grid instead of SVG shapes and baked absolute coordinates.
 *
 * Live in the canvas as of Stage 5 (inside a `<foreignObject>`, since the
 * canvas stage is SVG-rooted) and interactive as of Stage 6 — every
 * rendered element carries `data-structured-id={node.id}` so
 * `StructuredCanvasInteraction.tsx` can identify which
 * `StructuredNode` a given DOM element corresponds to, and
 * `data-structured-draggable="true"` on unlocked captured boxes. Their
 * saved positions are absolute even when the original source used flex/grid.
 *
 * Stage 8 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §13): `frame.fonts` (the
 * same already-fetched `data:`-URI bytes the legacy pipeline embeds) gets
 * turned into real `@font-face` rules via `FontDefinitions` (reused as-is
 * from `VisualSvg.tsx` — it was never SVG-specific, just a `<style>` tag
 * builder), so text actually renders with the captured font instead of
 * falling back to whatever the browser resolves `fontFamily` to locally.
 * `componentBinding` (Stage 8 sub-slice 3) and `tokenBindings[x].token`
 * (sub-slice 1) are both resolved main-process-side, in
 * `writeStructuredCapture`, not here — this component just renders
 * whatever the saved `StructuredFrame` already carries. A promoted
 * `ComponentInstance` node has no dedicated render branch below; it falls
 * through to the generic container branch like any other non-Text/Image/SVG
 * node, since `componentBinding` is metadata only and never changes a
 * node's actual geometry/appearance/children.
 *
 * Stage 7 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §18): a Text node's `<span>`
 * becomes `contentEditable` in place when it's the active `editingId` —
 * the real rendered text, at its real position/size, no second element and
 * no duplicate/ghost copy the way the legacy `VisualObject` text-edit
 * `<textarea>`-in-`<foreignObject>` has. See `DesignIde.tsx` for how
 * `editingId`/`onEnterTextEdit`/`onCommitText` get set.
 */
export const StructuredFrameView = memo(function StructuredFrameView({ frame, editingId, onEnterTextEdit, onCommitText, prototype }: { frame: StructuredFrame } & TextEditProps) {
  return (
    <div data-structured-frame={frame.id} style={{ position: 'relative', width: frame.width, height: frame.height, overflow: 'hidden', background: '#fff' }}>
      <FontDefinitions fonts={frame.fonts} />
      {frame.children.map((child) => (
        <StructuredNodeView key={child.id} node={child} parentMode="free" editingId={editingId} onEnterTextEdit={onEnterTextEdit} onCommitText={onCommitText} prototype={prototype} />
      ))}
    </div>
  )
})

const StructuredNodeView = memo(function StructuredNodeView({
  node,
  editingId,
  onEnterTextEdit,
  onCommitText,
  prototype,
  inheritedGradient,
}: {
  node: StructuredNode
  parentMode: StructuredNode['layout']['mode']
} & TextEditProps) {
  const positionStyle = { ...capturedPositionStyleFor(node), ...((prototype?.state.hidden[node.id]??!node.visibility)?{display:'none' as const}:{}), ...(prototype?.state.states[node.id]==='selected'?{outline:'2px solid #6366f1'}:{}), ...(prototype?.state.states[node.id]==='disabled'?{pointerEvents:'none' as const,opacity:0.45}:{}) }
  const appearanceStyle = appearanceStyleFor(node.appearance)
  if(node.type==='SVG')for(const [key,value] of Object.entries(appearanceStyle))if(typeof value==='string')appearanceStyle[key]=scopeSvgValue(value,node.id)
  const draggable = !node.locked
  const identity = { 'data-structured-id': node.id, ...(draggable ? { 'data-structured-draggable': 'true' } : {}) }

  // Always called (rules of hooks) — only acts for a Text node currently
  // in edit mode. `contentEditable` becoming true doesn't itself move
  // focus/caret, so this does it imperatively once, the instant editing
  // begins; select-all on entry is a standard "ready to retype" design-tool
  // convention (double-click or Enter both land here the same way).
  const paint=inheritedTextPaint(node,inheritedGradient)
  const typography=node.typography?{...node.typography,gradient:node.typography.gradient===null?undefined:node.typography.gradient??paint}:undefined
  const isText = node.type === 'Text'||!!node.typography&&!node.children.length&&!node.source.control
  const isEditing = isText && node.id === editingId
  const textRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!isEditing || !textRef.current) return
    textRef.current.focus()
    const range = document.createRange()
    range.selectNodeContents(textRef.current)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [isEditing])

  if (isText&&!node.source.control) {
    const textStyle = {
      ...appearanceStyle,
      ...typographyStyleFor(typography ?? { text: '', fontFamily: 'sans-serif', fontSize: 16, fontWeight: '400', lineHeight: 19, letterSpacing: 0, textAlign: 'left' }),
      display: 'block',
      width: '100%',
      height: '100%',
      outline: isEditing ? '2px solid var(--ide-accent)' : undefined,
      outlineOffset: isEditing ? 2 : undefined,
      cursor: isEditing ? 'text' : undefined,
    } as CSSProperties
    if (isEditing) return (
      <InlineRichTextEditor
        text={node.typography?.text ?? ''}
        textRuns={node.typography?.textRuns}
        shellStyle={positionStyle as CSSProperties}
        style={textStyle}
        className="ide-structured-inline-text"
        onCommit={(text, runs) => onCommitText?.(node.id, text, runs)}
        onCancel={() => onCommitText?.(node.id, node.typography?.text ?? '', node.typography?.textRuns)}
      />
    )
    return (
      <span
        ref={textRef}
        // `textStyle`'s width/height:100% is meant for `InlineRichTextEditor`'s
        // inner element, which fills a separate `shellStyle`-sized wrapper (see
        // the `isEditing` branch above). This plain `<span>` IS its own shell —
        // `positionStyle`'s captured pixel width/height must win here, or an
        // absolutely-positioned span with only `left`/`top` set resolves a
        // percentage width against its *parent* instead, silently discarding
        // the captured box (and any wrap the original page had at that width).
        style={{ ...textStyle, ...positionStyle } as CSSProperties}
        {...identity}
        contentEditable={isEditing}
        suppressContentEditableWarning={isEditing}
        onDoubleClick={(e) => { e.stopPropagation(); onEnterTextEdit?.(node.id) }}
      >
        {typography&&<StructuredTextContent typography={typography}/>}
      </span>
    )
  }

  // Stage 9 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §22): a `RasterFallback`
  // node carries the exact same already-spliced `source.imageSrc` an
  // `Image` node would — same render path, just a different reason it
  // exists.
  if (node.source.control) {
    const {placeholderColor:_placeholderColor,placeholderOpacity:_placeholderOpacity,appearance:_appearance,options,type,...control} = node.source.control
    const value=String(prototype?.state.inputs[node.id]??control.value??'')
    const style={...controlStyleFor(node),...(!prototype?{pointerEvents:'none' as const}:{})} as CSSProperties
    const disabled=prototype?.state.states[node.id]==='disabled'||control.disabled
    const content=type==='select'?<select data-captured-control="true" aria-label={node.name} disabled={disabled} value={value} tabIndex={prototype?0:-1} onChange={e=>prototype?.onInput(node.id,e.target.value)} style={style}>{options?.map((option,index)=><option key={index} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>:type==='textarea'?<textarea data-captured-control="true" {...control} aria-label={node.name} disabled={disabled} value={value} readOnly={!prototype} tabIndex={prototype?0:-1} onChange={e=>prototype?.onInput(node.id,e.target.value)} style={style}/>:<input data-captured-control="true" {...control} type={type} aria-label={node.name} disabled={disabled} value={value} checked={Boolean(prototype?.state.inputs[node.id]??control.checked)} readOnly={!prototype} tabIndex={prototype?0:-1} onChange={e=>prototype?.onInput(node.id,['checkbox','radio'].includes(type??'')?e.target.checked:e.target.value)} style={style}/>
    if(prototype)return <div style={positionStyle as CSSProperties} {...identity}>{content}</div>
    const editableText=capturedControlText(node.source.control)
    if(node.id===editingId&&!node.locked&&!['checkbox','radio','range'].includes(type))return <InlineRichTextEditor text={editableText} shellStyle={positionStyle as CSSProperties} style={{...controlStyleFor(node),width:'100%',height:'100%'} as CSSProperties} className="ide-structured-inline-text" onCommit={text=>onCommitText?.(node.id,text)} onCancel={()=>onCommitText?.(node.id,editableText)}/>
    const placeholder=!control.value&&!!control.placeholder
    const text=type==='password'&&control.value?'•'.repeat(control.value.length):editableText
    const staticStyle={...controlStyleFor(node),appearance:'none',display:'flex',alignItems:type==='textarea'?'flex-start':'center',position:'relative',overflow:'hidden',cursor:'default',userSelect:'none'} as CSSProperties
    const glyph=['checkbox','radio'].includes(type)?<svg aria-hidden="true" viewBox="0 0 16 16" width="100%" height="100%"><rect x="1" y="1" width="14" height="14" rx={type==='radio'?7:2} fill={control.checked?'#1677ff':'white'} stroke={control.checked?'#1677ff':'#767676'}/>{control.checked&&(type==='radio'?<circle cx="8" cy="8" r="3" fill="white"/>:<path d="m4 8 3 3 5-6" fill="none" stroke="white" strokeWidth="2"/>)}</svg>:type==='range'?<svg aria-hidden="true" viewBox="0 0 100 16" width="100%" height="100%" preserveAspectRatio="none"><path d="M4 8H96" stroke="#ccc" strokeWidth="4"/><circle cx={Math.max(4,Math.min(96,4+92*(Number(control.value??50)-Number(control.min??0))/(Number(control.max??100)-Number(control.min??0)||1)))} cy="8" r="6" fill="#1677ff"/></svg>:<span style={{flex:1,minWidth:0,whiteSpace:type==='textarea'?'pre-wrap':'pre',overflow:'hidden',color:placeholder?node.source.control.placeholderColor:undefined,opacity:placeholder?node.source.control.placeholderOpacity:undefined,textAlign:node.typography?.textAlign as CSSProperties['textAlign']}}>{text}</span>
    return <div onDoubleClick={e=>{if(!node.locked){e.stopPropagation();onEnterTextEdit?.(node.id)}}} style={positionStyle as CSSProperties} {...identity}><div data-captured-design-control={type} style={staticStyle}>{glyph}{type==='select'&&<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{flexShrink:0,marginLeft:4}}><path d="m2 4 4 4 4-4" fill="none" stroke="currentColor"/></svg>}</div></div>
  }

  if (node.type === 'Image' || node.type === 'RasterFallback') {
    if (node.source.imageSrc)
      return <img src={node.source.imageSrc} alt="" style={{ ...positionStyle, ...appearanceStyle } as CSSProperties} {...identity} />
    // No safely-embeddable source was captured for this image — a plain
    // placeholder keeps its space in the layout rather than silently
    // collapsing to nothing.
    return <div style={{ ...positionStyle, ...appearanceStyle, background: appearanceStyle.backgroundColor ?? '#e5e5e5' } as CSSProperties} {...identity} />
  }

  if (node.type === 'Divider') {
    const thickness = node.appearance.strokeWidth ?? node.appearance.border?.width ?? Math.max(1, node.bounds.height)
    const color = node.appearance.stroke ?? node.appearance.border?.color ?? 'currentColor'
    const linePosition = { ...positionStyle, height: thickness }
    return (
      <div style={{ ...linePosition, background: 'transparent', border: 0, boxShadow: 'none' } as CSSProperties} {...identity}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            width: '100%',
            height: thickness,
            transform: 'translateY(-50%)',
            backgroundColor: color,
            pointerEvents: 'none',
          }}
        />
      </div>
    )
  }

  if (node.type === 'SVG')
    return (
      <svg fill={node.appearance.fill} stroke={node.appearance.stroke??'none'} strokeWidth={node.appearance.strokeWidth} color={node.typography?.color} strokeLinecap={node.source.svgGeometry?.['stroke-linecap'] as 'round'|'butt'|'square'|undefined} strokeLinejoin={node.source.svgGeometry?.['stroke-linejoin'] as 'round'|'miter'|'bevel'|undefined} style={{ ...positionStyle, ...appearanceStyle, color:node.source.svgGeometry?.color } as CSSProperties} viewBox={node.source.svgGeometry?.viewBox} width={node.bounds.width} height={node.bounds.height} {...identity}>
        <defs dangerouslySetInnerHTML={{__html:renderSvgDefinitions(node.source.svgGeometry?.definitions,node.id)}}/>
        {node.children.filter((child) => child.type === 'Shape'||child.source.tag==='frameui-richtext').map((child) => (
          <StructuredShapeView key={child.id} node={child} scope={node.id} />
        ))}
      </svg>
    )

  const containerStyle = containerStyleFor(node)
  return (
    <div style={{ ...containerStyle, ...positionStyle, ...appearanceStyle } as CSSProperties} {...identity}>
      {node.children.map((child) => (
        <StructuredNodeView key={child.id} node={child} parentMode={node.layout.mode} inheritedGradient={childTextPaint(paint,child)} editingId={editingId} onEnterTextEdit={onEnterTextEdit} onCommitText={onCommitText} prototype={prototype} />
      ))}
    </div>
  )
})

/** Only ever reached as a direct child of an `SVG`-type node's own render
 * branch above — real SVG primitives can't be laid out via HTML div flow. */
function StructuredShapeView({ node,scope }: { node: StructuredNode;scope:string }) {
  const geo = node.source.svgGeometry ?? {}
  const paint = { opacity:node.appearance.opacity, filter:scopeSvgValue(geo.filter??node.appearance.filter,scope),clipPath:scopeSvgValue(geo['clip-path'],scope),mask:scopeSvgValue(geo.mask,scope),fill: scopeSvgValue(node.appearance.fill,scope), stroke: scopeSvgValue(node.appearance.stroke,scope), strokeWidth: node.appearance.strokeWidth, transform: geo.transform, strokeLinecap: geo['stroke-linecap'] as 'round' | 'butt' | 'square' | undefined, strokeLinejoin: geo['stroke-linejoin'] as 'round' | 'miter' | 'bevel' | undefined, strokeDasharray: geo['stroke-dasharray'], strokeDashoffset: geo['stroke-dashoffset'], fillRule: geo['fill-rule'] as 'nonzero' | 'evenodd' | undefined }
  const id = { 'data-structured-id': node.id }
  switch (node.source.tag) {
    case 'use': { const href=geo.href??geo['xlink:href'];if(!href?.startsWith('#'))return null;
      return <use href={scopeSvgValue('url('+href+')',scope)?.replace(/^url\((.*)\)$/,'$1')} x={geo.x} y={geo.y} width={geo.width} height={geo.height} {...paint} {...id}/> }
    case 'frameui-richtext':
    case 'g':
      return <g {...paint} {...id}>{node.children.map(child => <StructuredShapeView key={child.id} node={child} scope={scope} />)}</g>
    case 'rect':
      return <rect x={geo.x} y={geo.y} width={geo.width} height={geo.height} rx={geo.rx} ry={geo.ry} {...paint} {...id} />
    case 'circle':
      return <circle cx={geo.cx} cy={geo.cy} r={geo.r} {...paint} {...id} />
    case 'ellipse':
      return <ellipse cx={geo.cx} cy={geo.cy} rx={geo.rx} ry={geo.ry} {...paint} {...id} />
    case 'line':
      return <line x1={geo.x1} y1={geo.y1} x2={geo.x2} y2={geo.y2} {...paint} {...id} />
    case 'polygon':
      return <polygon points={geo.points} {...paint} {...id} />
    case 'polyline':
      return <polyline points={geo.points} {...paint} {...id} />
    default:
      return geo.d ? <path d={geo.d} {...paint} {...id} /> : null
  }
}
