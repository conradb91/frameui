import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext } from '@dnd-kit/core'
import { ArrowLeft, RotateCcw, Eye, EyeOff, X, Monitor, Tablet, Smartphone } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { useFeatureStore } from '../../state/featureStore'
import { useDesignStore } from '../../state/designStore'
import { useConceptComponentStore } from '../../state/conceptComponentStore'
import { RenderNode } from '../../components/designer/RenderNode'
import { StructurePreview } from '../../components/project/StructurePreview'
import { FrameMark, ChevronRightIcon } from '../../components/icons/icons'
import { resolveLayout, type ResolvedBox } from '@core/design-model/layout'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import type { FeaturePage, Journey, JourneyStep, JourneyConnection } from '@shared/types/model/featureModel'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { applyDesignOperations } from '@core/design-model/operations'

const BREAKPOINT_WIDTH: Record<Breakpoint, number> = { desktop: 900, tablet: 768, mobile: 375 }
const BREAKPOINT_LABEL: Record<Breakpoint, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' }
const BREAKPOINT_ICON: Record<Breakpoint, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone }

/** Mirrors `findNode`'s recursive search but over `resolveLayout`'s
 * `ResolvedBox` tree (same shape/child order as the `DesignNode` tree it
 * was built from), so a connection's `elementId` can be turned into an
 * approximate on-screen bounding box for a hotspot overlay. */
function findBox(box: ResolvedBox, id: string): ResolvedBox | null {
  if (box.node.id === id) return box
  for (const child of box.children) {
    const found = findBox(child, id)
    if (found) return found
  }
  return null
}

/** Picks the Journey's starting step: the one step nothing points at, or
 * the first step in the array when that's ambiguous (none or several such
 * steps) — spec's documented fallback for "Restart". */
function getEntryStepId(journey: Journey): string | null {
  if (journey.steps.length === 0) return null
  const hasIncoming = new Set(journey.connections.map((c) => c.toStepId))
  const candidates = journey.steps.filter((s) => !hasIncoming.has(s.id))
  return (candidates.length === 1 ? candidates[0] : journey.steps[0]).id
}

interface StepData {
  stepId: string
  pageName: string
  tree: DesignNode | null
  structure: PageStructureItem[]
}

export function FeaturePreviewView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const activeFeatureId = useUiStore((s) => s.activeFeatureId)
  const activeJourneyId = useUiStore((s) => s.activeJourneyId)
  const setActiveJourneyId = useUiStore((s) => s.setActiveJourneyId)
  const setView = useUiStore((s) => s.setView)
  const features = useFeatureStore((s) => s.features)
  const loadFeatures = useFeatureStore((s) => s.loadFeatures)
  const loadConceptComponents = useConceptComponentStore((s) => s.loadForFeature)

  const feature = useMemo(() => features.find((f) => f.id === activeFeatureId) ?? null, [features, activeFeatureId])

  const [journeys, setJourneys] = useState<Journey[]>([])
  const [journeysLoaded, setJourneysLoaded] = useState(false)
  const [journey, setJourney] = useState<Journey | null>(null)
  const [currentStepId, setCurrentStepId] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [viewport, setViewport] = useState<Breakpoint>('desktop')
  const [hotspotsVisible, setHotspotsVisible] = useState(true)
  const [stepData, setStepData] = useState<StepData | null>(null)
  const [stepLoading, setStepLoading] = useState(false)

  // ---- Breakpoint driving decision (see report): RenderNode reads
  // `breakpoint` from the global `useDesignStore`, not a prop — there is no
  // safe way to override it per-instance. We drive the viewport switcher
  // through that same global on mount/change (least-bad option per the
  // brief) but stash whatever the Design editor last had and restore it on
  // exit, so leaving Preview never strands the live editor on a viewport
  // the designer didn't pick.
  const priorBreakpointRef = useRef<Breakpoint | null>(null)
  useEffect(() => {
    priorBreakpointRef.current = useDesignStore.getState().breakpoint
    return () => {
      if (priorBreakpointRef.current) useDesignStore.getState().setBreakpoint(priorBreakpointRef.current)
    }
  }, [])
  useEffect(() => {
    useDesignStore.getState().setBreakpoint(viewport)
  }, [viewport])

  useEffect(() => {
    if (activeProject && features.length === 0) void loadFeatures(activeProject.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id])

  useEffect(() => {
    if (activeProject && feature) void loadConceptComponents(activeProject.id, feature.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, feature?.id])

  // Journey picker: fetch the list whenever nothing is chosen yet, and
  // auto-pick the only candidate.
  useEffect(() => {
    if (!activeProject || !feature) return
    if (activeJourneyId) return
    let cancelled = false
    void window.frameui.workspace.listJourneys(activeProject.id, feature.id).then((list) => {
      if (cancelled) return
      setJourneys(list)
      setJourneysLoaded(true)
      if (list.length === 1) setActiveJourneyId(list[0].id)
    })
    return () => {
      cancelled = true
    }
  }, [activeProject, feature, activeJourneyId, setActiveJourneyId])

  // Load the chosen Journey's steps/connections and seed the walkthrough at
  // its entry step.
  useEffect(() => {
    if (!activeProject || !activeJourneyId) {
      setJourney(null)
      return
    }
    let cancelled = false
    void window.frameui.workspace.getJourney(activeProject.id, activeJourneyId).then((loaded) => {
      if (cancelled) return
      setJourney(loaded)
      const entry = loaded ? getEntryStepId(loaded) : null
      setCurrentStepId(entry)
      setHistory(entry ? [entry] : [])
    })
    return () => {
      cancelled = true
    }
  }, [activeProject, activeJourneyId])

  const currentStep: JourneyStep | null = useMemo(
    () => journey?.steps.find((s) => s.id === currentStepId) ?? null,
    [journey, currentStepId],
  )

  // Resolve the current step's page name/design tree/fallback structure.
  useEffect(() => {
    if (!activeProject || !currentStep) {
      setStepData(null)
      return
    }
    let cancelled = false
    setStepLoading(true)
    async function load() {
      let pageName = 'Untitled page'
      let structure: PageStructureItem[] = []

      if (currentStep!.pageRef.kind === 'existing') {
        const page = activeIndex?.projectModel.pages.find((p) => p.id === currentStep!.pageRef.pageId) ?? null
        pageName = page?.name ?? pageName
        structure = page?.structure ?? []
      } else {
        const featurePage: FeaturePage | null = await window.frameui.workspace.getFeaturePage(
          activeProject!.id,
          currentStep!.pageRef.pageId,
        )
        pageName = featurePage?.name ?? pageName
      }

      let tree: DesignNode | null = null
      const ownerId = currentStep!.alternativeId ?? currentStep!.designStateId
      if (!currentStep!.referenceOnly && ownerId) {
        const record = await window.frameui.workspace.getDesignTree(activeProject!.id, ownerId)
        const operations = await window.frameui.workspace.getDesignOperations(activeProject!.id, feature!.id, ownerId)
        tree = record?.tree ? applyDesignOperations(record.tree, operations) : null
      }

      if (cancelled) return
      setStepData({ stepId: currentStep!.id, pageName, tree, structure })
      setStepLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activeProject, activeIndex, currentStep, feature])

  function goToStep(stepId: string) {
    setHistory((h) => [...h, stepId])
    setCurrentStepId(stepId)
  }

  function goBack() {
    setHistory((h) => {
      if (h.length <= 1) return h
      const next = h.slice(0, -1)
      setCurrentStepId(next[next.length - 1])
      return next
    })
  }

  function restart() {
    if (!journey) return
    const entry = getEntryStepId(journey)
    setCurrentStepId(entry)
    setHistory(entry ? [entry] : [])
  }

  function exitPreview() {
    setView('feature-workspace')
  }

  if (!activeProject || !feature) return null

  const outgoingConnections: JourneyConnection[] = currentStep
    ? journey?.connections.filter((c) => c.fromStepId === currentStep.id) ?? []
    : []

  const resolvedLayout: ResolvedBox | null =
    stepData?.tree && stepData.stepId === currentStep?.id ? resolveLayout(stepData.tree, viewport, BREAKPOINT_WIDTH[viewport]) : null

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Mode bar — unmistakably PREVIEW, never confusable with the DESIGN editor. */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-raised px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <FrameMark className="h-[14px] w-[14px] shrink-0 text-accent-2" />
          <span className="truncate font-mono text-[12px] text-text-3">{feature.name}</span>
          <ChevronRightIcon className="h-3 w-3 shrink-0 text-text-3" />
          <span className="rounded-md bg-selected px-2 py-0.5 text-[12px] font-semibold tracking-wide text-accent-2">Preview</span>
          {journey && <span className="truncate text-[12.5px] font-semibold text-text">{journey.name}</span>}
        </div>

        <div className="flex items-center gap-3">
          {journey && journey.steps.length > 0 && (
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-panel-2 p-0.5">
              {(['desktop', 'tablet', 'mobile'] as const).map((bp) => {
                const Icon = BREAKPOINT_ICON[bp]
                return (
                  <button
                    key={bp}
                    type="button"
                    onClick={() => setViewport(bp)}
                    title={BREAKPOINT_LABEL[bp]}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold ${
                      viewport === bp ? 'bg-selected text-accent-2' : 'text-text-2'
                    }`}
                  >
                    <Icon size={12} />
                    {BREAKPOINT_LABEL[bp]}
                  </button>
                )
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setHotspotsVisible((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${
              hotspotsVisible ? 'border-accent-2/40 bg-selected text-accent-2' : 'border-border bg-panel-2 text-text-2'
            }`}
            title="Toggle hotspot outlines — interactions stay clickable either way"
          >
            {hotspotsVisible ? <Eye size={12} /> : <EyeOff size={12} />}
            Hotspots
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goBack}
            disabled={history.length <= 1}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] font-semibold text-text-2 disabled:opacity-40"
          >
            <ArrowLeft size={12} />
            Back
          </button>
          <button
            type="button"
            onClick={restart}
            disabled={!journey}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] font-semibold text-text-2 disabled:opacity-40"
          >
            <RotateCcw size={12} />
            Restart
          </button>
          <button
            type="button"
            onClick={exitPreview}
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent   px-2.5 py-1.5 text-[12px] font-semibold text-on-accent"
          >
            <X size={12} />
            Exit Preview
          </button>
        </div>
      </div>

      {/* Body */}
      {!activeJourneyId ? (
        <JourneyPicker journeysLoaded={journeysLoaded} journeys={journeys} onPick={setActiveJourneyId} onExit={exitPreview} />
      ) : !journey ? (
        <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-3">Loading journey…</div>
      ) : !currentStep ? (
        <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-3">This journey has no steps yet.</div>
      ) : (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-auto bg-bg p-4">
            <div className="mb-3 text-center font-mono text-[12px] text-text-3">
              {stepData?.pageName ?? '…'} · {BREAKPOINT_WIDTH[viewport]}px · {BREAKPOINT_LABEL[viewport]}
            </div>
            <div
              className="relative mx-auto min-h-[600px] rounded-xl border border-border bg-panel p-4 transition-[width] duration-200"
              style={{ width: BREAKPOINT_WIDTH[viewport] }}
            >
              {stepLoading || !stepData || stepData.stepId !== currentStep.id ? (
                <div className="flex h-[600px] items-center justify-center text-[12px] text-text-3">Loading step…</div>
              ) : stepData.tree ? (
                // pointer-events-none disables every click/drag RenderNode
                // wires up internally (design editing must never be
                // reachable from Preview) — the hotspot overlays below sit
                // inside this same box with pointer-events-auto set
                // explicitly, which CSS re-enables per-element even under a
                // pointer-events-none ancestor.
                <div className="pointer-events-none relative">
                  {/* RenderNode's stack/container/grid children call
                      useDndMonitor unconditionally, which throws outside a
                      DndContext — this bare DndContext exists purely to
                      satisfy that, never to enable drag/drop (pointer
                      events are already off above). */}
                  <DndContext onDragEnd={() => {}}>
                    <RenderNode node={stepData.tree} />
                  </DndContext>
                  {resolvedLayout &&
                    outgoingConnections.map((connection) => {
                      const box = connection.elementId ? findBox(resolvedLayout, connection.elementId) : null
                      if (!box) return null
                      return (
                        <button
                          key={connection.id}
                          type="button"
                          onClick={() => goToStep(connection.toStepId)}
                          title={`${connection.trigger}${connection.label ? `: ${connection.label}` : ''}`}
                          className={`pointer-events-auto absolute rounded-md ${
                            hotspotsVisible
                              ? 'border-2 border-accent-2 bg-selected outline outline-2 outline-offset-1 outline-accent-2/50 transition-colors hover:bg-selected'
                              : ''
                          }`}
                          style={{ left: box.x, top: box.y, width: Math.max(box.width, 12), height: Math.max(box.height, 12) }}
                        />
                      )
                    })}
                </div>
              ) : (
                <div className="pointer-events-none h-[600px] overflow-hidden rounded-lg">
                  <StructurePreview structure={stepData.structure} />
                </div>
              )}
            </div>

            {/* Unresolved-element affordances — always reachable even when a
                connection's elementId doesn't map onto a node in the
                fetched tree (deleted/renamed node, reference-only step, no
                tree at all, …), so the walkthrough is never a dead end. */}
            {(() => {
              const unresolved = outgoingConnections.filter((c) => !c.elementId || !resolvedLayout || !findBox(resolvedLayout, c.elementId))
              if (unresolved.length === 0) return null
              return (
                <div className="mx-auto mt-4 flex max-w-[900px] flex-wrap justify-center gap-2">
                  {unresolved.map((connection) => {
                    const destStep = journey.steps.find((s) => s.id === connection.toStepId)
                    const destName = destStep ? describeStepPage(destStep, activeIndex) : 'Unknown step'
                    return (
                      <button
                        key={connection.id}
                        type="button"
                        onClick={() => goToStep(connection.toStepId)}
                        className="rounded-md border border-accent-2/40 bg-selected px-3 py-1.5 text-[12px] font-medium text-accent-2 hover:bg-selected"
                      >
                        {connection.trigger}
                        {connection.elementLabel ? `: ${connection.elementLabel}` : connection.label ? `: ${connection.label}` : ''} → {destName}
                      </button>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          {/* Step rail */}
          <div className="w-56 shrink-0 border-l border-border bg-bg-raised p-3">
            <div className="mb-2 text-[12px] font-semibold tracking-wide text-text-3">Steps</div>
            <div className="flex flex-col gap-1">
              {journey.steps.map((step, i) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => goToStep(step.id)}
                  className={`truncate rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium ${
                    step.id === currentStep.id ? 'bg-selected text-accent-2' : 'text-text-2 hover:bg-hover'
                  }`}
                >
                  {i + 1}. {step.id === currentStep.id ? stepData?.pageName ?? '…' : describeStepPage(step, activeIndex)}
                  {step.referenceOnly ? ' (reference)' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Cheap, sync page-name lookup for the step rail's non-current entries —
 * existing pages resolve from the already-loaded `ProjectModel`; a
 * Feature-invented page falls back to its id (avoids firing an IPC call
 * per rail row just to render a label). */
function describeStepPage(step: JourneyStep, activeIndex: ReturnType<typeof useProjectStore.getState>['activeIndex']): string {
  if (step.pageRef.kind === 'existing') {
    const page = activeIndex?.projectModel.pages.find((p) => p.id === step.pageRef.pageId)
    return page?.name ?? 'Untitled page'
  }
  return 'New page'
}

function JourneyPicker({
  journeysLoaded,
  journeys,
  onPick,
  onExit,
}: {
  journeysLoaded: boolean
  journeys: Journey[]
  onPick: (id: string) => void
  onExit: () => void
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-[360px] rounded-xl border border-border bg-bg-raised p-5">
        <div className="mb-3 text-[13px] font-semibold text-text">Choose a Journey to preview</div>
        {!journeysLoaded ? (
          <div className="text-[12px] text-text-3">Loading journeys…</div>
        ) : journeys.length === 0 ? (
          <div className="flex flex-col gap-3">
            <div className="text-[12px] text-text-3">This Feature has no Journeys yet. Build one in the Journey activity first.</div>
            <button type="button" onClick={onExit} className="self-start rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-[12px] font-semibold text-text-2">
              Back to Feature
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {journeys.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => onPick(j.id)}
                className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-left text-[12.5px] font-medium text-text-2 hover:text-text"
              >
                {j.name}
                <div className="text-[12px] text-text-3">{j.steps.length} step{j.steps.length === 1 ? '' : 's'}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
