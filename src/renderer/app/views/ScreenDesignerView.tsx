import { PanelControls } from '../../components/shell/PanelControls'
import { ResizablePanel } from '../../components/shell/ResizablePanel'
import { useLocalPreference } from '../../state/useLocalPreference'
import { useEffect, useMemo, useState } from 'react'
import { useDesignStore } from '../../state/designStore'
import { useFlowStore } from '../../state/flowStore'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { useConceptComponentStore } from '../../state/conceptComponentStore'
import { CanvasRoot } from '../../components/designer/RenderNode'
import { LayersPanel } from '../../components/designer/LayersPanel'
import { LayoutInspector } from '../../components/designer/LayoutInspector'
import { ComponentLibraryPanel } from '../../components/designer/ComponentLibraryPanel'
import { ChevronRightIcon, FrameMark, SearchIcon } from '../../components/icons/icons'
import { findNode, findParent } from '@core/design-model/tree'
import { createPrimitiveNode } from '@core/design-model/createPrimitiveNode'
import { classifyEditability } from '@core/design-model/editability'
import { resolveProjectBreakpoints } from '@core/design-model/resolveBreakpoints'
import type { PrimitiveKind, PlaceholderNode, Breakpoint } from '@shared/types/designNode'
import type { Component, Page } from '@shared/types/model/projectModel'

const INSERT_CATEGORIES: { category: string; items: { kind: PrimitiveKind; label: string }[] }[] = [
  {
    category: 'Layout',
    items: [
      { kind: 'stack', label: 'Stack' },
      { kind: 'grid', label: 'Grid' },
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

const BREAKPOINT_LABEL: Record<Breakpoint, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' }

export function ScreenDesignerView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
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
  const copy = useDesignStore((s) => s.copy)
  const paste = useDesignStore((s) => s.paste)
  const duplicateSelected = useDesignStore((s) => s.duplicateSelected)
  const conceptComponents = useConceptComponentStore((s) => s.components)
  const setView = useUiStore((s) => s.setView)
  const layoutKey = `frameui:ScreenDesignerView:${activeProject?.id}:layout:v1`
  const [leftOpen, setLeftOpen] = useLocalPreference(`${layoutKey}:left`, true)
  const [rightOpen, setRightOpen] = useLocalPreference(`${layoutKey}:right`, true)
  const [leftTab, setLeftTab] = useState<'layers' | 'insert'>('layers')
  const breakpointWidths = useMemo(() => resolveProjectBreakpoints(activeIndex?.projectModel.tokens ?? []), [activeIndex])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId && tree && selectedId !== tree.id) {
        e.preventDefault()
        dispatch({ type: 'DeleteNode', nodeId: selectedId })
        select(null)
      } else if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (meta && e.key.toLowerCase() === 'c') {
        if (selectedId) {
          e.preventDefault()
          copy(selectedId)
        }
      } else if (meta && e.key.toLowerCase() === 'v') {
        if (!tree) return
        e.preventDefault()
        // Paste targets the selected node's parent (inserted right after
        // it), or the tree root when nothing is selected — never inside
        // the selected node itself.
        const parentInfo = selectedId ? findParent(tree, selectedId) : null
        const targetParentId = parentInfo ? parentInfo.parent.id : tree.id
        const index = parentInfo ? parentInfo.index + 1 : tree.children.length
        paste(targetParentId, index)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, dispatch, selectedId, tree, select, copy, paste, duplicateSelected])

  if (!tree || !activeFlow || !activeProject) return null

  const selectedNode = selectedId ? findNode(tree, selectedId) : null
  const insertTargetId = selectedNode && (selectedNode.kind === 'stack' || selectedNode.kind === 'container') ? selectedNode.id : tree.id

  function handleInsertPrimitive(kind: PrimitiveKind) {
    const node = createPrimitiveNode(kind)
    const target = findNode(tree!, insertTargetId)
    const index = target ? target.children.length : 0
    dispatch({ type: 'InsertComponent', parentId: insertTargetId, index, node })
    select(node.id)
  }

  /**
   * CMP: inserts a real detected project component as an instance in the
   * design tree — not a generic primitive. Props aren't statically typed
   * yet (a documented later-phase extension), so honestly it's `limited`
   * editability per §26: move/resize-as-unit/hide/duplicate/swap, not deep
   * prop editing we haven't actually earned.
   */
  function handleInsertComponent(component: Component) {
    const node: PlaceholderNode = {
      kind: 'placeholder',
      id: crypto.randomUUID(),
      editability: classifyEditability('project-component-partial'),
      provenance: 'existing',
      children: [],
      label: component.name,
      sourceFilePath: component.source.filePath,
    }
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
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-raised px-4">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={handleBack} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover">
            <ChevronRightIcon className="h-3.5 w-3.5 rotate-180 text-text-2" />
          </button>
          <PanelControls left={leftOpen} right={rightOpen} setLeft={setLeftOpen} setRight={setRightOpen}/><FrameMark className="h-[14px] w-[14px] text-accent-2" />
          <span className="font-mono text-[12px] text-text-3">{activeFlow.name}</span>
          <ChevronRightIcon className="h-3 w-3 text-text-3" />
          <span className="text-[13px] font-semibold text-text">Screen</span>
          <span className="ml-1 text-[12px] text-text-3">{saving ? 'Saving…' : 'Saved'}</span>
        </div>

        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-panel-2 p-0.5">
          {(['desktop', 'tablet', 'mobile'] as const).map((bp) => (
            <button
              key={bp}
              type="button"
              onClick={() => setBreakpoint(bp)}
              title={breakpointWidths.source === 'fallback' ? 'Using default breakpoints — none detected in this project' : undefined}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
                breakpoint === bp ? 'bg-selected text-accent-2' : 'text-text-2'
              }`}
            >
              {BREAKPOINT_LABEL[bp]}
              {breakpointWidths.source === 'fallback' && <span className="text-text-3"> (default)</span>}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={past.length === 0}
            className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] font-semibold text-text-2 disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={future.length === 0}
            className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] font-semibold text-text-2 disabled:opacity-40"
          >
            Redo
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left panel — Layers / Insert */}
        {leftOpen && <ResizablePanel storageKey={`${layoutKey}:left-width`}><div className="flex w-full shrink-0 flex-col border-r border-border bg-bg-raised">
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
            {leftTab === 'layers' ? (
              <LayersPanel tree={tree} />
            ) : (
              <InsertTab
                onInsert={handleInsertPrimitive}
                onInsertComponent={handleInsertComponent}
                components={activeIndex?.projectModel.components ?? []}
                pages={activeIndex?.projectModel.pages ?? []}
                activeProjectId={activeProject.id}
              />
            )}
          </div>
        </div></ResizablePanel>}

        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-bg p-4" onClick={() => select(null)}>
          <div className="mb-3 text-center font-mono text-[12px] text-text-3">
            {breakpointWidths[breakpoint]}px · {BREAKPOINT_LABEL[breakpoint]}
            {breakpointWidths.source === 'fallback' && ' (default)'}
          </div>
          <div
            className="mx-auto min-h-[600px] rounded-xl border border-border bg-panel p-4 transition-[width] duration-200"
            style={{ width: breakpointWidths[breakpoint] }}
          >
            <CanvasRoot node={tree} />
          </div>
        </div>

        {/* Right panel — properties */}
        {rightOpen && <ResizablePanel side="right" storageKey={`${layoutKey}:right-width`}><div className="w-full overflow-y-auto shrink-0 border-l border-border bg-bg-raised p-3">
          {selectedNode ? (
            <LayoutInspector
              node={selectedNode}
              tree={tree}
              breakpoint={breakpoint}
              components={activeIndex?.projectModel.components ?? []}
              conceptComponents={conceptComponents}
              tokens={activeIndex?.projectModel.tokens ?? []}
              dispatch={dispatch}
              onSelect={select}
            />
          ) : (
            <div className="text-[12px] text-text-3">Select an element to edit its properties.</div>
          )}
        </div></ResizablePanel>}
      </div>
    </div>
  )
}

function InsertTab({
  onInsert,
  onInsertComponent,
  components,
  pages,
  activeProjectId,
}: {
  onInsert: (kind: PrimitiveKind) => void
  onInsertComponent: (component: Component) => void
  components: Component[]
  pages: Page[]
  activeProjectId: string
}) {
  const [query, setQuery] = useState('')

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return INSERT_CATEGORIES
    return INSERT_CATEGORIES.map((c) => ({ ...c, items: c.items.filter((i) => i.label.toLowerCase().includes(q)) })).filter(
      (c) => c.items.length > 0,
    )
  }, [query])

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-text-3">Project Components</div>
        <ComponentLibraryPanel components={components} pages={pages} activeProjectId={activeProjectId} onInsert={onInsertComponent} />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-panel-2 px-2.5 py-2">
        <SearchIcon className="h-3.5 w-3.5 text-text-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search primitives…"
          className="flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-3"
        />
      </div>

      {filteredCategories.map((c) => (
        <div key={c.category}>
          <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-text-3">{c.category}</div>
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

// The right-inspector's implementation lives in `LayoutInspector.tsx` now —
// this view only wires selection/dispatch/tree/tokens into it (see the
// right-panel JSX above). Keeping property-editing UI out of this file
// avoids two divergent inspectors from growing side by side.
