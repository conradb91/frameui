import { useEffect, useMemo, useState } from 'react'
import { useDesignStore } from '../../state/designStore'
import { useFlowStore } from '../../state/flowStore'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { RenderNode } from '../../components/designer/RenderNode'
import { LayersPanel } from '../../components/designer/LayersPanel'
import { ChevronRightIcon, FrameMark, SearchIcon } from '../../components/icons/icons'
import { findNode, findParent } from '@core/design-model/tree'
import { createPrimitiveNode } from '@core/design-model/createPrimitiveNode'
import type { PrimitiveKind, DesignNode, Breakpoint } from '@shared/types/designNode'

const INSERT_CATEGORIES: { category: string; items: { kind: PrimitiveKind; label: string }[] }[] = [
  {
    category: 'Layout',
    items: [
      { kind: 'stack', label: 'Stack' },
      { kind: 'container', label: 'Container' },
      { kind: 'divider', label: 'Divider' },
    ],
  },
  {
    category: 'Text',
    items: [
      { kind: 'heading', label: 'Heading' },
      { kind: 'text', label: 'Text' },
    ],
  },
  {
    category: 'Forms',
    items: [{ kind: 'button', label: 'Button' }],
  },
  {
    category: 'Assets',
    items: [{ kind: 'image', label: 'Image' }],
  },
]

const BREAKPOINT_WIDTH: Record<Breakpoint, number> = { desktop: 900, tablet: 768, mobile: 375 }
const BREAKPOINT_LABEL: Record<Breakpoint, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' }

export function ScreenDesignerView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeFlow = useFlowStore((s) => s.activeFlow)
  const tree = useDesignStore((s) => s.tree)
  const selectedId = useDesignStore((s) => s.selectedId)
  const select = useDesignStore((s) => s.select)
  const dispatch = useDesignStore((s) => s.dispatch)
  const undo = useDesignStore((s) => s.undo)
  const redo = useDesignStore((s) => s.redo)
  const past = useDesignStore((s) => s.past)
  const future = useDesignStore((s) => s.future)
  const saving = useDesignStore((s) => s.saving)
  const breakpoint = useDesignStore((s) => s.breakpoint)
  const setBreakpoint = useDesignStore((s) => s.setBreakpoint)
  const closeScreen = useDesignStore((s) => s.closeScreen)
  const setView = useUiStore((s) => s.setView)
  const [leftTab, setLeftTab] = useState<'layers' | 'insert'>('layers')

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId && tree && selectedId !== tree.id) {
        e.preventDefault()
        dispatch({ type: 'DeleteNode', nodeId: selectedId })
        select(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, dispatch, selectedId, tree, select])

  if (!tree || !activeFlow || !activeProject) return null

  const selectedNode = selectedId ? findNode(tree, selectedId) : null
  const insertTargetId = selectedNode && (selectedNode.kind === 'stack' || selectedNode.kind === 'container') ? selectedNode.id : tree.id

  function handleInsert(kind: PrimitiveKind) {
    const node = createPrimitiveNode(kind)
    const target = findNode(tree!, insertTargetId)
    const index = target ? target.children.length : 0
    dispatch({ type: 'InsertComponent', parentId: insertTargetId, index, node })
    select(node.id)
  }

  function handleBack() {
    closeScreen()
    setView('flow-workspace')
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-raised px-4">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={handleBack} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/5">
            <ChevronRightIcon className="h-3.5 w-3.5 rotate-180 text-text-2" />
          </button>
          <FrameMark className="h-[14px] w-[14px] text-accent-2" />
          <span className="font-mono text-[12px] text-text-3">{activeFlow.name}</span>
          <ChevronRightIcon className="h-3 w-3 text-text-3" />
          <span className="text-[13.5px] font-semibold text-text">Screen</span>
          <span className="ml-1 text-[11px] text-text-3">{saving ? 'Saving…' : 'Saved'}</span>
        </div>

        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-panel-2 p-0.5">
          {(['desktop', 'tablet', 'mobile'] as const).map((bp) => (
            <button
              key={bp}
              type="button"
              onClick={() => setBreakpoint(bp)}
              className={`rounded-md px-3 py-1.5 text-[11.5px] font-semibold ${
                breakpoint === bp ? 'bg-accent/20 text-accent-2' : 'text-text-2'
              }`}
            >
              {BREAKPOINT_LABEL[bp]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={past.length === 0}
            className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[11.5px] font-semibold text-text-2 disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={future.length === 0}
            className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[11.5px] font-semibold text-text-2 disabled:opacity-40"
          >
            Redo
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left panel — Layers / Insert */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-raised">
          <div className="flex border-b border-border">
            {(['layers', 'insert'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setLeftTab(tab)}
                className={`flex-1 py-2.5 text-center text-[12px] font-semibold capitalize ${
                  leftTab === tab ? 'border-b-2 border-accent-2 text-text' : 'text-text-3'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2.5">
            {leftTab === 'layers' ? <LayersPanel tree={tree} /> : <InsertTab onInsert={handleInsert} />}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-bg p-10" onClick={() => select(null)}>
          <div className="mb-3 text-center font-mono text-[11px] text-text-3">
            {BREAKPOINT_WIDTH[breakpoint]}px · {BREAKPOINT_LABEL[breakpoint]}
          </div>
          <div
            className="mx-auto min-h-[600px] rounded-xl border border-border bg-panel p-8 transition-[width] duration-200"
            style={{ width: BREAKPOINT_WIDTH[breakpoint] }}
          >
            <RenderNode node={tree} />
          </div>
        </div>

        {/* Right panel — properties */}
        <div className="w-64 shrink-0 border-l border-border bg-bg-raised p-3">
          {selectedNode ? (
            <SelectedNodePanel node={selectedNode} tree={tree} breakpoint={breakpoint} />
          ) : (
            <div className="text-[11.5px] text-text-3">Select an element to edit its properties.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function InsertTab({ onInsert }: { onInsert: (kind: PrimitiveKind) => void }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return INSERT_CATEGORIES
    return INSERT_CATEGORIES.map((c) => ({ ...c, items: c.items.filter((i) => i.label.toLowerCase().includes(q)) })).filter(
      (c) => c.items.length > 0,
    )
  }, [query])

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-panel-2 px-2.5 py-2">
        <SearchIcon className="h-3.5 w-3.5 text-text-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search components…"
          className="flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-3"
        />
      </div>
      {filtered.map((c) => (
        <div key={c.category}>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{c.category}</div>
          <div className="flex flex-col gap-1.5">
            {c.items.map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => onInsert(item.kind)}
                className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-left text-[12.5px] font-medium text-text-2 hover:text-text"
              >
                + {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SelectedNodePanel({ node, tree, breakpoint }: { node: DesignNode; tree: DesignNode; breakpoint: Breakpoint }) {
  const dispatch = useDesignStore((s) => s.dispatch)
  const select = useDesignStore((s) => s.select)
  const isRoot = node.id === tree.id
  const parentInfo = findParent(tree, node.id)
  const nonDesktopBp = breakpoint === 'desktop' ? null : breakpoint

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-3">{node.kind}</span>
        <EditabilityBadge editability={node.editability} />
      </div>

      {node.kind === 'stack' && (
        <>
          <Field label="Gap">
            <input
              type="number"
              min={0}
              value={node.gap}
              onChange={(e) => dispatch({ type: 'SetGap', nodeId: node.id, gap: Number(e.target.value) })}
              className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2"
            />
          </Field>
          <Field label="Direction">
            <div className="flex gap-1.5">
              {(['column', 'row'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => dispatch({ type: 'SetDirection', nodeId: node.id, direction: dir })}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[11.5px] font-semibold ${
                    node.direction === dir ? 'border-accent-2 bg-accent/15 text-accent-2' : 'border-border bg-panel-2 text-text-2'
                  }`}
                >
                  {dir === 'column' ? 'Vertical' : 'Horizontal'}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}

      {!isRoot && parentInfo && (
        <Field label="Order">
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={parentInfo.index === 0}
              onClick={() => dispatch({ type: 'MoveNode', nodeId: node.id, newParentId: parentInfo.parent.id, newIndex: parentInfo.index - 1 })}
              className="flex-1 rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[11.5px] font-semibold text-text-2 disabled:opacity-40"
            >
              Move Up
            </button>
            <button
              type="button"
              disabled={parentInfo.index === parentInfo.parent.children.length - 1}
              onClick={() => dispatch({ type: 'MoveNode', nodeId: node.id, newParentId: parentInfo.parent.id, newIndex: parentInfo.index + 1 })}
              className="flex-1 rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[11.5px] font-semibold text-text-2 disabled:opacity-40"
            >
              Move Down
            </button>
          </div>
        </Field>
      )}

      <Field label="Visibility">
        <label className="flex items-center gap-2 text-[12px] text-text-2">
          <input type="checkbox" checked={!!node.hidden} onChange={(e) => dispatch({ type: 'SetHidden', nodeId: node.id, hidden: e.target.checked })} />
          Hidden (all sizes)
        </label>
        {nonDesktopBp && (
          <label className="mt-1.5 flex items-center gap-2 text-[12px] text-text-2">
            <input
              type="checkbox"
              checked={node.responsiveHidden?.[nonDesktopBp] ?? false}
              onChange={(e) => dispatch({ type: 'SetResponsiveHidden', nodeId: node.id, breakpoint: nonDesktopBp, hidden: e.target.checked })}
            />
            Hidden on {BREAKPOINT_LABEL[nonDesktopBp]}
            {node.responsiveHidden?.[nonDesktopBp] === undefined && <span className="text-text-3">(inherits Desktop)</span>}
          </label>
        )}
      </Field>

      {!isRoot && (
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'DeleteNode', nodeId: node.id })
            select(null)
          }}
          className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11.5px] font-semibold text-danger"
        >
          Delete
        </button>
      )}
      {isRoot && <div className="text-[10.5px] text-text-3">Root screen container</div>}
    </div>
  )
}

function EditabilityBadge({ editability }: { editability: DesignNode['editability'] }) {
  const styles = {
    editable: 'text-success border-success/30 bg-success/10',
    limited: 'text-warning border-warning/30 bg-warning/10',
    locked: 'text-danger border-danger/30 bg-danger/10',
  } as const
  return <span className={`rounded px-1.5 py-px text-[9px] font-bold uppercase ${styles[editability]}`}>{editability}</span>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] text-text-3">{label}</div>
      {children}
    </div>
  )
}
