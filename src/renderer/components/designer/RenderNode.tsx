import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDndMonitor,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DesignNode, NodeStyle, GridNode, StackNode, Breakpoint } from '@shared/types/designNode'
import { findNode, findParent } from '@core/design-model/tree'
import { useDesignStore } from '../../state/designStore'
import { useProjectStore } from '../../state/projectStore'
import { useConceptComponentStore } from '../../state/conceptComponentStore'
import { snapToSpacingToken } from '../../lib/spacingSnap'
import { resolveClassName } from '@core/adapters/tailwind/resolveClassName'

/**
 * Top of the canvas render tree — owns the single `DndContext` every
 * stack/grid/container child-reorder in `RenderNode` reports into (nested
 * `SortableContext`s per parent, plus per-grid droppable cells, all report
 * up to this one context, mirroring how `LayersPanel` uses one `DndContext`
 * for its whole tree). `ScreenDesignerView` renders this instead of a bare
 * `RenderNode` so the canvas gets real drag-and-drop, not just the Layers
 * panel.
 */
export function CanvasRoot({ node }: { node: DesignNode }) {
  const dispatch = useDesignStore((s) => s.dispatch)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overData = over.data.current as
      | { type: 'grid-cell'; gridId: string; columnStart: number; rowStart: number }
      | { type: 'sibling'; parentId: string }
      | undefined

    if (overData?.type === 'grid-cell') {
      const activeInfo = findParent(node, activeId)
      const activeNode = findNode(node, activeId)
      if (!activeInfo || !activeNode) return
      // Dragged in from a different parent (stack/container/another grid) —
      // reparent into this grid first, then place it. Two commands (two
      // undo steps) rather than one combined command, matching how
      // MoveNode/SetGridPlacement are already separately undoable.
      if (activeInfo.parent.id !== overData.gridId) {
        const gridNode = findNode(node, overData.gridId)
        const targetIndex = gridNode ? gridNode.children.length : 0
        dispatch({ type: 'MoveNode', nodeId: activeId, newParentId: overData.gridId, newIndex: targetIndex })
      }
      const prior = activeNode.gridPlacement
      dispatch({
        type: 'SetGridPlacement',
        nodeId: activeId,
        placement: {
          columnStart: overData.columnStart,
          rowStart: overData.rowStart,
          columnSpan: prior?.columnSpan ?? 1,
          rowSpan: prior?.rowSpan ?? 1,
        },
      })
      return
    }

    if (activeId === String(over.id)) return
    const activeInfo = findParent(node, activeId)
    const overInfo = findParent(node, String(over.id))
    if (!activeInfo || !overInfo) return
    if (activeInfo.parent.id !== overInfo.parent.id) return // siblings only, matches LayersPanel

    const ids = activeInfo.parent.children.map((c) => c.id)
    const oldIndex = ids.indexOf(activeId)
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(ids, oldIndex, newIndex)
    dispatch({ type: 'MoveNode', nodeId: activeId, newParentId: activeInfo.parent.id, newIndex: reordered.indexOf(activeId) })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <RenderNode node={node} />
    </DndContext>
  )
}

export function RenderNode({ node }: { node: DesignNode }) {
  const selectedIds = useDesignStore((s) => s.selectedIds)
  const select = useDesignStore((s) => s.select)
  const breakpoint = useDesignStore((s) => s.breakpoint)
  const conceptComponents = useConceptComponentStore((s) => s.components)
  // Only ever consumed by the 'placeholder' case below, but read
  // unconditionally here (never inside the switch) to keep hook order
  // stable across renders regardless of which node kind this instance is.
  const projectTokens = useProjectStore((s) => s.activeIndex?.projectModel.tokens)
  const isSelected = selectedIds.includes(node.id)
  const isHiddenHere = node.hidden || (breakpoint !== 'desktop' && node.responsiveHidden?.[breakpoint])

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    select(node.id, additive ? { additive: true } : undefined)
  }

  // Hidden nodes stay in the canvas at reduced opacity (still selectable, so
  // the user can find and re-enable them) — Preview mode, a later phase, is
  // where hidden actually means absent from the rendered output.
  const selectionRing = `${isSelected ? 'outline outline-2 outline-accent-2 outline-offset-2' : ''} ${isHiddenHere ? 'opacity-30' : ''}`.trim()
  const effectiveStyle = resolveEffectiveStyle(node, breakpoint)
  const styleObj = styleToCss(effectiveStyle, node.kind)
  const canResize = typeof effectiveStyle?.width === 'number' || typeof effectiveStyle?.height === 'number'

  switch (node.kind) {
    case 'stack': {
      const effective = resolveEffectiveStack(node, breakpoint)
      return (
        <div
          onClick={handleClick}
          className={`relative flex min-h-[32px] rounded-md ${selectionRing}`}
          style={{
            flexDirection: effective.direction === 'row' ? 'row' : 'column',
            gap: effective.gap,
            alignItems: alignToCss(effective.align),
            flexWrap: effective.wrap ? 'wrap' : 'nowrap',
            justifyContent: justifyToCss(effective.justify),
            ...styleObj,
          }}
        >
          {node.children.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11.5px] text-text-3">
              Empty stack — insert something
            </div>
          ) : (
            <SortableChildren parentId={node.id} children={node.children} axis={effective.direction === 'row' ? 'horizontal' : 'vertical'} />
          )}
          {isSelected && canResize && <ResizeHandles node={node} />}
        </div>
      )
    }

    case 'container':
      return (
        <div onClick={handleClick} className={`relative rounded-lg border border-border p-4 ${selectionRing}`} style={styleObj}>
          {node.children.length === 0 ? (
            <div className="text-center text-[11.5px] text-text-3">Empty container</div>
          ) : (
            <div className="flex flex-col gap-3">
              <SortableChildren parentId={node.id} children={node.children} axis="vertical" />
            </div>
          )}
          {isSelected && canResize && <ResizeHandles node={node} />}
        </div>
      )

    case 'text':
    case 'heading':
      return <EditableText node={node} onClick={handleClick} selectionRing={selectionRing} styleObj={styleObj} />

    case 'button':
      return (
        <button
          type="button"
          onClick={handleClick}
          className={`relative w-fit rounded-lg px-4 py-2.5 text-[13px] font-semibold ${selectionRing} ${
            node.variant === 'primary' ? 'bg-gradient-to-b from-[#8676F4] to-[#7461EE] text-white' : 'border border-border bg-panel-2 text-text'
          }`}
          style={styleObj}
        >
          {node.label}
          {isSelected && canResize && <ResizeHandles node={node} />}
        </button>
      )

    case 'divider':
      return (
        <div onClick={handleClick} className={`relative h-px w-full bg-border ${selectionRing}`} style={styleObj}>
          {isSelected && canResize && <ResizeHandles node={node} />}
        </div>
      )

    case 'image':
      return (
        <div onClick={handleClick} className={`relative flex h-32 items-center justify-center rounded-lg bg-panel-2 text-[11.5px] text-text-3 ${selectionRing}`} style={styleObj}>
          {node.alt || 'Image'}
          {isSelected && canResize && <ResizeHandles node={node} />}
        </div>
      )

    case 'grid':
      return (
        <GridRenderNode
          node={node}
          breakpoint={breakpoint}
          handleClick={handleClick}
          selectionRing={selectionRing}
          styleObj={styleObj}
          isSelected={isSelected}
          canResize={canResize}
        />
      )

    case 'concept': {
      const concept = conceptComponents.find((c) => c.id === node.conceptComponentId)
      const variant = concept?.variants.find((v) => v.id === node.variantId)
      return (
        <div
          onClick={handleClick}
          className={`relative rounded-lg border-2 border-dashed border-accent-2/50 bg-accent-2/[0.06] px-3 py-2.5 text-[12px] ${selectionRing}`}
          style={styleObj}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-accent-2">{'◇'}</span>
            <span className="truncate font-semibold text-text">{concept?.name ?? 'Unknown concept component'}</span>
            {variant && <span className="ml-auto shrink-0 rounded bg-accent-2/15 px-1.5 py-px text-[9.5px] font-semibold text-accent-2">{variant.name}</span>}
          </div>
          {concept && concept.properties.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-0.5 border-t border-dashed border-accent-2/25 pt-1.5 text-[10.5px] text-text-3">
              {concept.properties.map((p) => (
                <div key={p.id} className="flex justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  <span className="truncate font-mono text-text-2">{node.propertyValues[p.id] ?? p.defaultValue}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-1.5 text-[9px] font-semibold uppercase tracking-wide text-accent-2/70">Concept — doesn't exist in code yet</div>
          {isSelected && canResize && <ResizeHandles node={node} />}
        </div>
      )
    }

    case 'placeholder': {
      // Fidelity pass (Phase 9): resolve the placeholder's real class attribute
      // against the target project's own resolved design tokens so real
      // padding/gap/radius/color show up instead of a generic dashed box for
      // every element. Anything that doesn't resolve (arbitrary values,
      // unknown utilities, non-Tailwind CSS) is silently skipped — never
      // guessed — and the plain dashed look is what's left for it.
      const classAttr = node.attributes?.className ?? node.attributes?.class
      const resolvedStyle = classAttr ? styleFromResolvedClasses(resolveClassName(classAttr, projectTokens ?? [])) : {}
      const hasResolvedStyle = Object.keys(resolvedStyle).length > 0

      const src = node.attributes?.src
      const isImageTag = node.label.toLowerCase() === 'img'
      // Only ever an already-loadable URL (absolute http(s) or a data URI) —
      // a bundler-processed relative asset path has no cheap way to resolve
      // to real bytes here, so it stays the plain placeholder box rather than
      // risk a broken image icon.
      const canPreviewImage = isImageTag && !!src && (/^https?:\/\//i.test(src) || src.startsWith('data:'))

      return (
        <div
          onClick={handleClick}
          style={hasResolvedStyle ? resolvedStyle : undefined}
          className={`rounded-lg border px-3 py-2.5 text-[12px] ${selectionRing} ${
            hasResolvedStyle
              ? 'border-solid border-border/60'
              : node.editability === 'limited'
                ? 'border-dashed border-warning/35 bg-warning/[0.06] text-warning'
                : 'border-dashed border-danger/30 bg-danger/[0.05] text-danger'
          }`}
        >
          {canPreviewImage && (
            <img src={src} alt={node.attributes?.alt ?? ''} className="mb-2 max-h-40 w-full rounded object-cover" />
          )}
          <div className="flex items-center gap-2">
            <span>{node.editability === 'limited' ? '\u{1F513}' : '\u{1F512}'}</span>
            <span className={`truncate font-medium ${hasResolvedStyle ? 'text-text-2' : ''}`}>{node.textPreview ? `${node.label}: ${node.textPreview}` : node.label}</span>
            <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide">{node.editability}</span>
          </div>
          {node.children.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 border-l border-dashed border-current/20 pl-2.5">
              {node.children.map((child) => (
                <RenderNode key={child.id} node={child} />
              ))}
            </div>
          )}
        </div>
      )
    }
  }
}

/** Converts `resolveClassName`'s kebab-case CSS properties into a React
 * inline-style object. Empty values (an 'unresolved' token resolved to `''`)
 * are dropped rather than emitted as a no-op style declaration. */
function styleFromResolvedClasses(resolved: ReturnType<typeof resolveClassName>): React.CSSProperties {
  const style: Record<string, string> = {}
  for (const entry of resolved) {
    if (!entry.value) continue
    for (const property of entry.properties) {
      style[property.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] = entry.value
    }
  }
  return style as React.CSSProperties
}

/** Merges a stack node's layout-relevant fields with its per-breakpoint
 * override (spec Phase 18) — any field absent from the override (or when
 * `breakpoint` is 'desktop', which never has overrides applied) keeps
 * inheriting the base/desktop value, per `responsiveOverrides`' "absent
 * means inherit" contract. */
function resolveEffectiveStack(node: StackNode, breakpoint: Breakpoint) {
  const override = breakpoint === 'desktop' ? undefined : node.responsiveOverrides?.[breakpoint]
  return {
    gap: override?.gap ?? node.gap,
    direction: override?.direction ?? node.direction,
    align: override?.align ?? node.align,
    justify: override?.justify ?? node.justify,
    wrap: override?.wrap ?? node.wrap,
  }
}

/** Same idea as `resolveEffectiveStack`, for a `GridNode`'s layout fields. */
function resolveEffectiveGrid(node: GridNode, breakpoint: Breakpoint) {
  const override = breakpoint === 'desktop' ? undefined : node.responsiveOverrides?.[breakpoint]
  return {
    columns: override?.columns ?? node.columns,
    columnGap: override?.columnGap ?? node.columnGap,
    rowGap: override?.rowGap ?? node.rowGap,
  }
}

/** Merges `node.style` with the current breakpoint's `style` override, if
 * any — the override replaces individual fields it sets, everything else
 * still comes from the base style (spec Phase 18: the whole
 * `responsiveOverrides[bp]` object replaces wholesale at the command layer,
 * but `style` within it is still just one more field of the override, so at
 * render time it's a per-field merge against the base style same as any
 * other override field here). */
function resolveEffectiveStyle(node: DesignNode, breakpoint: Breakpoint): NodeStyle | undefined {
  if (breakpoint === 'desktop') return node.style
  const overrideStyle = node.responsiveOverrides?.[breakpoint]?.style
  if (!overrideStyle) return node.style
  return { ...node.style, ...overrideStyle }
}

function alignToCss(align: 'start' | 'center' | 'end' | 'stretch'): string {
  if (align === 'start') return 'flex-start'
  if (align === 'end') return 'flex-end'
  return align
}

function justifyToCss(justify: 'start' | 'center' | 'end' | 'space-between' | undefined): string | undefined {
  if (!justify) return undefined
  if (justify === 'start') return 'flex-start'
  if (justify === 'end') return 'flex-end'
  if (justify === 'space-between') return 'space-between'
  return justify
}

/** Maps the shared `NodeStyle` overrides onto inline CSS, layered on top of
 * each kind's fixed Tailwind classes (spec Phase 10-12) — never removes an
 * existing class, only adds inline style for whatever the designer set. */
function styleToCss(style: NodeStyle | undefined, kind: DesignNode['kind']): React.CSSProperties {
  if (!style) return {}
  const css: React.CSSProperties = {}
  if (style.width !== undefined) css.width = style.width === 'fill' ? '100%' : style.width === 'auto' ? undefined : style.width
  if (style.height !== undefined) css.height = style.height === 'fill' ? '100%' : style.height === 'auto' ? undefined : style.height
  if (style.minWidth !== undefined) css.minWidth = style.minWidth
  if (style.maxWidth !== undefined) css.maxWidth = style.maxWidth

  const hasIndividualPadding =
    style.paddingTop !== undefined || style.paddingRight !== undefined || style.paddingBottom !== undefined || style.paddingLeft !== undefined
  if (hasIndividualPadding) {
    if (style.paddingTop !== undefined || style.padding !== undefined) css.paddingTop = style.paddingTop ?? style.padding
    if (style.paddingRight !== undefined || style.padding !== undefined) css.paddingRight = style.paddingRight ?? style.padding
    if (style.paddingBottom !== undefined || style.padding !== undefined) css.paddingBottom = style.paddingBottom ?? style.padding
    if (style.paddingLeft !== undefined || style.padding !== undefined) css.paddingLeft = style.paddingLeft ?? style.padding
  } else if (style.padding !== undefined) {
    css.padding = style.padding
  }

  if (style.backgroundColor) css.backgroundColor = style.backgroundColor
  if (style.borderColor !== undefined || style.borderWidth !== undefined) {
    css.borderStyle = 'solid'
    css.borderWidth = style.borderWidth ?? 1
    css.borderColor = style.borderColor ?? 'currentColor'
  }
  if (style.borderRadius !== undefined) css.borderRadius = style.borderRadius
  if (style.boxShadow) css.boxShadow = style.boxShadow
  if (style.opacity !== undefined) css.opacity = style.opacity

  if (kind === 'text' || kind === 'heading' || kind === 'button') {
    if (style.fontFamily) css.fontFamily = style.fontFamily
    if (style.fontSize !== undefined) css.fontSize = style.fontSize
    if (style.fontWeight !== undefined) css.fontWeight = style.fontWeight
    if (style.lineHeight !== undefined) css.lineHeight = style.lineHeight
    if (style.letterSpacing !== undefined) css.letterSpacing = style.letterSpacing
    if (style.color) css.color = style.color
    if (style.textAlign) css.textAlign = style.textAlign
  }

  return css
}

/**
 * Drag-resize handles for a node whose `style.width`/`style.height` is an
 * absolute px number (spec Phase 11) — plain pointer events, no extra
 * dependency. Dispatches one `SetStyle` per drag (on release), not per
 * pointermove, so a single resize doesn't flood the ≥100-step undo budget;
 * the handle itself re-renders live via the node's own style during the
 * drag since `SetStyle`'s target is this exact node. Holding Shift opts out
 * of spacing-token snapping for exact pixel control (spec Phase 11's
 * "allow manual override when deliberately required").
 */
function ResizeHandles({ node }: { node: DesignNode }) {
  const dispatch = useDesignStore((s) => s.dispatch)
  const style = node.style
  const hasWidth = typeof style?.width === 'number'
  const hasHeight = typeof style?.height === 'number'

  function startResize(e: React.PointerEvent, axis: 'width' | 'height' | 'both') {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startWidth = typeof style?.width === 'number' ? style.width : 0
    const startHeight = typeof style?.height === 'number' ? style.height : 0
    const tokens = useProjectStore.getState().activeIndex?.projectModel.tokens ?? []

    function onMove(ev: PointerEvent) {
      const patch: Partial<NodeStyle> = {}
      if (axis === 'width' || axis === 'both') {
        let w = Math.max(1, Math.round(startWidth + (ev.clientX - startX)))
        if (!ev.shiftKey) w = snapToSpacingToken(w, tokens)
        patch.width = w
      }
      if (axis === 'height' || axis === 'both') {
        let h = Math.max(1, Math.round(startHeight + (ev.clientY - startY)))
        if (!ev.shiftKey) h = snapToSpacingToken(h, tokens)
        patch.height = h
      }
      dispatch({ type: 'SetStyle', nodeId: node.id, style: patch })
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!hasWidth && !hasHeight) return null

  return (
    <>
      {hasWidth && (
        <div
          onPointerDown={(e) => startResize(e, 'width')}
          onClick={(e) => e.stopPropagation()}
          title="Drag to resize width — hold Shift for exact pixels"
          className="absolute right-[-5px] top-1/2 h-4 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-sm border border-white/40 bg-accent-2"
        />
      )}
      {hasHeight && (
        <div
          onPointerDown={(e) => startResize(e, 'height')}
          onClick={(e) => e.stopPropagation()}
          title="Drag to resize height — hold Shift for exact pixels"
          className="absolute bottom-[-5px] left-1/2 h-2.5 w-4 -translate-x-1/2 cursor-ns-resize rounded-sm border border-white/40 bg-accent-2"
        />
      )}
      {hasWidth && hasHeight && (
        <div
          onPointerDown={(e) => startResize(e, 'both')}
          onClick={(e) => e.stopPropagation()}
          title="Drag to resize — hold Shift for exact pixels"
          className="absolute bottom-[-5px] right-[-5px] h-3 w-3 cursor-nwse-resize rounded-sm border border-white/40 bg-accent-2"
        />
      )}
    </>
  )
}

/** Renders one stack/container's children as a dnd-kit sortable list —
 * reordering dispatches `MoveNode` via `CanvasRoot`'s single `onDragEnd`.
 * `axis` picks the sorting strategy and which side the insertion-line
 * indicator renders on (below/above for a vertical stack, left/right for a
 * horizontal one). */
function SortableChildren({ parentId, children, axis }: { parentId: string; children: DesignNode[]; axis: 'vertical' | 'horizontal' }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  useDndMonitor({
    onDragStart: (e) => setActiveId(String(e.active.id)),
    onDragOver: (e) => setOverId(e.over ? String(e.over.id) : null),
    onDragEnd: () => {
      setActiveId(null)
      setOverId(null)
    },
    onDragCancel: () => {
      setActiveId(null)
      setOverId(null)
    },
  })

  const ids = children.map((c) => c.id)
  const strategy = axis === 'horizontal' ? horizontalListSortingStrategy : verticalListSortingStrategy

  return (
    <SortableContext items={ids} strategy={strategy}>
      {children.map((child) => {
        const isOver = overId === child.id && activeId !== null && activeId !== child.id
        const activeIsBeforeInList = isOver && activeId !== null && ids.indexOf(activeId) < ids.indexOf(child.id)
        return (
          <SortableCanvasItem
            key={child.id}
            node={child}
            parentId={parentId}
            axis={axis}
            showBefore={isOver && !activeIsBeforeInList}
            showAfter={isOver && activeIsBeforeInList}
          />
        )
      })}
    </SortableContext>
  )
}

function SortableCanvasItem({
  node,
  parentId,
  axis,
  showBefore,
  showAfter,
}: {
  node: DesignNode
  parentId: string
  axis: 'vertical' | 'horizontal'
  showBefore: boolean
  showAfter: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
    data: { type: 'sibling', parentId },
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const indicatorBase = axis === 'vertical' ? 'absolute left-0 right-0 h-0.5 rounded-full bg-accent-2' : 'absolute top-0 bottom-0 w-0.5 rounded-full bg-accent-2'

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative">
      {showBefore && <div className={`${indicatorBase} ${axis === 'vertical' ? '-top-1.5' : '-left-1.5'}`} />}
      <RenderNode node={node} />
      {showAfter && <div className={`${indicatorBase} ${axis === 'vertical' ? '-bottom-1.5' : '-right-1.5'}`} />}
    </div>
  )
}

/** A grid child is placed by explicit `gridPlacement`, not sequential
 * order, so it's a plain `useDraggable` source (no `SortableContext`
 * ordering) — where it lands is decided by which `GridCellDropTarget` it's
 * dropped on. */
function DraggableGridChild({ node, gridId }: { node: DesignNode; gridId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: node.id, data: { type: 'sibling', parentId: gridId } })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <RenderNode node={node} />
    </div>
  )
}

function GridCellDropTarget({ gridId, col, row }: { gridId: string; col: number; row: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${gridId}:${col}:${row}`, data: { type: 'grid-cell', gridId, columnStart: col, rowStart: row } })
  return (
    <div
      ref={setNodeRef}
      style={{ gridColumn: col, gridRow: row }}
      className={`pointer-events-auto rounded-sm border border-dashed transition-colors ${isOver ? 'border-accent-2 bg-accent-2/25' : 'border-accent-2/20'}`}
    />
  )
}

function computeGridRowCount(node: GridNode): number {
  if (typeof node.rows === 'number') return node.rows
  const maxUsedRow = node.children.reduce((max, c) => {
    const end = (c.gridPlacement?.rowStart ?? 1) + (c.gridPlacement?.rowSpan ?? 1) - 1
    return Math.max(max, end)
  }, 0)
  return Math.min(maxUsedRow + 1, 12) // +1 spare row so there's always somewhere new to drop
}

function GridRenderNode({
  node,
  breakpoint,
  handleClick,
  selectionRing,
  styleObj,
  isSelected,
  canResize,
}: {
  node: GridNode
  breakpoint: Breakpoint
  handleClick: (e: React.MouseEvent) => void
  selectionRing: string
  styleObj: React.CSSProperties
  isSelected: boolean
  canResize: boolean
}) {
  const [dragActive, setDragActive] = useState(false)
  useDndMonitor({
    onDragStart: () => setDragActive(true),
    onDragEnd: () => setDragActive(false),
    onDragCancel: () => setDragActive(false),
  })

  const effective = resolveEffectiveGrid(node, breakpoint)
  const rowCount = computeGridRowCount(node)
  const cells: { col: number; row: number }[] = []
  for (let row = 1; row <= rowCount; row++) {
    for (let col = 1; col <= effective.columns; col++) cells.push({ col, row })
  }

  return (
    <div className="relative">
      <div
        onClick={handleClick}
        className={`grid min-h-[48px] rounded-md ${selectionRing}`}
        style={{ gridTemplateColumns: `repeat(${effective.columns}, 1fr)`, columnGap: effective.columnGap, rowGap: effective.rowGap, ...styleObj }}
      >
        {node.children.length === 0 ? (
          <div className="col-span-full rounded-md border border-dashed border-border px-3 py-4 text-center text-[11.5px] text-text-3">
            Empty grid — insert something
          </div>
        ) : (
          node.children.map((child) => (
            <div
              key={child.id}
              style={{
                gridColumn: child.gridPlacement?.columnStart
                  ? `${child.gridPlacement.columnStart} / span ${child.gridPlacement.columnSpan ?? 1}`
                  : `span ${child.gridPlacement?.columnSpan ?? 1}`,
                gridRow: child.gridPlacement?.rowStart ? `${child.gridPlacement.rowStart} / span ${child.gridPlacement.rowSpan ?? 1}` : undefined,
              }}
            >
              <DraggableGridChild node={child} gridId={node.id} />
            </div>
          ))
        )}
      </div>
      {dragActive && (
        <div
          className="pointer-events-none absolute inset-0 grid gap-0.5 p-0.5"
          style={{ gridTemplateColumns: `repeat(${effective.columns}, 1fr)`, gridTemplateRows: `repeat(${rowCount}, minmax(28px, 1fr))` }}
        >
          {cells.map(({ col, row }) => (
            <GridCellDropTarget key={`${col}-${row}`} gridId={node.id} col={col} row={row} />
          ))}
        </div>
      )}
      {isSelected && canResize && <ResizeHandles node={node} />}
    </div>
  )
}

function EditableText({
  node,
  onClick,
  selectionRing,
  styleObj,
}: {
  node: Extract<DesignNode, { kind: 'text' | 'heading' }>
  onClick: (e: React.MouseEvent) => void
  selectionRing: string
  styleObj: React.CSSProperties
}) {
  const dispatch = useDesignStore((s) => s.dispatch)
  const selectedIds = useDesignStore((s) => s.selectedIds)
  const isSelected = selectedIds.includes(node.id)
  const canResize = typeof node.style?.width === 'number' || typeof node.style?.height === 'number'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.content)

  function commit() {
    setEditing(false)
    if (draft !== node.content) {
      dispatch({ type: 'SetText', nodeId: node.id, content: draft })
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(node.content)
            setEditing(false)
          }
        }}
        className={`w-full rounded bg-panel-2 px-1.5 py-0.5 outline-none ${node.kind === 'heading' ? 'text-[22px] font-bold' : 'text-[14px]'}`}
        style={styleObj}
      />
    )
  }

  return (
    <div
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (node.locked) return // LAY-04/§26: locked blocks edits, not just selection
        setDraft(node.content)
        setEditing(true)
      }}
      className={`relative ${node.locked ? 'cursor-default' : 'cursor-text'} w-fit rounded px-0.5 ${selectionRing} ${node.kind === 'heading' ? 'text-[22px] font-bold text-white' : 'text-[14px] text-text-2'}`}
      style={styleObj}
    >
      {node.content || <span className="text-text-3">Empty text — double-click to edit</span>}
      {isSelected && canResize && <ResizeHandles node={node} />}
    </div>
  )
}
