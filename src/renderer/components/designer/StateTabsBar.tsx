import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, MoreHorizontal, Video, Pencil } from 'lucide-react'
import type { DesignState, DesignStateOrigin, PageRef, Provenance } from '@shared/types/model/featureModel'
import type { CapturedPage } from '@shared/types/runtimeCapture'
import { matchRoutePattern } from '@core/design-model/matchRoutePattern'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'
import { useProjectStore } from '../../state/projectStore'

/**
 * Phase 17 — State Tabs bar. Lists a page's `DesignState`s as a horizontal
 * segmented strip above the canvas (mirrors the breakpoint switcher's visual
 * language in `ScreenDesignerView.tsx`: `bg-panel-2` / `border-border` /
 * `accent-2` for the active segment) and drives create/duplicate/rename/
 * delete/reorder entirely through the already-built Phase 17 IPC surface —
 * this file owns no persistence logic of its own beyond the one judgment
 * call documented on `seedCapturedStateTree` below.
 */

const ORIGIN_LABEL: Record<DesignStateOrigin, string> = { design: 'Design', captured: 'Captured' }
const ORIGIN_NOTE: Record<DesignStateOrigin, string> = {
  design: 'Design content — never written to the application.',
  captured: 'Captured from the running application.',
}

export function StateTabsBar(props: {
  projectId: string
  featureId: string
  pageRef: PageRef
  activeStateId: string | null
  onSelectState: (stateId: string) => void
}) {
  const { projectId, featureId, pageRef, activeStateId, onSelectState } = props
  const [states, setStates] = useState<DesignState[]>([])
  const [loaded, setLoaded] = useState(false)
  const [creating, setCreating] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [duplicateTarget, setDuplicateTarget] = useState<{ sourceId: string; asOrigin: DesignStateOrigin; name: string } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  async function refresh(): Promise<DesignState[]> {
    const list = await window.frameui.workspace.listDesignStatesForPage(projectId, pageRef)
    setStates(list)
    setLoaded(true)
    return list
  }

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    ;(async () => {
      const list = await refresh()
      if (cancelled) return
      // Robustness fallback (spec: the designer must never see an empty tab
      // bar) — the normal path already auto-creates "Default" before this
      // bar mounts (`designThisPage.ts` / `handleDesignNewPage`), so this
      // only fires for an edge case that slipped through.
      if (list.length === 0) {
        const provenance: Provenance = pageRef.kind === 'existing' ? 'existing' : 'new'
        const created = await window.frameui.workspace.createDesignState(projectId, {
          featureId,
          pageRef,
          pageSlugHint: 'default',
          name: 'Default',
          origin: 'design',
          provenance,
        })
        if (cancelled) return
        setStates([created])
        onSelectState(created.id)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pageRef.kind, pageRef.pageId])

  const activeState = useMemo(() => states.find((s) => s.id === activeStateId) ?? null, [states, activeStateId])

  async function handleCreated(state: DesignState) {
    await refresh()
    onSelectState(state.id)
  }

  async function handleDelete(stateId: string) {
    if (!window.confirm('Delete this state? Its design tree and any Alternatives built on it will be removed.')) return
    setMenuOpenId(null)
    await window.frameui.workspace.deleteDesignState(projectId, stateId)
    const remaining = await refresh()
    if (activeStateId === stateId) {
      if (remaining.length > 0) onSelectState(remaining[0].id)
    }
  }

  async function commitRename(state: DesignState) {
    const name = renameValue.trim()
    setRenamingId(null)
    if (!name || name === state.name) return
    await window.frameui.workspace.saveDesignState(projectId, { ...state, name })
    await refresh()
  }

  async function handleReorder(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = states.map((s) => s.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(states, oldIndex, newIndex)
    setStates(reordered) // optimistic — avoids a visible snap-back while the IPC round-trips
    await window.frameui.workspace.reorderDesignStates(projectId, reordered.map((s) => s.id))
  }

  async function runDuplicate() {
    if (!duplicateTarget) return
    const { sourceId, asOrigin, name } = duplicateTarget
    const finalName = name.trim() || 'Copy'
    setDuplicateTarget(null)
    const created = await window.frameui.workspace.duplicateDesignState(projectId, sourceId, finalName, asOrigin)
    await handleCreated(created)
  }

  if (!loaded) {
    return <div className="flex h-10 shrink-0 items-center border-b border-border bg-bg-raised px-3 text-[11px] text-text-3">Loading states…</div>
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-raised px-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleReorder(e)}>
        <SortableContext items={states.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-panel-2 p-0.5">
            {states.map((state) => (
              <StateTab
                key={state.id}
                state={state}
                active={state.id === activeStateId}
                renaming={renamingId === state.id}
                renameValue={renameValue}
                menuOpen={menuOpenId === state.id}
                onSelect={() => onSelectState(state.id)}
                onStartRename={() => {
                  setRenamingId(state.id)
                  setRenameValue(state.name)
                  setMenuOpenId(null)
                }}
                onRenameChange={setRenameValue}
                onRenameCommit={() => void commitRename(state)}
                onRenameCancel={() => setRenamingId(null)}
                onToggleMenu={() => setMenuOpenId(menuOpenId === state.id ? null : state.id)}
                onCloseMenu={() => setMenuOpenId(null)}
                onDuplicate={(asOrigin) => {
                  setMenuOpenId(null)
                  setDuplicateTarget({
                    sourceId: state.id,
                    asOrigin,
                    name: asOrigin === 'design' && state.origin === 'captured' ? `${state.name} (Design)` : `${state.name} Copy`,
                  })
                }}
                onDelete={() => void handleDelete(state.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={() => setCreating(true)}
        title="Create a new state"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-text-2 hover:text-text"
      >
        <Plus size={13} />
      </button>

      {activeState && (
        <span className="ml-1 shrink-0 truncate text-[10.5px] text-text-3" title={ORIGIN_NOTE[activeState.origin]}>
          {ORIGIN_NOTE[activeState.origin]}
        </span>
      )}

      {creating && (
        <CreateStateForm
          projectId={projectId}
          featureId={featureId}
          pageRef={pageRef}
          onCreated={(state) => {
            setCreating(false)
            void handleCreated(state)
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {duplicateTarget && (
        <DuplicatePrompt
          initialName={duplicateTarget.name}
          asOrigin={duplicateTarget.asOrigin}
          onConfirm={(name) => {
            setDuplicateTarget({ ...duplicateTarget, name })
            void runDuplicate()
          }}
          onCancel={() => setDuplicateTarget(null)}
        />
      )}
    </div>
  )
}

function StateTab({
  state,
  active,
  renaming,
  renameValue,
  menuOpen,
  onSelect,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onToggleMenu,
  onCloseMenu,
  onDuplicate,
  onDelete,
}: {
  state: DesignState
  active: boolean
  renaming: boolean
  renameValue: string
  menuOpen: boolean
  onSelect: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
  onDuplicate: (asOrigin: DesignStateOrigin) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: state.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onCloseMenu()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen, onCloseMenu])

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold ${
        active ? 'bg-accent/20 text-accent-2' : 'text-text-2 hover:bg-white/5 hover:text-text'
      }`}
    >
      {renaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameCommit()
            if (e.key === 'Escape') onRenameCancel()
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-28 rounded bg-black/20 px-1 py-0.5 text-[11.5px] text-text outline-none"
        />
      ) : (
        <button type="button" onClick={onSelect} onDoubleClick={onStartRename} className="whitespace-nowrap">
          {state.name}
        </button>
      )}

      <OriginTag origin={state.origin} />

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleMenu()
          }}
          title="State actions"
          className="rounded px-0.5 text-text-3 opacity-0 hover:text-text group-hover:opacity-100"
        >
          <MoreHorizontal size={12} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-6 z-20 flex w-48 flex-col overflow-hidden rounded-md border border-border bg-bg-raised py-1 shadow-lg">
            <MenuItem label="Rename" onClick={onStartRename} icon={<Pencil size={11} />} />
            <MenuItem label="Duplicate" onClick={() => onDuplicate(state.origin)} />
            {state.origin === 'captured' && <MenuItem label="Duplicate as Design State" onClick={() => onDuplicate('design')} />}
            {state.origin === 'design' && <MenuItem label="Duplicate as Captured" onClick={() => onDuplicate('captured')} />}
            <div className="my-1 border-t border-border" />
            <MenuItem label="Delete" onClick={onDelete} danger />
          </div>
        )}
      </div>
    </div>
  )
}

function OriginTag({ origin }: { origin: DesignStateOrigin }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-[3px] px-1 py-px text-[9px] font-medium uppercase tracking-wide ${
        origin === 'captured' ? 'text-warning/80' : 'text-text-3'
      }`}
      title={ORIGIN_NOTE[origin]}
    >
      {origin === 'captured' && <Video size={9} />}
      {ORIGIN_LABEL[origin]}
    </span>
  )
}

function MenuItem({ label, onClick, icon, danger }: { label: string; onClick: () => void; icon?: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-left text-[11.5px] font-medium hover:bg-white/5 ${danger ? 'text-danger' : 'text-text-2 hover:text-text'}`}
    >
      {icon}
      {label}
    </button>
  )
}

function DuplicatePrompt({
  initialName,
  asOrigin,
  onConfirm,
  onCancel,
}: {
  initialName: string
  asOrigin: DesignStateOrigin
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="w-80 rounded-lg border border-border bg-bg-raised p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[12.5px] font-semibold text-text">Duplicate as {ORIGIN_LABEL[asOrigin]} State</div>
        <p className="mb-3 text-[10.5px] leading-relaxed text-text-3">{ORIGIN_NOTE[asOrigin]}</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onConfirm(name)}
          className="mb-3 w-full rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] text-text outline-none"
          placeholder="State name"
        />
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={onCancel} className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[11.5px] font-semibold text-text-2">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(name)}
            className="rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-accent-2"
          >
            Duplicate
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateStateForm({
  projectId,
  featureId,
  pageRef,
  onCreated,
  onClose,
}: {
  projectId: string
  featureId: string
  pageRef: PageRef
  onCreated: (state: DesignState) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [origin, setOrigin] = useState<DesignStateOrigin>('design')
  const [captures, setCaptures] = useState<CapturedPage[]>([])
  const [capturesLoaded, setCapturesLoaded] = useState(false)
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const projectModel = useProjectStore((s) => s.activeIndex?.projectModel ?? null)

  useEffect(() => {
    if (origin !== 'captured' || capturesLoaded) return
    ;(async () => {
      const all = await window.frameui.capture.list(projectId)
      setCaptures(filterCapturesForPage(all, pageRef, projectModel))
      setCapturesLoaded(true)
    })()
  }, [origin, capturesLoaded, projectId, pageRef, projectModel])

  async function handleSubmit() {
    const finalName = name.trim() || (origin === 'captured' ? 'Captured' : 'New State')
    if (origin === 'captured' && !selectedCaptureId) return
    setBusy(true)
    try {
      const provenance: Provenance = pageRef.kind === 'existing' ? 'existing' : 'new'
      const created = await window.frameui.workspace.createDesignState(projectId, {
        featureId,
        pageRef,
        pageSlugHint: finalName,
        name: finalName,
        origin,
        capturedPageId: origin === 'captured' ? selectedCaptureId : null,
        provenance,
      })
      if (origin === 'captured') {
        // Judgment call (spec's genuinely ambiguous area, documented on the
        // component-level comment too): a CapturedPage is DOM + computed
        // styles, not a DesignNode tree. Best-effort honesty over
        // fabrication — try to seed from the *real* matching page's actual
        // source structure (the exact path `buildExistingPageDraftTree`
        // already uses for "Design This Page"), and only when that
        // resolution fails do we leave it to `designStore.loadDesignState`'s
        // own blank-tree fallback, which already runs for any state with no
        // saved tree yet.
        await seedCapturedStateTree(projectId, created.id, selectedCaptureId!, projectModel)
      }
      onCreated(created)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-lg border border-border bg-bg-raised p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-[12.5px] font-semibold text-text">New State</div>

        <div className="mb-1 text-[10.5px] text-text-3">Name</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={origin === 'captured' ? 'Captured' : 'e.g. Validation Error'}
          className="mb-3 w-full rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] text-text outline-none"
        />

        <div className="mb-1 text-[10.5px] text-text-3">Origin</div>
        <div className="mb-3 flex items-center gap-0.5 rounded-lg border border-border bg-panel-2 p-0.5">
          {(['design', 'captured'] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOrigin(o)}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold ${origin === o ? 'bg-accent/20 text-accent-2' : 'text-text-2'}`}
            >
              {ORIGIN_LABEL[o]}
            </button>
          ))}
        </div>
        <p className="mb-3 text-[10.5px] leading-relaxed text-text-3">{ORIGIN_NOTE[origin]}</p>

        {origin === 'captured' && (
          <div className="mb-3">
            <div className="mb-1 text-[10.5px] text-text-3">Captured page</div>
            {!capturesLoaded ? (
              <div className="text-[11px] text-text-3">Loading captures…</div>
            ) : captures.length === 0 ? (
              <div className="rounded-md border border-border bg-panel-2 px-2.5 py-2 text-[11px] text-text-3">
                No captures found for this page yet. Run a Capture Session first.
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                {captures.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCaptureId(c.id)}
                    className={`flex w-full flex-col gap-0.5 border-b border-border px-2.5 py-2 text-left last:border-b-0 ${
                      selectedCaptureId === c.id ? 'bg-accent/15' : 'bg-panel-2 hover:bg-white/5'
                    }`}
                  >
                    <span className="truncate font-mono text-[10.5px] text-text-2">{c.url}</span>
                    <span className="text-[9.5px] text-text-3">{new Date(c.capturedAt).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={onClose} className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[11.5px] font-semibold text-text-2">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || (origin === 'captured' && !selectedCaptureId)}
            onClick={() => void handleSubmit()}
            className="rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Best-effort filter, not a hard guarantee — a Feature-invented page has no
 * real `RoutePattern` to check against, so captures are only narrowed for an
 * existing page (via `matchRoutePattern` against the resolved `Page.id`),
 * and left unfiltered for a 'new' page since there's nothing reliable to
 * match against yet. */
function filterCapturesForPage(
  captures: CapturedPage[],
  pageRef: PageRef,
  projectModel: import('@shared/types/model/projectModel').ProjectModel | null,
): CapturedPage[] {
  if (pageRef.kind !== 'existing' || !projectModel) return captures
  const filtered = captures.filter((c) => {
    const match = matchRoutePattern(c.url, projectModel.routes)
    return match?.route.pageId === pageRef.pageId
  })
  // If route matching found nothing (e.g. routes weren't detected for this
  // project), fall back to showing everything rather than hiding all
  // captures behind a filter that can't actually resolve.
  return filtered.length > 0 ? filtered : captures
}

/** The one genuinely ambiguous area of this phase (see spec background) —
 * resolves the real page a capture came from via `matchRoutePattern` and
 * seeds the new captured DesignState's tree from that page's actual source
 * structure, the same way `designThisPage.ts` does for "Design This Page".
 * Silently no-ops on any resolution failure: `designStore.loadDesignState`
 * already falls back to a blank tree for a state with none saved, so this
 * is a pure best-effort upgrade, never a required step. */
async function seedCapturedStateTree(
  projectId: string,
  designStateId: string,
  capturedPageId: string,
  projectModel: import('@shared/types/model/projectModel').ProjectModel | null,
): Promise<void> {
  if (!projectModel) return
  try {
    const captures = await window.frameui.capture.list(projectId)
    const capture = captures.find((c) => c.id === capturedPageId)
    if (!capture) return
    const match = matchRoutePattern(capture.url, projectModel.routes)
    if (!match) return
    const page = projectModel.pages.find((p) => p.id === match.route.pageId)
    if (!page) return
    const structure = await window.frameui.project.getPageStructure(page.source.filePath)
    const tree = buildExistingPageDraftTree(crypto.randomUUID(), structure, page.source.filePath)
    await window.frameui.workspace.saveDesignTree({ ownerId: designStateId, projectId, tree, updatedAt: new Date().toISOString() })
  } catch {
    // Best-effort only — leave it to the blank-tree fallback.
  }
}
