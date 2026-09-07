import { useState } from 'react'
import type { DesignNode } from '@shared/types/designNode'
import { useDesignStore } from '../../state/designStore'

export function RenderNode({ node }: { node: DesignNode }) {
  const selectedId = useDesignStore((s) => s.selectedId)
  const select = useDesignStore((s) => s.select)
  const breakpoint = useDesignStore((s) => s.breakpoint)
  const isSelected = selectedId === node.id
  const isHiddenHere = node.hidden || (breakpoint !== 'desktop' && node.responsiveHidden?.[breakpoint])

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    select(node.id)
  }

  // Hidden nodes stay in the canvas at reduced opacity (still selectable, so
  // the user can find and re-enable them) — Preview mode, a later phase, is
  // where hidden actually means absent from the rendered output.
  const selectionRing = `${isSelected ? 'outline outline-2 outline-accent-2 outline-offset-2' : ''} ${isHiddenHere ? 'opacity-30' : ''}`.trim()

  switch (node.kind) {
    case 'stack':
      return (
        <div
          onClick={handleClick}
          className={`relative flex min-h-[32px] rounded-md ${selectionRing}`}
          style={{ flexDirection: node.direction === 'row' ? 'row' : 'column', gap: node.gap, alignItems: alignToCss(node.align) }}
        >
          {node.children.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11.5px] text-text-3">
              Empty stack — insert something
            </div>
          ) : (
            node.children.map((child) => <RenderNode key={child.id} node={child} />)
          )}
        </div>
      )

    case 'container':
      return (
        <div onClick={handleClick} className={`rounded-lg border border-border p-4 ${selectionRing}`}>
          {node.children.length === 0 ? (
            <div className="text-center text-[11.5px] text-text-3">Empty container</div>
          ) : (
            <div className="flex flex-col gap-3">
              {node.children.map((child) => (
                <RenderNode key={child.id} node={child} />
              ))}
            </div>
          )}
        </div>
      )

    case 'text':
    case 'heading':
      return <EditableText node={node} onClick={handleClick} selectionRing={selectionRing} />

    case 'button':
      return (
        <button
          type="button"
          onClick={handleClick}
          className={`w-fit rounded-lg px-4 py-2.5 text-[13px] font-semibold ${selectionRing} ${
            node.variant === 'primary' ? 'bg-gradient-to-b from-[#8676F4] to-[#7461EE] text-white' : 'border border-border bg-panel-2 text-text'
          }`}
        >
          {node.label}
        </button>
      )

    case 'divider':
      return <div onClick={handleClick} className={`h-px w-full bg-border ${selectionRing}`} />

    case 'image':
      return (
        <div onClick={handleClick} className={`flex h-32 items-center justify-center rounded-lg bg-panel-2 text-[11.5px] text-text-3 ${selectionRing}`}>
          {node.alt || 'Image'}
        </div>
      )

    case 'placeholder':
      return (
        <div
          onClick={handleClick}
          className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-[12px] ${selectionRing} ${
            node.editability === 'limited' ? 'border-warning/35 bg-warning/[0.06] text-warning' : 'border-danger/30 bg-danger/[0.05] text-danger'
          }`}
        >
          <span>{node.editability === 'limited' ? '\u{1F513}' : '\u{1F512}'}</span>
          <span className="font-medium text-text-2">{node.label}</span>
          <span className="ml-auto text-[9px] font-bold uppercase tracking-wide">{node.editability}</span>
        </div>
      )
  }
}

function alignToCss(align: 'start' | 'center' | 'end' | 'stretch'): string {
  if (align === 'start') return 'flex-start'
  if (align === 'end') return 'flex-end'
  return align
}

function EditableText({
  node,
  onClick,
  selectionRing,
}: {
  node: Extract<DesignNode, { kind: 'text' | 'heading' }>
  onClick: (e: React.MouseEvent) => void
  selectionRing: string
}) {
  const dispatch = useDesignStore((s) => s.dispatch)
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
      />
    )
  }

  return (
    <div
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setDraft(node.content)
        setEditing(true)
      }}
      className={`w-fit cursor-text rounded px-0.5 ${selectionRing} ${node.kind === 'heading' ? 'text-[22px] font-bold text-white' : 'text-[14px] text-text-2'}`}
    >
      {node.content || <span className="text-text-3">Empty text — double-click to edit</span>}
    </div>
  )
}
