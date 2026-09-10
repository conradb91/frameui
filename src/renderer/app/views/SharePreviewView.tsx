import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Info, ListTree, Loader2, Monitor, Smartphone, Tablet } from 'lucide-react'
import type { SharePackageBundle, SharePackageStep } from '@shared/types/sharePackage'
import type { SharePreview } from '@shared/types/model/featureModel'
import type { DesignNode, Breakpoint, Provenance } from '@shared/types/designNode'
import { PreviewRenderNode } from '../../components/designer/PreviewRenderNode'
import { StructurePreview } from '../../components/project/StructurePreview'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'

/**
 * The recipient-facing, read-only Share Preview experience (spec Phase 25) —
 * distinct from the FrameUI editor (no toolbar/activity-rail/inspector
 * chrome) and distinct from Phase 24's in-editor interactive Preview mode.
 * Reads a packaged `SharePackageBundle` back via `readSharePackage` and
 * renders it for review only: nothing here ever dispatches a design-tree
 * mutation, so `PreviewRenderNode` (already the app's non-interactive,
 * store-decoupled renderer built for exactly this class of read-only
 * rendering — see its own header comment) is used here instead of the
 * editable `RenderNode`, which is wired to the live design store and reacts
 * to clicks/drags with real edit dispatches.
 *
 * Extension point for a later phase: comments infrastructure does not exist
 * yet anywhere in this codebase (`Annotation` in featureModel.ts is a
 * type-only shape with no store/IPC/UI). Per spec Phase 25 ("do not create
 * placeholder comment controls"), no comment UI is rendered here. Once a
 * real comments system exists, it would mount here as roughly:
 *   <CommentsPanel featureId={bundle.featureId} sharePreviewId={bundle.sharePreviewId} />
 */

type Tab = 'overview' | 'prototype' | 'changes'

const VIEWPORT_ICON: Record<Breakpoint, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone }
const VIEWPORT_WIDTH: Record<Breakpoint, number> = { desktop: 960, tablet: 720, mobile: 375 }

export function SharePreviewView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const sharePreviewId = useUiStore((s) => s.activeSharePreviewId)
  const setView = useUiStore((s) => s.setView)

  const [bundle, setBundle] = useState<SharePackageBundle | null | undefined>(undefined) // undefined = loading
  const [previewMeta, setPreviewMeta] = useState<SharePreview | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [viewport, setViewport] = useState<Breakpoint>('desktop')
  const [currentStepId, setCurrentStepId] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const [repackaging, setRepackaging] = useState(false)

  const projectId = activeProject?.id ?? null

  async function load() {
    if (!projectId || !sharePreviewId) return
    setBundle(undefined)
    const [b, meta] = await Promise.all([
      window.frameui.workspace.readSharePackage(projectId, sharePreviewId),
      window.frameui.workspace.getSharePreview(projectId, sharePreviewId),
    ])
    setBundle(b)
    setPreviewMeta(meta)
    setViewport((b?.viewports[0] as Breakpoint) ?? 'desktop')
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sharePreviewId])

  const entryStepId = useMemo(() => findEntryStepId(bundle), [bundle])

  useEffect(() => {
    if (bundle && entryStepId) {
      setCurrentStepId(entryStepId)
      setHistory([])
    }
  }, [bundle, entryStepId])

  function handleExit() {
    useUiStore.getState().setActiveSharePreviewId(null)
    setView('workspace')
  }

  async function handlePackageNow() {
    if (!projectId || !sharePreviewId) return
    setRepackaging(true)
    try {
      await window.frameui.workspace.packageSharePreview(projectId, sharePreviewId)
      await load()
    } finally {
      setRepackaging(false)
    }
  }

  const currentStep = bundle?.steps.find((s) => s.stepId === currentStepId) ?? null
  const outgoingConnections = useMemo(
    () => (bundle?.journey && currentStepId ? bundle.journey.connections.filter((c) => c.fromStepId === currentStepId) : []),
    [bundle, currentStepId],
  )
  const sequentialIndex = bundle && !bundle.journey && currentStepId ? bundle.steps.findIndex((s) => s.stepId === currentStepId) : -1

  function goToStep(stepId: string) {
    if (!currentStepId) return
    setHistory((h) => [...h, currentStepId])
    setCurrentStepId(stepId)
  }

  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h
      const next = [...h]
      const last = next.pop()!
      setCurrentStepId(last)
      return next
    })
  }

  function goSequential(delta: 1 | -1) {
    if (!bundle || sequentialIndex === -1) return
    const nextIndex = sequentialIndex + delta
    const nextStep = bundle.steps[nextIndex]
    if (nextStep) goToStep(nextStep.stepId)
  }

  const currentPage = useMemo(() => {
    if (!currentStep || currentStep.pageRefKind !== 'existing' || !activeIndex) return null
    return activeIndex.projectModel.pages.find((p) => p.id === currentStep.pageId) ?? null
  }, [currentStep, activeIndex])

  if (!activeProject || !sharePreviewId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-panel text-text-3">
        <div className="text-[12px]">No share preview selected.</div>
      </div>
    )
  }

  if (bundle === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-panel text-text-3">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }

  if (bundle === null) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-panel px-4 text-center">
        <div className="text-[13px] font-semibold text-text">{previewMeta?.name ?? 'Share Preview'} — Not yet packaged</div>
        <div className="max-w-[420px] text-[12px] leading-relaxed text-text-3">
          This Share Preview hasn't been packaged yet, so there's nothing to review. Package it to write a
          review-safe snapshot to disk.
        </div>
        {previewMeta && (
          <button
            type="button"
            disabled={repackaging}
            onClick={() => void handlePackageNow()}
            className="flex items-center gap-1.5 rounded-md bg-accent   px-4 py-2 text-[12.5px] font-semibold text-on-accent disabled:opacity-50"
          >
            {repackaging && <Loader2 size={13} className="animate-spin" />}
            Package Now
          </button>
        )}
        <button type="button" onClick={handleExit} className="text-[12px] font-semibold text-text-3 hover:text-text-2">
          ← Back
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-panel text-text">
      {/* Header — deliberately different chrome from the FrameUI editor
          (spec: "clean review-oriented experience, not the FrameUI editor"). */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-accent-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />
            Interactive Prototype
          </div>
          <div className="truncate text-[13px] font-semibold text-text">{bundle.journey?.name ?? bundle.name}</div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-panel p-0.5">
            {bundle.viewports.map((vp) => {
              const Icon = VIEWPORT_ICON[vp as Breakpoint]
              return (
                <button
                  key={vp}
                  type="button"
                  onClick={() => setViewport(vp as Breakpoint)}
                  title={vp}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold capitalize ${
                    viewport === vp ? 'bg-selected text-accent-2' : 'text-text-2'
                  }`}
                >
                  <Icon size={12} /> {vp}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-1 rounded-full border border-border bg-panel p-0.5">
            {(['overview', 'prototype', 'changes'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize ${tab === t ? 'bg-hover text-text' : 'text-text-2'}`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab !== 'prototype' && (
            <button
              type="button"
              onClick={() => setTab('prototype')}
              className="rounded-md bg-accent   px-4 py-2 text-[12px] font-semibold text-on-accent"
            >
              Start Prototype →
            </button>
          )}

          <button type="button" onClick={handleExit} className="text-[12px] font-semibold text-text-3 hover:text-text-2">
            Close
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && <OverviewTab bundle={bundle} />}
        {tab === 'changes' && <ChangesTab bundle={bundle} />}
        {tab === 'prototype' &&
          (bundle.steps.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-text-3">
              This package has no steps to walk through — nothing was resolved into it yet.
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
              <div className={`flex gap-3 ${showCompare && currentPage ? '' : 'justify-center'}`}>
                <div className="flex flex-col items-center gap-2">
                  {showCompare && currentPage && <div className="text-[12px] font-semibold tracking-wide text-text-3">Proposed</div>}
                  <div
                    className="max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-panel p-4 shadow-sm transition-[width] duration-200"
                    style={{ width: VIEWPORT_WIDTH[viewport] }}
                  >
                    <StepContent step={currentStep} breakpoint={viewport} />
                  </div>
                </div>
                {showCompare && currentPage && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-[12px] font-semibold tracking-wide text-text-3">Current</div>
                    <div className="h-[60vh] w-[280px] overflow-hidden rounded-xl border border-border shadow-sm">
                      <StructurePreview structure={currentPage.structure} />
                    </div>
                  </div>
                )}
              </div>

              {bundle.includeCurrentComparison && currentPage && (
                <button type="button" onClick={() => setShowCompare((v) => !v)} className="text-[12px] font-semibold text-accent-2">
                  {showCompare ? 'Hide' : 'Show'} comparison against Current
                </button>
              )}

              {/* Floating navigation */}
              <div className="flex items-center gap-3 rounded-md border border-border bg-panel py-2 pl-2 pr-3">
                <button
                  type="button"
                  disabled={history.length === 0}
                  onClick={goBack}
                  className="flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold text-text-2 disabled:opacity-30"
                >
                  <ArrowLeft size={13} /> Back
                </button>

                {bundle.journey ? (
                  outgoingConnections.length === 0 ? (
                    <span className="px-3 py-1.5 text-[12px] text-text-3">End of prototype</span>
                  ) : (
                    outgoingConnections.map((conn) => (
                      <button
                        key={conn.id}
                        type="button"
                        onClick={() => goToStep(conn.toStepId)}
                        className="whitespace-nowrap rounded-md bg-accent   px-3.5 py-1.5 text-[12px] font-semibold text-on-accent"
                      >
                        {conn.label || conn.elementLabel || 'Continue'} <ArrowRight size={11} className="ml-1 inline" />
                      </button>
                    ))
                  )
                ) : (
                  <button
                    type="button"
                    disabled={sequentialIndex === -1 || sequentialIndex >= bundle.steps.length - 1}
                    onClick={() => goSequential(1)}
                    className="flex items-center gap-1 rounded-md bg-accent   px-3.5 py-1.5 text-[12px] font-semibold text-on-accent disabled:opacity-30"
                  >
                    Next <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}

function StepContent({ step, breakpoint }: { step: SharePackageStep | null; breakpoint: Breakpoint }) {
  if (!step) return <div className="text-center text-[12px] text-text-3">Step not found.</div>
  if (step.tree) return <PreviewRenderNode node={step.tree} breakpoint={breakpoint} />

  const reason = step.referenceOnly
    ? 'This is a reference-only page — included in the Journey for context, but never becomes editable design work.'
    : step.designState?.origin === 'captured'
      ? "This step's content was captured from the running application and was excluded because \"Include captured runtime states\" was left off when this preview was created."
      : 'This step has no design content to show.'

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-4 text-center">
      <Info size={16} className="text-text-3" />
      <div className="max-w-[280px] px-4 text-[12px] leading-relaxed text-text-3">
        <span className="font-semibold text-text-2">Content not included in this share package.</span>
        <br />
        {reason}
      </div>
    </div>
  )
}

function OverviewTab({ bundle }: { bundle: SharePackageBundle }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Name', value: bundle.name },
    { label: 'Scope', value: bundle.scope },
    { label: 'Viewports', value: bundle.viewports.join(', ') },
    { label: 'Steps', value: String(bundle.steps.length) },
    { label: 'Generated', value: new Date(bundle.generatedAt).toLocaleString() },
  ]
  if (bundle.journey) rows.splice(1, 0, { label: 'Journey', value: bundle.journey.name })

  return (
    <div className="mx-auto max-w-[520px] p-4">
      <div className="mb-4 text-[13px] font-semibold text-text">Overview</div>
      {bundle.journey?.description && <div className="mb-5 text-[12.5px] leading-relaxed text-text-2">{bundle.journey.description}</div>}
      <div className="overflow-hidden rounded-lg border border-border">
        {rows.map((row, i) => (
          <div key={row.label} className={`flex items-center justify-between px-4 py-2.5 text-[12px] ${i % 2 === 0 ? 'bg-panel' : ''}`}>
            <span className="text-text-3">{row.label}</span>
            <span className="font-medium capitalize text-text">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChangesTab({ bundle }: { bundle: SharePackageBundle }) {
  const counts = useMemo(() => {
    const totals: Record<Provenance, number> = { existing: 0, 'existing-modified': 0, new: 0, 'reference-only': 0 }
    for (const step of bundle.steps) {
      if (step.tree) countProvenance(step.tree, totals)
      else if (step.referenceOnly) totals['reference-only'] += 1
    }
    return totals
  }, [bundle])

  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-text-3">
        No design content was included in this package to summarize changes from.
      </div>
    )
  }

  const rows: { key: Provenance; label: string; color: string }[] = [
    { key: 'new', label: 'New', color: 'text-success' },
    { key: 'existing-modified', label: 'Modified from existing', color: 'text-warning' },
    { key: 'existing', label: 'Unchanged from existing', color: 'text-text-2' },
    { key: 'reference-only', label: 'Reference only', color: 'text-text-3' },
  ]

  return (
    <div className="mx-auto max-w-[480px] p-4">
      <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-text">
        <ListTree size={14} /> Changes
      </div>
      <div className="mb-4 text-[12px] text-text-3">Element-level provenance across every step included in this package.</div>
      <div className="flex flex-col gap-2">
        {rows.map(
          (row) =>
            counts[row.key] > 0 && (
              <div key={row.key} className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2">
                <span className={`text-[12px] font-medium ${row.color}`}>{row.label}</span>
                <span className="text-[12px] font-mono text-text">{counts[row.key]}</span>
              </div>
            ),
        )}
      </div>
    </div>
  )
}

function countProvenance(node: DesignNode, totals: Record<Provenance, number>) {
  const p = node.provenance ?? 'existing'
  totals[p] += 1
  for (const child of node.children) countProvenance(child, totals)
}

/** Journey's entry step — the one no connection points at, matching the
 * same convention Phase 24's in-editor Preview uses. Falls back to the
 * first step when every step has an incoming connection (a cycle, or a
 * single-node journey) or when there's no Journey at all (sequential,
 * scope !== 'journey'). */
function findEntryStepId(bundle: SharePackageBundle | null | undefined): string | null {
  if (!bundle || bundle.steps.length === 0) return null
  if (!bundle.journey) return bundle.steps[0].stepId
  const targeted = new Set(bundle.journey.connections.map((c) => c.toStepId))
  const entry = bundle.steps.find((s) => !targeted.has(s.stepId))
  return (entry ?? bundle.steps[0]).stepId
}
