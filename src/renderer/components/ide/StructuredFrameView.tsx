import { memo, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'
import { appearanceStyleFor, capturedPositionStyleFor, containerStyleFor, typographyStyleFor } from '@core/capture-compiler/structuredNodeStyle'
import { FontDefinitions } from './VisualSvg'
import { InlineRichTextEditor } from './InlineRichTextEditor'
import { textSegments } from '@core/visual/richText'
import type { TextStyleRun } from '@shared/types/richText'

interface TextEditProps {
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
export const StructuredFrameView = memo(function StructuredFrameView({ frame, editingId, onEnterTextEdit, onCommitText }: { frame: StructuredFrame } & TextEditProps) {
  return (
    <div data-structured-frame={frame.id} style={{ position: 'relative', width: frame.width, height: frame.height, overflow: 'hidden', background: '#fff' }}>
      <FontDefinitions fonts={frame.fonts} />
      {frame.children.map((child) => (
        <StructuredNodeView key={child.id} node={child} parentMode="free" editingId={editingId} onEnterTextEdit={onEnterTextEdit} onCommitText={onCommitText} />
      ))}
    </div>
  )
})

const StructuredNodeView = memo(function StructuredNodeView({
  node,
  parentMode,
  editingId,
  onEnterTextEdit,
  onCommitText,
}: {
  node: StructuredNode
  parentMode: StructuredNode['layout']['mode']
} & TextEditProps) {
  const positionStyle = capturedPositionStyleFor(node)
  const appearanceStyle = appearanceStyleFor(node.appearance)
  const draggable = !node.locked
  const identity = { 'data-structured-id': node.id, ...(draggable ? { 'data-structured-draggable': 'true' } : {}) }

  // Always called (rules of hooks) — only acts for a Text node currently
  // in edit mode. `contentEditable` becoming true doesn't itself move
  // focus/caret, so this does it imperatively once, the instant editing
  // begins; select-all on entry is a standard "ready to retype" design-tool
  // convention (double-click or Enter both land here the same way).
  const isEditing = node.type === 'Text' && node.id === editingId
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

  if (node.type === 'Text') {
    const textStyle = {
      ...appearanceStyle,
      ...typographyStyleFor(node.typography ?? { text: '', fontFamily: 'sans-serif', fontSize: 16, fontWeight: '400', lineHeight: 19, letterSpacing: 0, textAlign: 'left' }),
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
        {textSegments(node.typography?.text ?? '', node.typography?.textRuns).map((segment) => <span key={`${segment.start}-${segment.end}`} style={{ fontWeight: segment.fontWeight, color: segment.color }}>{segment.text}</span>)}
      </span>
    )
  }

  // Stage 9 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §22): a `RasterFallback`
  // node carries the exact same already-spliced `source.imageSrc` an
  // `Image` node would — same render path, just a different reason it
  // exists.
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
    const linePosition = parentMode === 'free' ? { ...positionStyle, top: Number(positionStyle.top ?? 0) + (node.bounds.height - thickness) / 2, height: thickness } : { ...positionStyle, height: thickness }
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
      <svg style={positionStyle as CSSProperties} viewBox={node.source.svgGeometry?.viewBox} width={node.bounds.width} height={node.bounds.height} {...identity}>
        {node.children.filter((child) => child.type === 'Shape').map((child) => (
          <StructuredShapeView key={child.id} node={child} />
        ))}
      </svg>
    )

  const containerStyle = containerStyleFor(node)
  return (
    <div style={{ ...containerStyle, ...positionStyle, ...appearanceStyle } as CSSProperties} {...identity}>
      {node.children.map((child) => (
        <StructuredNodeView key={child.id} node={child} parentMode={node.layout.mode} editingId={editingId} onEnterTextEdit={onEnterTextEdit} onCommitText={onCommitText} />
      ))}
    </div>
  )
})

/** Only ever reached as a direct child of an `SVG`-type node's own render
 * branch above — real SVG primitives can't be laid out via HTML div flow. */
function StructuredShapeView({ node }: { node: StructuredNode }) {
  const geo = node.source.svgGeometry ?? {}
  const paint = { fill: node.appearance.fill, stroke: node.appearance.stroke, strokeWidth: node.appearance.strokeWidth }
  const id = { 'data-structured-id': node.id }
  switch (node.source.tag) {
    case 'rect':
      return <rect x={geo.x} y={geo.y} width={geo.width} height={geo.height} {...paint} {...id} />
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
