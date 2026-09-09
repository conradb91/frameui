import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { SharePreview, SharePreviewScope, Journey, Feature, FeaturePage, PageRef } from '@shared/types/model/featureModel'
import type { Viewport } from '@shared/types/model/projectModel'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'

const VIEWPORTS: Viewport[] = ['desktop', 'tablet', 'mobile']
const SCOPE_LABEL: Record<SharePreviewScope, string> = { feature: 'Whole Feature', journey: 'Journey', page: 'Single Page' }

/**
 * Share Preview creation + management UI (spec Phase 25), opened from the
 * Feature Workspace toolbar's "Share" button. Owns listing/creating/
 * packaging/deleting `SharePreview`s for one Feature — the actual recipient
 * viewing experience lives in `SharePreviewView` (a separate top-level
 * view with no editor chrome), reached via "Open" below.
 */
export function SharePreviewPanel({ projectId, featureId, onClose }: { projectId: string; featureId: string; onClose: () => void }) {
  const [previews, setPreviews] = useState<SharePreview[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [packagingId, setPackagingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const list = await window.frameui.workspace.listSharePreviews(projectId, featureId)
      setPreviews(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, featureId])

  async function handleRepackage(id: string) {
    setPackagingId(id)
    try {
      const updated = await window.frameui.workspace.packageSharePreview(projectId, id)
      setPreviews((list) => list.map((p) => (p.id === updated.id ? updated : p)))
    } finally {
      setPackagingId(null)
    }
  }

  async function handleDelete(id: string) {
    await window.frameui.workspace.deleteSharePreview(projectId, id)
    setPreviews((list) => list.filter((p) => p.id !== id))
    setPendingDeleteId(null)
  }

  function openViewer(id: string) {
    useUiStore.getState().setActiveSharePreviewId(id)
    useUiStore.getState().setView('share-preview')
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-text">Share Previews</div>
            <div className="mt-0.5 text-[10.5px] text-text-3">Package a read-only, reviewable prototype to hand off outside FrameUI.</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-text-2 hover:text-text">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {creating ? (
            <CreateSharePreviewForm
              projectId={projectId}
              featureId={featureId}
              onCancel={() => setCreating(false)}
              onCreated={(preview) => {
                setCreating(false)
                setPreviews((list) => [preview, ...list])
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2.5 text-[11.5px] font-semibold text-text-2 hover:border-accent-2/40 hover:text-accent-2"
            >
              <Plus size={13} /> New Share Preview
            </button>
          )}

          {loading && previews.length === 0 ? (
            <div className="p-4 text-center text-[11.5px] text-text-3">Loading…</div>
          ) : previews.length === 0 ? (
            !creating && <div className="rounded-md border border-dashed border-border p-4 text-center text-[11px] leading-relaxed text-text-3">No share previews yet for this Feature.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {previews.map((preview) => (
                <div key={preview.id} className="rounded-md border border-border bg-panel-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold text-text">{preview.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-3">
                        <span>{SCOPE_LABEL[preview.scope]}</span>
                        <span>·</span>
                        <span>{preview.viewports.join(', ')}</span>
                        {preview.includeCapturedStates && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-0.5 font-semibold text-warning">
                              <AlertTriangle size={10} /> Captured states included
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${
                        preview.packagePath ? 'bg-success/15 text-success' : 'bg-text-3/15 text-text-3'
                      }`}
                    >
                      {preview.packagePath ? 'Packaged' : 'Not packaged'}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!preview.packagePath}
                      onClick={() => openViewer(preview.id)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-accent-2/30 bg-accent-2/[0.08] px-2 py-1.5 text-[10.5px] font-semibold text-accent-2 disabled:opacity-40"
                    >
                      <ExternalLink size={11} /> Open
                    </button>
                    <button
                      type="button"
                      disabled={packagingId === preview.id}
                      onClick={() => void handleRepackage(preview.id)}
                      title={preview.packagePath ? 'Re-package (e.g. after design changes)' : 'Package now'}
                      className="flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-[10.5px] font-semibold text-text-2 hover:text-text disabled:opacity-50"
                    >
                      {packagingId === preview.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                      {preview.packagePath ? 'Re-package' : 'Package Now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(preview.id)}
                      title="Delete"
                      className="flex items-center justify-center rounded-md border border-border px-2 py-1.5 text-text-2 hover:text-danger"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {pendingDeleteId === preview.id && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger/[0.06] px-2 py-1.5">
                      <span className="text-[10.5px] font-medium text-danger">Delete this share preview?</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => void handleDelete(preview.id)} className="rounded bg-danger/15 px-2 py-0.5 text-[10px] font-semibold text-danger">
                          Delete
                        </button>
                        <button type="button" onClick={() => setPendingDeleteId(null)} className="rounded px-2 py-0.5 text-[10px] font-semibold text-text-2">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateSharePreviewForm({
  projectId,
  featureId,
  onCreated,
  onCancel,
}: {
  projectId: string
  featureId: string
  onCreated: (preview: SharePreview) => void
  onCancel: () => void
}) {
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const [feature, setFeature] = useState<Feature | null>(null)
  const [journeys, setJourneys] = useState<Journey[]>([])
  const [featurePages, setFeaturePages] = useState<FeaturePage[]>([])

  const [name, setName] = useState('')
  const [scope, setScope] = useState<SharePreviewScope>('journey')
  const [journeyId, setJourneyId] = useState<string>('')
  const [pageRefKey, setPageRefKey] = useState<string>('') // "existing:<id>" | "new:<id>"
  const [viewports, setViewports] = useState<Viewport[]>(['desktop'])
  const [includeCurrentComparison, setIncludeCurrentComparison] = useState(false)
  const [includeCapturedStates, setIncludeCapturedStates] = useState(false)
  const [submitting, setSubmitting] = useState<'idle' | 'creating' | 'packaging' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [f, j, pages] = await Promise.all([
        window.frameui.workspace.getFeature(projectId, featureId),
        window.frameui.workspace.listJourneys(projectId, featureId),
        window.frameui.workspace.listFeaturePages(projectId, featureId),
      ])
      setFeature(f)
      setJourneys(j)
      setFeaturePages(pages)
      if (j.length > 0) setJourneyId(j[0].id)
    })()
  }, [projectId, featureId])

  const existingPages = useMemo(
    () => (feature ? feature.pageIds.map((id) => activeIndex?.projectModel.pages.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p) : []),
    [feature, activeIndex],
  )

  function toggleViewport(vp: Viewport) {
    setViewports((current) => (current.includes(vp) ? current.filter((v) => v !== vp) : [...current, vp]))
  }

  function resolvePageRef(): PageRef | null {
    if (!pageRefKey) return null
    const [kind, id] = pageRefKey.split(':')
    if (kind !== 'existing' && kind !== 'new') return null
    return { kind, pageId: id }
  }

  const canSubmit =
    name.trim().length > 0 &&
    viewports.length > 0 &&
    (scope !== 'journey' || journeyId) &&
    (scope !== 'page' || pageRefKey) &&
    submitting === 'idle'

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting('creating')
    setError(null)
    try {
      const preview = await window.frameui.workspace.createSharePreview(projectId, {
        featureId,
        name: name.trim(),
        scope,
        journeyId: scope === 'journey' ? journeyId : null,
        pageRef: scope === 'page' ? resolvePageRef() : null,
        viewports,
        includeCurrentComparison,
        includeCapturedStates,
      })
      // Don't leave a newly-created preview sitting unpackaged with no clear
      // next step — package it immediately. Packaging can always be re-run
      // later from the list ("Re-package").
      setSubmitting('packaging')
      const packaged = await window.frameui.workspace.packageSharePreview(projectId, preview.id)
      setSubmitting('done')
      onCreated(packaged)
    } catch (err) {
      setSubmitting('error')
      setError(err instanceof Error ? err.message : 'Failed to create share preview.')
    }
  }

  return (
    <div className="mb-3 rounded-md border border-border bg-panel-2 p-3">
      <label className="mb-2.5 block">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-3">Name</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Checkout Redesign — Review"
          className="w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2"
        />
      </label>

      <div className="mb-2.5">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-3">Scope</div>
        <div className="flex gap-1.5">
          {(['journey', 'page', 'feature'] as SharePreviewScope[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold ${
                scope === s ? 'border-accent-2/40 bg-accent-2/[0.1] text-accent-2' : 'border-border text-text-2'
              }`}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {scope === 'journey' && (
        <label className="mb-2.5 block">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-3">Journey</div>
          {journeys.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-2 py-2 text-[10.5px] text-text-3">No Journeys yet in this Feature.</div>
          ) : (
            <select
              value={journeyId}
              onChange={(e) => setJourneyId(e.target.value)}
              className="w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2"
            >
              {journeys.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      {scope === 'page' && (
        <label className="mb-2.5 block">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-3">Page</div>
          {existingPages.length === 0 && featurePages.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-2 py-2 text-[10.5px] text-text-3">No pages in this Feature yet.</div>
          ) : (
            <select
              value={pageRefKey}
              onChange={(e) => setPageRefKey(e.target.value)}
              className="w-full rounded-md border border-border bg-panel px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2"
            >
              <option value="">Select a page…</option>
              {existingPages.length > 0 && (
                <optgroup label="Existing pages">
                  {existingPages.map((p) => (
                    <option key={p.id} value={`existing:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {featurePages.length > 0 && (
                <optgroup label="New pages">
                  {featurePages.map((p) => (
                    <option key={p.id} value={`new:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </label>
      )}

      <div className="mb-2.5">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-3">Viewports</div>
        <div className="flex gap-1.5">
          {VIEWPORTS.map((vp) => (
            <button
              key={vp}
              type="button"
              onClick={() => toggleViewport(vp)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold capitalize ${
                viewports.includes(vp) ? 'border-accent-2/40 bg-accent-2/[0.1] text-accent-2' : 'border-border text-text-2'
              }`}
            >
              {vp}
            </button>
          ))}
        </div>
      </div>

      <label className="mb-2.5 flex items-center justify-between gap-2 rounded-md border border-border bg-panel px-2.5 py-2">
        <div>
          <div className="text-[11px] font-semibold text-text">Compare against Current</div>
          <div className="text-[10px] text-text-3">Show the real, currently-shipped page alongside each step.</div>
        </div>
        <input
          type="checkbox"
          checked={includeCurrentComparison}
          onChange={(e) => setIncludeCurrentComparison(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-accent-2"
        />
      </label>

      {/* Security-critical control (spec Phase 25): the one thing standing
          between a share package and accidentally leaking real captured app
          data. Default OFF, deliberately made prominent rather than a plain
          checkbox in a settings list. */}
      <div className={`mb-3 rounded-md border-2 p-2.5 ${includeCapturedStates ? 'border-warning/50 bg-warning/[0.08]' : 'border-border bg-panel'}`}>
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={includeCapturedStates}
            onChange={(e) => setIncludeCapturedStates(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-warning"
          />
          <div>
            <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-warning">
              <AlertTriangle size={13} />
              Include captured runtime states
            </div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-text-2">
              Off by default. Leave this OFF unless you're certain: any Design State captured from the real running
              application — which may contain real production or personal data — will be <strong>excluded</strong> from
              the package while this stays unchecked. Design fixture content is always safer to share than a live
              capture. Only turn this on for states you've verified contain no sensitive data.
            </div>
          </div>
        </label>
      </div>

      {error && <div className="mb-2 rounded-md border border-danger/30 bg-danger/[0.06] px-2 py-1.5 text-[10.5px] text-danger">{error}</div>}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-accent-2/30 bg-accent-2/[0.08] px-2 py-1.5 text-[11px] font-semibold text-accent-2 disabled:opacity-40"
        >
          {submitting === 'creating' && (
            <>
              <Loader2 size={12} className="animate-spin" /> Creating…
            </>
          )}
          {submitting === 'packaging' && (
            <>
              <Loader2 size={12} className="animate-spin" /> Packaging…
            </>
          )}
          {submitting === 'idle' && (
            <>
              <Check size={12} /> Create &amp; Package
            </>
          )}
          {(submitting === 'done' || submitting === 'error') && 'Create & Package'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-2 hover:text-text">
          Cancel
        </button>
      </div>
    </div>
  )
}
