import { useEffect, useMemo, useState } from 'react'
import { Layers, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import type { Feature, FeatureStatus } from '@shared/types/model/featureModel'
import { useProjectStore } from '../../../state/projectStore'
import { useFeatureStore } from '../../../state/featureStore'
import { useUiStore } from '../../../state/uiStore'
import { formatRelativeTime } from '../../../lib/formatRelativeTime'

const STATUS_ORDER: FeatureStatus[] = ['concept', 'designing', 'review', 'approved', 'ready-for-development', 'implemented', 'verified']

const STATUS_LABEL: Record<FeatureStatus, string> = {
  concept: 'Concept',
  designing: 'Designing',
  review: 'Review',
  approved: 'Approved',
  'ready-for-development': 'Ready for dev',
  implemented: 'Implemented',
  verified: 'Verified',
}

// Muted, distinct per status — same `bg-*/15 text-*-300` convention already
// used for the blue "active" highlight elsewhere in the workspace.
const STATUS_STYLE: Record<FeatureStatus, string> = {
  concept: 'bg-white/[0.06] text-text-3',
  designing: 'bg-blue-500/15 text-blue-300',
  review: 'bg-amber-400/15 text-amber-300',
  approved: 'bg-violet-500/15 text-violet-300',
  'ready-for-development': 'bg-cyan-500/15 text-cyan-300',
  implemented: 'bg-emerald-500/15 text-emerald-300',
  verified: 'bg-green-500/15 text-green-300',
}

function pageCount(feature: Feature): number {
  return feature.pageIds.length + feature.referenceOnlyPageIds.length
}

// formatRelativeTime's copy ("Opened…") is written for the recent-projects
// list; re-label rather than re-derive for a Feature's updatedAt.
function relativeUpdated(iso: string): string {
  return formatRelativeTime(iso).replace(/^Opened /, 'Updated ')
}

function openFeature(feature: Feature) {
  useUiStore.getState().setActiveFeatureId(feature.id)
  useUiStore.getState().setView('feature-workspace')
}

export function FeaturesSection() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const features = useFeatureStore((s) => s.features)
  const loading = useFeatureStore((s) => s.loading)
  const loadFeatures = useFeatureStore((s) => s.loadFeatures)
  const createFeature = useFeatureStore((s) => s.createFeature)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (activeProject) void loadFeatures(activeProject.id)
  }, [activeProject, loadFeatures])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return features
    return features.filter((feature) => [feature.name, feature.description, STATUS_LABEL[feature.status]].some((value) => value.toLowerCase().includes(normalized)))
  }, [features, query])

  const recent = useMemo(() => [...features].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 4), [features])

  async function handleCreate() {
    if (!activeProject || !newName.trim() || submitting) return
    setSubmitting(true)
    try {
      await createFeature(activeProject.id, newName.trim(), newDescription.trim() || undefined)
      setNewName('')
      setNewDescription('')
      setCreating(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (!activeProject) return null

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-bg px-8 py-7">
      <div className="mx-auto max-w-[980px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-[18px] font-semibold text-text"><Sparkles size={16} className="text-accent-2" />Features</h1>
            <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-text-3">Scoped design work — pull in existing pages, sketch new ones, and track a feature from concept through to verified in production.</p>
          </div>
          <div className="relative shrink-0">
            <button type="button" onClick={() => setCreating((v) => !v)} className="flex h-8 items-center gap-1.5 rounded-md border border-accent bg-accent px-3 text-[12px] font-semibold text-white hover:bg-accent-2">
              <Plus size={14} />New Feature
            </button>
            {creating && (
              <div className="absolute right-0 top-10 z-20 w-80 rounded-md border border-border-strong bg-panel p-3 shadow-2xl">
                <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">New feature</div>
                <input
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Feature name"
                  className="mb-2 h-8 w-full rounded border border-border bg-bg px-2.5 text-[12px] text-text outline-none placeholder:text-text-3 focus:border-accent/60"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleCreate()
                    if (event.key === 'Escape') setCreating(false)
                  }}
                />
                <textarea
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  placeholder="Description (optional)"
                  rows={3}
                  className="mb-3 w-full resize-none rounded border border-border bg-bg px-2.5 py-2 text-[11.5px] text-text outline-none placeholder:text-text-3 focus:border-accent/60"
                />
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setCreating(false)} className="rounded px-2.5 py-1.5 text-[11.5px] text-text-3 hover:text-text-2">Cancel</button>
                  <button type="button" disabled={!newName.trim() || submitting} onClick={() => void handleCreate()} className="rounded bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-accent-2 disabled:opacity-40">{submitting ? 'Creating…' : 'Create'}</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {loading && features.length === 0 ? (
          <div className="mt-10 text-[12px] text-text-3">Loading features…</div>
        ) : features.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : (
          <>
            {recent.length > 0 && (
              <section className="mt-7">
                <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Recent Features</div>
                <div className="grid grid-cols-4 gap-3">
                  {recent.map((feature) => <RecentFeatureCard key={feature.id} feature={feature} />)}
                </div>
              </section>
            )}

            <section className="mt-8">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">All Features</div>
                <div className="flex h-7 w-60 items-center gap-2 rounded-[5px] border border-border bg-panel px-2">
                  <Search size={12} className="text-text-3" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search features…" className="min-w-0 flex-1 bg-transparent text-[11px] text-text outline-none placeholder:text-text-3" />
                </div>
              </div>
              <div className="border-t border-border">
                {filtered.length === 0 ? (
                  <div className="py-6 text-center text-[11.5px] text-text-3">No features match “{query}”.</div>
                ) : (
                  filtered.map((feature) => <FeatureRow key={feature.id} feature={feature} />)
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function RecentFeatureCard({ feature }: { feature: Feature }) {
  const count = pageCount(feature)
  return (
    <button type="button" onClick={() => openFeature(feature)} className="flex flex-col items-start rounded-md border border-border bg-panel p-3 text-left hover:border-border-strong hover:bg-white/[0.03]">
      <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${STATUS_STYLE[feature.status]}`}>{STATUS_LABEL[feature.status]}</span>
      <span className="mt-2 line-clamp-1 w-full text-[12.5px] font-semibold text-text">{feature.name}</span>
      <span className="mt-1 line-clamp-2 w-full text-[10.5px] leading-relaxed text-text-3">{feature.description || 'No description yet.'}</span>
      <span className="mt-2.5 flex items-center gap-1.5 text-[9.5px] text-text-3">
        <Layers size={10} />{count} page{count === 1 ? '' : 's'}<span>·</span>{relativeUpdated(feature.updatedAt)}
      </span>
    </button>
  )
}

function FeatureRow({ feature }: { feature: Feature }) {
  const saveFeature = useFeatureStore((s) => s.saveFeature)
  const setStatus = useFeatureStore((s) => s.setStatus)
  const deleteFeature = useFeatureStore((s) => s.deleteFeature)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(feature.name)
  const [draftDescription, setDraftDescription] = useState(feature.description)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const count = pageCount(feature)

  function startEditing() {
    setDraftName(feature.name)
    setDraftDescription(feature.description)
    setEditing(true)
  }

  async function commitEdit() {
    if (!draftName.trim()) return
    setSaving(true)
    try {
      await saveFeature({ ...feature, name: draftName.trim(), description: draftDescription.trim() })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteFeature(feature.projectId, feature.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitEdit()
                if (event.key === 'Escape') setEditing(false)
              }}
              className="h-7 w-full max-w-sm rounded border border-border bg-bg px-2 text-[12.5px] font-semibold text-text outline-none focus:border-accent/60"
            />
          ) : (
            <button type="button" onClick={() => openFeature(feature)} className="truncate text-left text-[12.5px] font-semibold text-text hover:text-accent-2">{feature.name}</button>
          )}
          {editing ? (
            <textarea
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              rows={2}
              placeholder="Description"
              className="mt-1.5 w-full max-w-xl resize-none rounded border border-border bg-bg px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent/60"
            />
          ) : (
            <p className="mt-1 line-clamp-1 max-w-xl text-[11px] text-text-3">{feature.description || 'No description yet.'}</p>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-text-3">
            <span>{count} page{count === 1 ? '' : 's'}</span>
            <span>{relativeUpdated(feature.updatedAt)}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={feature.status}
            onChange={(event) => void setStatus(feature, event.target.value as FeatureStatus)}
            className={`h-6 rounded border-0 px-1.5 text-[10px] font-semibold outline-none ${STATUS_STYLE[feature.status]}`}
          >
            {STATUS_ORDER.map((status) => <option key={status} value={status} className="bg-panel text-text">{STATUS_LABEL[status]}</option>)}
          </select>
          {editing ? (
            <>
              <button type="button" onClick={() => setEditing(false)} className="text-[10.5px] text-text-3 hover:text-text-2">Cancel</button>
              <button type="button" disabled={!draftName.trim() || saving} onClick={() => void commitEdit()} className="rounded bg-accent px-2 py-1 text-[10.5px] font-semibold text-white hover:bg-accent-2 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
            </>
          ) : (
            <button type="button" onClick={startEditing} className="text-[10.5px] text-text-3 hover:text-text-2">Edit</button>
          )}
          <button type="button" onClick={() => openFeature(feature)} className="rounded border border-border px-2 py-1 text-[10.5px] text-text-2 hover:border-border-strong hover:text-text">Open</button>
          {confirmingDelete ? (
            <span className="flex items-center gap-1.5 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] text-danger">
              Delete + Journeys + Concept Components?
              <button type="button" disabled={deleting} onClick={() => void handleDelete()} className="font-semibold underline">{deleting ? '…' : 'Confirm'}</button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="text-text-3">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} title="Delete feature" className="flex h-6 w-6 items-center justify-center rounded text-text-3 hover:bg-danger/10 hover:text-danger"><Trash2 size={12} /></button>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-16 flex flex-col items-center justify-center text-center">
      <Sparkles size={22} className="mb-3 text-text-3" />
      <div className="text-[13px] font-semibold text-text">No features yet</div>
      <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-text-3">Features are scoped design work — group existing pages, sketch new screens, and move the work from concept through to verified. Create your first one to get started.</p>
      <button type="button" onClick={onCreate} className="mt-4 flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-2 text-[12px] font-semibold text-white hover:bg-accent-2"><Plus size={14} />New Feature</button>
    </div>
  )
}
