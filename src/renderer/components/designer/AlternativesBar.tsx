import { pendingWorkspaceSaves } from '../../state/pendingSaves'
import { useEffect, useState } from 'react'
import { Star, Check, Plus, Trash2, Pencil, X, Info, GitCompare } from 'lucide-react'
import type { Alternative } from '@shared/types/model/featureModel'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import { useDesignStore } from '../../state/designStore'
import { RenderNode } from './RenderNode'
import { applyDesignOperations } from '@core/design-model/operations'

/**
 * Phase 19 — Current/Concept A/Concept B/Approved selector for one
 * DesignState (spec: "don't require duplicating an entire Feature just to
 * test another design"). "Current" is not a real `Alternative` row — it's
 * the DesignState's own base tree, always shown first and always
 * selectable via `onSelectAlternative(null)`.
 */

const BREAKPOINT_WIDTH: Record<Breakpoint, number> = { desktop: 900, tablet: 768, mobile: 375 }

interface AlternativeMetadata {
  existingReused: number
  existingModified: number
  newComponents: number
  layoutChanges: number
}

interface ComparePane {
  key: string
  label: string
  tree: DesignNode | null
}

export function AlternativesBar(props: {
  projectId: string
  featureId: string
  designStateId: string
  activeAlternativeId: string | null
  onSelectAlternative: (alternativeId: string | null) => void
}) {
  const { projectId, featureId, designStateId, activeAlternativeId, onSelectAlternative } = props

  const breakpoint = useDesignStore((s) => s.breakpoint)
  const storeTree = useDesignStore((s) => s.tree)
  const storeDesignStateId = useDesignStore((s) => s.designStateId)
  const storeAlternativeId = useDesignStore((s) => s.alternativeId)
  const storeOperations = useDesignStore((s) => s.operations)

  const [alternatives, setAlternatives] = useState<Alternative[]>([])

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [creatingBusy, setCreatingBusy] = useState(false)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [metadataOpen, setMetadataOpen] = useState(false)
  const [metadata, setMetadata] = useState<AlternativeMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)

  const [compareOpen, setCompareOpen] = useState(false)
  // `null` in this selection represents "Current" (the base tree).
  const [compareSelection, setCompareSelection] = useState<(string | null)[]>([])
  const [comparePanes, setComparePanes] = useState<ComparePane[] | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)

  async function refresh() {
    const list = await window.frameui.workspace.listAlternativesForState(projectId, designStateId)
    setAlternatives(list)
  }

  useEffect(() => {
    void refresh()
    setComparePanes(null)
    setCompareOpen(false)
    setCompareSelection([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, designStateId])

  // Recomputes the metadata panel whenever the active selection changes, or
  // the alternatives list itself changes (e.g. a rename/delete).
  useEffect(() => {
    void loadMetadata()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, designStateId, activeAlternativeId, alternatives.length])

  /** Reuses the tree already loaded in `useDesignStore` when it happens to
   * be the one we need — avoids a redundant `getDesignTree` round trip for
   * the common case where the metadata panel is describing whatever the
   * canvas already has open. */
  async function resolveTree(ownerId: string): Promise<DesignNode | null> {
    const currentlyLoadedOwnerId = storeAlternativeId ?? storeDesignStateId
    if (storeDesignStateId === designStateId && currentlyLoadedOwnerId === ownerId && storeTree) {
      return storeTree
    }
    const record = await window.frameui.workspace.getDesignTree(projectId, ownerId)
    if (!record) return null
    const operations = await window.frameui.workspace.getDesignOperations(projectId, featureId, ownerId)
    return applyDesignOperations(record.tree, operations)
  }

  async function loadMetadata() {
    setMetadataLoading(true)
    try {
      const activeOwnerId = activeAlternativeId ?? designStateId
      const activeTree = await resolveTree(activeOwnerId)
      if (!activeTree) {
        setMetadata(null)
        return
      }
      const counts = { existing: 0, modified: 0, new: 0 }
      countComponentProvenance(activeTree, counts)
      // Layout changes only mean something once we're looking at something
      // other than Current itself — Current diffed against Current is
      // trivially zero, not worth a fetch.
      let layoutChanges = 0
      if (activeAlternativeId) {
        const baseTree = await resolveTree(designStateId)
        if (baseTree) layoutChanges = diffLayout(activeTree, baseTree)
      }
      setMetadata({ existingReused: counts.existing, existingModified: counts.modified, newComponents: counts.new, layoutChanges })
    } finally {
      setMetadataLoading(false)
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name || creatingBusy) return
    setCreatingBusy(true)
    try {
      const sourceOwnerId = activeAlternativeId ?? designStateId
      if ((storeAlternativeId ?? storeDesignStateId) === sourceOwnerId) {
        await window.frameui.workspace.saveDesignOperations(projectId, featureId, sourceOwnerId, storeOperations)
      }
      await pendingWorkspaceSaves.flush()
      const alt = await window.frameui.workspace.createAlternative(projectId, {
        featureId,
        designStateId,
        designStateSlugHint: designStateId,
        name,
        sourceOwnerId,
      })
      setNewName('')
      setCreating(false)
      await refresh()
      onSelectAlternative(alt.id)
    } finally {
      setCreatingBusy(false)
    }
  }

  function startRename(alt: Alternative) {
    setRenamingId(alt.id)
    setRenameDraft(alt.name)
  }

  async function commitRename(alt: Alternative) {
    const name = renameDraft.trim()
    setRenamingId(null)
    if (!name || name === alt.name) return
    const saved = await window.frameui.workspace.saveAlternative(projectId, { ...alt, name })
    setAlternatives((prev) => prev.map((a) => (a.id === saved.id ? saved : a)))
  }

  async function handleSetPreferred(alt: Alternative) {
    await window.frameui.workspace.setAlternativePreferred(projectId, alt.id)
    await refresh()
  }

  async function handleSetApproved(alt: Alternative) {
    await window.frameui.workspace.setAlternativeApproved(projectId, alt.id)
    await refresh()
  }

  async function handleDelete(alt: Alternative) {
    await pendingWorkspaceSaves.flush()
    await window.frameui.workspace.deleteAlternative(projectId, alt.id)
    setConfirmDeleteId(null)
    await refresh()
    if (activeAlternativeId === alt.id) onSelectAlternative(null)
  }

  function toggleCompareSelection(key: string | null) {
    setCompareSelection((prev) => {
      const has = prev.some((k) => k === key)
      return has ? prev.filter((k) => k !== key) : [...prev, key]
    })
  }

  async function runCompare() {
    if (compareSelection.length < 2) return
    setCompareLoading(true)
    try {
      const panes = await Promise.all(
        compareSelection.map(async (key): Promise<ComparePane> => {
          const ownerId = key ?? designStateId
          const label = key === null ? 'Current' : (alternatives.find((a) => a.id === key)?.name ?? 'Alternative')
          const tree = await resolveTree(ownerId)
          return { key: key ?? '__current__', label, tree }
        }),
      )
      setComparePanes(panes)
    } finally {
      setCompareLoading(false)
    }
  }

  const paneWidth = BREAKPOINT_WIDTH[breakpoint] / 1.6

  return (
    <div className="relative flex items-center gap-1.5 border-b border-border bg-bg-raised px-3 py-1.5">
      <button
        type="button"
        onClick={() => onSelectAlternative(null)}
        className={`rounded-md border px-2.5 py-1 text-[11.5px] font-semibold ${
          activeAlternativeId === null ? 'border-accent-2 bg-selected text-accent-2' : 'border-border bg-panel-2 text-text-2 hover:text-text'
        }`}
      >
        Current
      </button>

      {alternatives.map((alt) => (
        <div
          key={alt.id}
          className={`flex items-center gap-1 rounded-md border px-1.5 py-1 ${
            activeAlternativeId === alt.id ? 'border-accent-2 bg-selected text-accent-2' : 'border-border bg-panel-2 text-text-2'
          }`}
        >
          {renamingId === alt.id ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => void commitRename(alt)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(alt)
                if (e.key === 'Escape') setRenamingId(null)
              }}
              className="w-24 bg-transparent text-[12px] outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => onSelectAlternative(alt.id)}
              onDoubleClick={() => startRename(alt)}
              title="Click to select, double-click to rename"
              className="text-[11.5px] font-medium"
            >
              {alt.name}
            </button>
          )}
          <button
            type="button"
            title={alt.isPreferred ? 'Preferred alternative' : 'Set as preferred'}
            onClick={() => void handleSetPreferred(alt)}
            className={alt.isPreferred ? 'text-warning' : 'text-text-3 hover:text-text-2'}
          >
            <Star size={11} fill={alt.isPreferred ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            title={alt.isApproved ? 'Approved alternative' : 'Set as approved'}
            onClick={() => void handleSetApproved(alt)}
            className={alt.isApproved ? 'text-success' : 'text-text-3 hover:text-text-2'}
          >
            <Check size={11} />
          </button>
          <button type="button" title="Rename" onClick={() => startRename(alt)} className="text-text-3 hover:text-text-2">
            <Pencil size={10} />
          </button>
          {confirmDeleteId === alt.id ? (
            <span className="flex items-center gap-1 pl-0.5 text-[11px] text-danger">
              Delete?
              <button type="button" onClick={() => void handleDelete(alt)} className="font-semibold underline">
                Yes
              </button>
              <button type="button" onClick={() => setConfirmDeleteId(null)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" title="Delete alternative" onClick={() => setConfirmDeleteId(alt.id)} className="text-text-3 hover:text-danger">
              <Trash2 size={10} />
            </button>
          )}
        </div>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          title="Duplicate as Alternative"
          className="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-text-3 hover:border-border-strong hover:text-text-2"
        >
          <Plus size={11} />
          New
        </button>
        {creating && (
          <div className="absolute left-0 top-9 z-30 w-64 rounded-md border border-border-strong bg-panel p-2.5 shadow-sm">
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-text-3">Duplicate as Alternative</div>
            <div className="mb-2 text-[11px] leading-relaxed text-text-3">
              Copies {activeAlternativeId ? 'the currently selected alternative' : 'Current'}'s design into a new, independent alternative.
            </div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Alternative name (e.g. Concept B)"
              className="mb-2 h-7 w-full rounded border border-border bg-bg px-2 text-[12px] text-text outline-none placeholder:text-text-3 focus:border-accent/60"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
                if (e.key === 'Escape') setCreating(false)
              }}
            />
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="text-[11px] text-text-3 hover:text-text-2">
                Cancel
              </button>
              <button
                type="button"
                disabled={!newName.trim() || creatingBusy}
                onClick={() => void handleCreate()}
                className="rounded bg-accent px-2.5 py-1 text-[11px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                {creatingBusy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setMetadataOpen((v) => !v)}
            title="Alternative metadata"
            className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] font-semibold text-text-2 hover:text-text"
          >
            <Info size={11} />
            Metadata
          </button>
          {metadataOpen && (
            <div className="absolute right-0 top-9 z-30 w-72 rounded-md border border-border-strong bg-panel p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold tracking-wide text-text-3">
                  {activeAlternativeId ? (alternatives.find((a) => a.id === activeAlternativeId)?.name ?? 'Alternative') : 'Current'}
                </div>
                <button type="button" onClick={() => setMetadataOpen(false)} className="text-text-3 hover:text-text-2">
                  <X size={12} />
                </button>
              </div>
              {metadataLoading || !metadata ? (
                <div className="text-[11px] text-text-3">{metadataLoading ? 'Computing…' : 'No design tree loaded yet.'}</div>
              ) : (
                <div className="flex flex-col gap-1.5 text-[11.5px] text-text-2">
                  <MetadataRow label="Existing components reused" value={metadata.existingReused} />
                  <MetadataRow label="Existing components modified" value={metadata.existingModified} />
                  <MetadataRow label="New components" value={metadata.newComponents} />
                  <MetadataRow
                    label="Layout changes vs Current"
                    value={activeAlternativeId ? metadata.layoutChanges : '—'}
                    hint={activeAlternativeId ? 'Nodes whose kind/direction/gap differ, or are missing/added, vs Current at the same tree position.' : undefined}
                  />
                  <MetadataRow label="New tokens introduced" value={0} hint="Not yet tracked — this build has no mechanism for a Feature to define named tokens distinct from Concept Components." />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setCompareOpen((v) => !v)
              if (!compareOpen) setCompareSelection(activeAlternativeId ? [null, activeAlternativeId] : [])
            }}
            title="Compare alternatives"
            className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] font-semibold text-text-2 hover:text-text"
          >
            <GitCompare size={11} />
            Compare
          </button>
        </div>
      </div>

      {compareOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-4">
          <div className="flex max-h-full w-full max-w-[95vw] flex-col rounded-xl border border-border-strong bg-bg-raised shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-[13px] font-semibold text-text">Compare Alternatives</div>
              <button
                type="button"
                onClick={() => {
                  setCompareOpen(false)
                  setComparePanes(null)
                }}
                className="text-text-3 hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
              <CompareCheckbox label="Current" checked={compareSelection.includes(null)} onChange={() => toggleCompareSelection(null)} />
              {alternatives.map((alt) => (
                <CompareCheckbox key={alt.id} label={alt.name} checked={compareSelection.includes(alt.id)} onChange={() => toggleCompareSelection(alt.id)} />
              ))}
              <button
                type="button"
                disabled={compareSelection.length < 2 || compareLoading}
                onClick={() => void runCompare()}
                className="ml-auto rounded-md bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                {compareLoading ? 'Loading…' : 'Show Comparison'}
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {!comparePanes ? (
                <div className="flex h-40 items-center justify-center text-[12px] text-text-3">Pick two or more variants above, then Show Comparison.</div>
              ) : (
                <div className="flex justify-center gap-3">
                  {comparePanes.map((pane) => (
                    <div key={pane.key} className="flex flex-col items-center gap-2">
                      <div className="text-[11px] font-semibold tracking-wide text-text-3">{pane.label}</div>
                      <div className="min-h-[500px] overflow-auto rounded-xl border border-border bg-panel p-4" style={{ width: paneWidth }}>
                        {pane.tree ? (
                          // Read-only: this tree is not the one loaded into
                          // useDesignStore, so pointer-events are disabled
                          // outright rather than risk RenderNode's click/
                          // double-click/resize handlers dispatching edits
                          // against whatever tree IS currently active.
                          <div className="pointer-events-none">
                            <RenderNode node={pane.tree} />
                          </div>
                        ) : (
                          <div className="text-[11.5px] text-text-3">No design tree yet.</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetadataRow({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={hint}>
      <span className="text-text-3">{label}</span>
      <span className="font-mono font-semibold text-text">{value}</span>
    </div>
  )
}

function CompareCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] ${checked ? 'border-accent-2 bg-selected text-accent-2' : 'border-border bg-panel-2 text-text-2'}`}>
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent-2" />
      {label}
    </label>
  )
}

/** Only `placeholder`/`concept` nodes count as "components" for this metric
 * (spec: primitives like stack/text/button don't count) — walks the whole
 * subtree, tallying by `provenance`. */
function countComponentProvenance(node: DesignNode, counts: { existing: number; modified: number; new: number }) {
  if (node.kind === 'placeholder' || node.kind === 'concept') {
    if (node.provenance === 'existing') counts.existing += 1
    else if (node.provenance === 'existing-modified') counts.modified += 1
    else if (node.provenance === 'new') counts.new += 1
  }
  for (const child of node.children) countComponentProvenance(child, counts)
}

/** Honest, explainable "layout changes" heuristic (spec: "do not turn these
 * numbers into arbitrary scores") — walks both trees in parallel by
 * structural position (not by id: an Alternative's tree is a fully
 * independent clone with fresh ids at every node, so ids never line up
 * against the base tree). Counts: a node present on only one side (added/
 * removed at that position), a `kind` mismatch, and for stacks/grids a
 * `direction`/`gap`/`columns` mismatch — then recurses into children. */
function diffLayout(a: DesignNode | null, b: DesignNode | null): number {
  if (!a && !b) return 0
  if (!a || !b) return 1
  let changes = 0
  if (a.kind !== b.kind) changes += 1
  if (a.kind === 'stack' && b.kind === 'stack') {
    if (a.direction !== b.direction) changes += 1
    if (a.gap !== b.gap) changes += 1
  }
  if (a.kind === 'grid' && b.kind === 'grid') {
    if (a.columns !== b.columns) changes += 1
  }
  const maxLen = Math.max(a.children.length, b.children.length)
  for (let i = 0; i < maxLen; i++) {
    changes += diffLayout(a.children[i] ?? null, b.children[i] ?? null)
  }
  return changes
}
