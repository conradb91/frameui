import { useEffect, useMemo, useState } from 'react'
import { Palette, FileStack, Component as ComponentIcon, Map as MapIcon, ShieldCheck, Download, Share2, Play, Plus, Search, History } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { useFeatureStore } from '../../state/featureStore'
import { useDesignStore } from '../../state/designStore'
import { useConceptComponentStore } from '../../state/conceptComponentStore'
import { useJourneyStore } from '../../state/journeyStore'
import { CanvasRoot } from '../../components/designer/RenderNode'
import { LayersPanel } from '../../components/designer/LayersPanel'
import { LayoutInspector } from '../../components/designer/LayoutInspector'
import { ApplicationBrowser } from '../../components/designer/ApplicationBrowser'
import { NewPageCreator } from '../../components/designer/NewPageCreator'
import { StateTabsBar } from '../../components/designer/StateTabsBar'
import { AlternativesBar } from '../../components/designer/AlternativesBar'
import { ComponentLibraryPanel } from '../../components/designer/ComponentLibraryPanel'
import { ConceptComponentPanel } from '../../components/designer/ConceptComponentPanel'
import { SharePreviewPanel } from '../../components/designer/SharePreviewPanel'
import { JourneyListPanel } from '../../components/designer/JourneyListPanel'
import { JourneyCanvas } from '../../components/designer/JourneyCanvas'
import { JourneyInspector } from '../../components/designer/JourneyInspector'
import { FeatureReviewPanel } from '../../components/designer/FeatureReviewPanel'
import { VersionHistoryPanel } from '../../components/designer/VersionHistoryPanel'
import { StructurePreview } from '../../components/project/StructurePreview'
import { openDesignThisPage } from '../../lib/designThisPage'
import { FrameMark, ChevronRightIcon } from '../../components/icons/icons'
import { findNode } from '@core/design-model/tree'
import { createPrimitiveNode } from '@core/design-model/createPrimitiveNode'
import { classifyEditability } from '@core/design-model/editability'
import { resolveProjectBreakpoints } from '@core/design-model/resolveBreakpoints'
import type { DesignNode, PrimitiveKind, PlaceholderNode, Breakpoint } from '@shared/types/designNode'
import type { Component, Page, ProjectModel } from '@shared/types/model/projectModel'
import type { Annotation, Feature, FeatureStatus, PageRef, FeaturePage } from '@shared/types/model/featureModel'

type Activity = 'design' | 'pages' | 'components' | 'journey' | 'review' | 'history'
type ViewMode = 'current' | 'proposed' | 'compare'

const BREAKPOINT_LABEL: Record<Breakpoint, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' }

const ACTIVITIES: { id: Activity; label: string; icon: typeof Palette }[] = [
  { id: 'design', label: 'Design', icon: Palette },
  { id: 'pages', label: 'Pages', icon: FileStack },
  { id: 'components', label: 'Components', icon: ComponentIcon },
  { id: 'journey', label: 'Journey', icon: MapIcon },
  { id: 'review', label: 'Review', icon: ShieldCheck },
  { id: 'history', label: 'Version History', icon: History },
]

const STATUS_ORDER: FeatureStatus[] = ['concept', 'designing', 'review', 'approved', 'ready-for-development', 'implemented', 'verified']
const STATUS_LABEL: Record<FeatureStatus, string> = {
  concept: 'Concept',
  designing: 'Designing',
  review: 'In Review',
  approved: 'Approved',
  'ready-for-development': 'Ready for Dev',
  implemented: 'Implemented',
  verified: 'Verified',
}

const INSERT_CATEGORIES: { category: string; items: { kind: PrimitiveKind; label: string }[] }[] = [
  { category: 'Layout', items: [{ kind: 'stack', label: 'Stack' }, { kind: 'container', label: 'Container' }, { kind: 'divider', label: 'Divider' }] },
  { category: 'Text', items: [{ kind: 'heading', label: 'Heading' }, { kind: 'text', label: 'Text' }] },
  { category: 'Forms', items: [{ kind: 'button', label: 'Button' }] },
  { category: 'Assets', items: [{ kind: 'image', label: 'Image' }] },
]

export function FeatureWorkspaceView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const activeFeatureId = useUiStore((s) => s.activeFeatureId)
  const setView = useUiStore((s) => s.setView)
  const setSection = useUiStore((s) => s.setSection)

  const features = useFeatureStore((s) => s.features)
  const loadFeatures = useFeatureStore((s) => s.loadFeatures)
  const saveFeature = useFeatureStore((s) => s.saveFeature)

  const tree = useDesignStore((s) => s.tree)
  const selectedId = useDesignStore((s) => s.selectedId)
  const select = useDesignStore((s) => s.select)
  const dispatch = useDesignStore((s) => s.dispatch)
  const breakpoint = useDesignStore((s) => s.breakpoint)
  const setBreakpoint = useDesignStore((s) => s.setBreakpoint)
  const designSaving = useDesignStore((s) => s.saving)
  const activeDesignStateId = useDesignStore((s) => s.designStateId)
  const activeAlternativeId = useDesignStore((s) => s.alternativeId)
  const loadDesignState = useDesignStore((s) => s.loadDesignState)

  const conceptComponents = useConceptComponentStore((s) => s.components)
  const loadConceptComponents = useConceptComponentStore((s) => s.loadForFeature)

  const [activity, setActivity] = useState<Activity>(() => useJourneyStore.getState().activeJourney?.featureId === activeFeatureId ? 'journey' : 'pages')
  const [viewMode, setViewMode] = useState<ViewMode>('proposed')
  // Phase 20 — only meaningful when viewMode === 'compare': the existing
  // two-column layout, or Proposed stacked over Current at reduced opacity
  // in the same frame.
  const [compareMode, setCompareMode] = useState<'side-by-side' | 'overlay'>('side-by-side')
  const [browserOpen, setBrowserOpen] = useState(false)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [leftTab, setLeftTab] = useState<'layers' | 'insert'>('layers')
  const [sharePanelOpen, setSharePanelOpen] = useState(false)
  const [componentsTab, setComponentsTab] = useState<'library' | 'concept'>('library')
  // Which real/Feature page the Design activity's currently-open state
  // belongs to — set whenever a page is opened for design (Pages activity,
  // or the New Page flow), independent of which of that page's states is
  // loaded (switching states via the State Tabs bar doesn't change this).
  const [activePageRef, setActivePageRef] = useState<PageRef | null>(null)
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(() => useJourneyStore.getState().activeJourney?.featureId === activeFeatureId ? useJourneyStore.getState().activeJourney?.id ?? null : null)
  const [newPageCreatorOpen, setNewPageCreatorOpen] = useState(false)
  const [newPages, setNewPages] = useState<FeaturePage[]>([])

  const projectModel = activeIndex?.projectModel ?? null
  const feature = useMemo(() => features.find((f) => f.id === activeFeatureId) ?? null, [features, activeFeatureId])
  const breakpointWidths = useMemo(() => resolveProjectBreakpoints(projectModel?.tokens ?? []), [projectModel])

  useEffect(() => {
    if (activeProject) void loadFeatures(activeProject.id)
    // Re-run only when the project identity changes — `activeProject` is a
    // new object on every store tick, so depending on it directly would
    // refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, loadFeatures])

  useEffect(() => {
    if (activeProject && feature) void loadConceptComponents(activeProject.id, feature.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, feature?.id, loadConceptComponents])

  async function loadNewPages() {
    if (!activeProject || !feature) return
    setNewPages(await window.frameui.workspace.listFeaturePages(activeProject.id, feature.id))
  }

  useEffect(() => {
    void loadNewPages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, feature?.id])

  const designPages = useMemo(
    () => (projectModel && feature ? projectModel.pages.filter((p) => feature.pageIds.includes(p.id)) : []),
    [projectModel, feature],
  )
  const referencePages = useMemo(
    () => (projectModel && feature ? projectModel.pages.filter((p) => feature.referenceOnlyPageIds.includes(p.id)) : []),
    [projectModel, feature],
  )

  // "Current" (spec Phase 20) only exists for a real, existing page — a
  // Feature-invented new page has no real source to compare against, so
  // Current/Compare modes hide that pane entirely for one (handled where
  // `currentPage` is consumed below).
  const currentPage = useMemo(() => {
    if (!projectModel || !activePageRef || activePageRef.kind !== 'existing') return null
    return projectModel.pages.find((p) => p.id === activePageRef.pageId) ?? null
  }, [projectModel, activePageRef])

  const selectedNode = tree && selectedId ? findNode(tree, selectedId) : null
  const insertTargetId = selectedNode && (selectedNode.kind === 'stack' || selectedNode.kind === 'container') ? selectedNode.id : tree?.id ?? null

  if (!activeProject) return null

  function handleBack() {
    setView('workspace')
    setSection('features')
  }

  async function handleAddPage(pageId: string, mode: 'design' | 'reference') {
    if (!feature) return
    const next =
      mode === 'design'
        ? { ...feature, pageIds: feature.pageIds.includes(pageId) ? feature.pageIds : [...feature.pageIds, pageId] }
        : { ...feature, referenceOnlyPageIds: feature.referenceOnlyPageIds.includes(pageId) ? feature.referenceOnlyPageIds : [...feature.referenceOnlyPageIds, pageId] }
    await saveFeature(next)
  }

  async function handleDesignThisPage(page: Page) {
    if (!feature) return
    await openDesignThisPage(activeProject!.id, feature, page)
    setActivePageRef({ kind: 'existing', pageId: page.id })
    setActivity('design')
  }

  /** Opens a Feature-invented page's "Default" state — its initial design
   * tree is expected to already exist (built by `NewPageCreator` at
   * creation time from the chosen layout source: blank/project-layout/
   * clone/pattern), so this only finds-or-creates the state record itself,
   * same shape as `openDesignThisPage` for a real page. */
  async function handleDesignNewPage(page: FeaturePage) {
    if (!feature || !activeProject) return
    const pageRef: PageRef = { kind: 'new', pageId: page.id }
    const states = await window.frameui.workspace.listDesignStatesForPage(activeProject.id, pageRef)
    let defaultState = states.find((s) => s.name === 'Default')
    if (!defaultState) {
      defaultState = await window.frameui.workspace.createDesignState(activeProject.id, {
        featureId: feature.id,
        pageRef,
        pageSlugHint: page.name,
        name: 'Default',
        origin: 'design',
        provenance: 'new',
      })
    }
    await useDesignStore.getState().loadDesignState(activeProject.id, defaultState.id, null)
    setActivePageRef(pageRef)
    setActivity('design')
  }


  async function handleSetStatus(status: FeatureStatus) {
    if (!feature) return
    await saveFeature({ ...feature, status })
  }

  async function handleJumpToAnnotation(item: Annotation) {
    if (!item.designStateId) return
    setActivePageRef(item.pageRef)
    setBreakpoint(item.viewport)
    await loadDesignState(activeProject!.id, item.designStateId, item.alternativeId)
    select(item.elementId)
    setActivity('review')
  }

  function handleInsertPrimitive(kind: PrimitiveKind) {
    if (!tree || !insertTargetId) return
    const node = createPrimitiveNode(kind)
    const target = findNode(tree, insertTargetId)
    const index = target ? target.children.length : 0
    dispatch({ type: 'InsertComponent', parentId: insertTargetId, index, node })
    select(node.id)
  }

  function handleInsertComponent(component: Component) {
    if (!tree || !insertTargetId) return
    const node: PlaceholderNode = {
      kind: 'placeholder',
      id: crypto.randomUUID(),
      editability: classifyEditability('project-component-partial'),
      provenance: 'existing',
      children: [],
      label: component.name,
      sourceFilePath: component.source.filePath,
    }
    const target = findNode(tree, insertTargetId)
    const index = target ? target.children.length : 0
    dispatch({ type: 'InsertComponent', parentId: insertTargetId, index, node })
    select(node.id)
  }

  /** Shared by the Component Library and Concept Component panels in the
   * Components activity — both hand back a ready `DesignNode` (a real
   * component becomes a `PlaceholderNode` via `handleInsertComponent`'s
   * logic reused here for concept nodes, which already arrive fully built). */
  function handleInsertNode(node: DesignNode) {
    if (!tree || !insertTargetId) return
    const target = findNode(tree, insertTargetId)
    const index = target ? target.children.length : 0
    dispatch({ type: 'InsertComponent', parentId: insertTargetId, index, node })
    select(node.id)
  }

  if (!feature) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <div className="text-center">
          <div className="text-[13px] text-text-2">Loading feature…</div>
          <button type="button" onClick={handleBack} className="mt-3 text-[12px] font-semibold text-accent-2 hover:underline">
            Back to Features
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Top toolbar */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-raised px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={handleBack} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/5">
            <ChevronRightIcon className="h-3.5 w-3.5 rotate-180 text-text-2" />
          </button>
          <FrameMark className="h-[14px] w-[14px] shrink-0 text-accent-2" />
          <span className="truncate font-mono text-[12px] text-text-3">{activeProject.name}</span>
          <ChevronRightIcon className="h-3 w-3 shrink-0 text-text-3" />
          <span className="truncate text-[13.5px] font-semibold text-text">{feature.name}</span>
          <select value={feature.status} onChange={(event) => void handleSetStatus(event.target.value as FeatureStatus)} className="rounded border border-border bg-panel-2 px-2 py-1 text-[10px] font-semibold text-accent-2 outline-none">
            {STATUS_ORDER.map((status) => <option key={status} value={status} className="bg-panel text-text">{STATUS_LABEL[status]}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-panel-2 p-0.5">
            {(['current', 'proposed', 'compare'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold capitalize ${viewMode === mode ? 'bg-accent/20 text-accent-2' : 'text-text-2'}`}
              >
                {mode}
              </button>
            ))}
          </div>

          {activity === 'design' && (
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-panel-2 p-0.5">
              {(['desktop', 'tablet', 'mobile'] as const).map((bp) => (
                <button
                  key={bp}
                  type="button"
                  onClick={() => setBreakpoint(bp)}
                  title={breakpointWidths.source === 'fallback' ? 'Using default breakpoints — none detected in this project' : undefined}
                  className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${breakpoint === bp ? 'bg-accent/20 text-accent-2' : 'text-text-2'}`}
                >
                  {BREAKPOINT_LABEL[bp]}
                  {breakpointWidths.source === 'fallback' && <span className="text-text-3"> (default)</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              useUiStore.getState().setActiveFeatureId(feature?.id ?? null)
              setView('feature-preview')
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] font-semibold text-text-2 hover:text-text"
          >
            <Play size={12} />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setSharePanelOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] font-semibold text-text-2 hover:text-text"
          >
            <Share2 size={12} />
            Share
          </button>
          <button
            type="button"
            onClick={() => setView('export')}
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-gradient-to-b from-[#8676F4] to-[#7461EE] px-2.5 py-1.5 text-[12px] font-semibold text-white"
          >
            <Download size={12} />
            Export
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Activity rail */}
        <nav aria-label="Feature activities" className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-r border-border bg-bg-raised py-2">
          {ACTIVITIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => setActivity(id)}
              className={`relative flex h-10 w-10 items-center justify-center rounded ${
                activity === id ? 'bg-accent/12 text-accent-2 before:absolute before:-left-1 before:h-5 before:w-0.5 before:rounded-r before:bg-accent-2' : 'text-text-3 hover:bg-white/5 hover:text-text-2'
              }`}
            >
              <Icon size={18} strokeWidth={1.65} />
            </button>
          ))}
        </nav>

        {/* Contextual left panel */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-raised overflow-hidden">
          {activity === 'design' && (
            <>
              <div className="flex border-b border-border">
                {(['layers', 'insert'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setLeftTab(tab)}
                    className={`flex-1 py-2.5 text-center text-[12px] font-semibold capitalize ${leftTab === tab ? 'border-b-2 border-accent-2 text-text' : 'text-text-3'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-2.5">
                {!tree ? (
                  <div className="p-2 text-[11.5px] text-text-3">No screen open. Pick a page from the Pages activity.</div>
                ) : leftTab === 'layers' ? (
                  <LayersPanel tree={tree} />
                ) : (
                  <InsertTab onInsert={handleInsertPrimitive} onInsertComponent={handleInsertComponent} components={projectModel?.components ?? []} />
                )}
              </div>
            </>
          )}

          {activity === 'pages' && (
            <div className="flex-1 overflow-y-auto p-2.5">
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">In This Feature</div>
              <div className="flex flex-col gap-1">
                {designPages.map((p) => (
                  <PageRow key={p.id} page={p} selected={selectedPageId === p.id} onClick={() => setSelectedPageId(p.id)} />
                ))}
                {referencePages.map((p) => (
                  <PageRow key={p.id} page={p} selected={selectedPageId === p.id} onClick={() => setSelectedPageId(p.id)} reference />
                ))}
                {designPages.length === 0 && referencePages.length === 0 && <div className="px-1 py-3 text-[11.5px] text-text-3">No pages added yet.</div>}
              </div>
            </div>
          )}

          {/* PHASE 21 (Journeys) — replace this block's content with the
              Journey list (from `window.frameui.workspace.listJourneys`),
              selection state, and create/delete actions. The old Flow-based
              list that lived here has been removed. */}
          {activity === 'journey' && (
            <JourneyListPanel
              projectId={activeProject.id}
              featureId={feature.id}
              selectedJourneyId={selectedJourneyId}
              onSelectJourney={setSelectedJourneyId}
            />
          )}

          {activity === 'components' && (
            <div className="flex flex-col gap-0.5 p-2">
              <button
                type="button"
                onClick={() => setComponentsTab('library')}
                className={`rounded-md px-2.5 py-2 text-left text-[12px] font-medium ${componentsTab === 'library' ? 'bg-accent/12 text-accent-2' : 'text-text-2 hover:bg-white/5 hover:text-text'}`}
              >
                Project Components
                <div className="font-mono text-[10px] font-normal text-text-3">{projectModel?.components.length ?? 0} detected</div>
              </button>
              <button
                type="button"
                onClick={() => setComponentsTab('concept')}
                className={`rounded-md px-2.5 py-2 text-left text-[12px] font-medium ${componentsTab === 'concept' ? 'bg-accent/12 text-accent-2' : 'text-text-2 hover:bg-white/5 hover:text-text'}`}
              >
                Concept Components
                <div className="font-mono text-[10px] font-normal text-text-3">{conceptComponents.length} in this feature</div>
              </button>
              {!tree && (
                <div className="mt-3 rounded-md border border-border bg-panel-2 px-2.5 py-2 text-[10.5px] leading-relaxed text-text-3">
                  Open a page in the Design activity to insert components into it.
                </div>
              )}
            </div>
          )}

          {activity === 'review' && (
            <FeatureReviewPanel projectId={activeProject.id} featureId={feature.id} pageRef={activePageRef} designStateId={activeDesignStateId} alternativeId={activeAlternativeId} breakpoint={breakpoint} selectedNode={selectedNode} tree={tree} onJump={(item) => void handleJumpToAnnotation(item)} />
          )}
          {activity === 'history' && <div className="p-3 text-[11px] leading-relaxed text-text-3">Named versions preserve semantic Feature operations. Restore creates a new milestone and never deletes later history.</div>}
        </div>

        {/* Main canvas */}
        <div className="relative flex flex-1 min-w-0 flex-col overflow-hidden">
          {activity === 'design' && (
            <>
              {/* PHASE 17 (Design States) — tabs for the active page's
                  states (Default/Loading/Error/...), capture/create/
                  duplicate/rename/delete/reorder. Switching tabs calls
                  `useDesignStore.getState().loadDesignState(projectId,
                  stateId, null)`. Only meaningful once a page is open. */}
              {activePageRef && (
                <StateTabsBar
                  projectId={activeProject.id}
                  featureId={feature.id}
                  pageRef={activePageRef}
                  activeStateId={activeDesignStateId}
                  onSelectState={(stateId: string) => void loadDesignState(activeProject.id, stateId, null)}
                />
              )}
              {/* PHASE 19 (Alternatives) — Current/Concept A/Concept B/
                  Approved selector for the active state, duplicate/rename/
                  set preferred/set approved/delete/compare. Selecting one
                  calls `loadDesignState(projectId, stateId, alternativeId)`;
                  `null` means the state's own base tree ("Current"). */}
              {activePageRef && activeDesignStateId && (
                <AlternativesBar
                  projectId={activeProject.id}
                  featureId={feature.id}
                  designStateId={activeDesignStateId}
                  activeAlternativeId={activeAlternativeId}
                  onSelectAlternative={(alternativeId: string | null) => void loadDesignState(activeProject.id, activeDesignStateId, alternativeId)}
                />
              )}
              <div className="border-b border-border bg-bg-raised py-1.5 text-center text-[10.5px] font-semibold uppercase tracking-wide text-accent-2">
                {viewMode === 'current' && 'Current — Real Page Source (Read-Only)'}
                {viewMode === 'proposed' && 'Proposed — Editable Design Draft'}
                {viewMode === 'compare' && 'Compare — Current vs Proposed'}
              </div>
              {viewMode === 'compare' && (
                <div className="flex items-center justify-center gap-0.5 border-b border-border bg-bg-raised py-1">
                  {(['side-by-side', 'overlay'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCompareMode(mode)}
                      className={`rounded-md px-2.5 py-1 text-[10.5px] font-semibold ${compareMode === mode ? 'bg-accent/20 text-accent-2' : 'text-text-2'}`}
                    >
                      {mode === 'side-by-side' ? 'Side by Side' : 'Overlay'}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex-1 overflow-auto bg-bg p-8" onClick={() => select(null)}>
                {!tree ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <div className="text-[13px] text-text-2">No screen open yet.</div>
                    <button type="button" onClick={() => setActivity('pages')} className="text-[12px] font-semibold text-accent-2 hover:underline">
                      Go to Pages to pick one
                    </button>
                  </div>
                ) : viewMode === 'compare' && compareMode === 'overlay' ? (
                  <div className="mx-auto flex flex-col items-center gap-2">
                    <div
                      className="relative min-h-[500px] overflow-hidden rounded-xl border border-border bg-white"
                      style={{ width: breakpointWidths[breakpoint] }}
                    >
                      <StructurePreview structure={currentPage?.structure ?? []} />
                      {/* Proposed layered directly over Current at reduced
                          opacity in the same frame — a real visual overlay,
                          not a second toggle that does nothing. Plain
                          transparency (not mix-blend-difference) so the
                          Proposed layer's own text/colors stay legible while
                          comparing. */}
                      <div className="pointer-events-none absolute inset-0 overflow-auto rounded-xl bg-panel/80 p-8 opacity-60">
                        <CanvasRoot node={tree} />
                      </div>
                    </div>
                    <div className="max-w-md text-center text-[10.5px] leading-relaxed text-text-3">
                      Proposed is stacked over Current at 60% opacity. Per-node difference highlighting (tinting exactly which
                      elements are new/modified) isn't wired up here — `RenderNode` doesn't expose per-node provenance as a DOM
                      hook to target from outside it, so a reliable, honest tint isn't cheaply achievable without editing that
                      file this round.
                    </div>
                  </div>
                ) : (
                  <div className={viewMode === 'compare' ? 'flex justify-center gap-6' : ''}>
                    {(viewMode === 'current' || viewMode === 'compare') && (
                      <div className={viewMode === 'compare' ? 'flex flex-col items-center gap-2' : 'mx-auto flex flex-col items-center gap-2'}>
                        {viewMode === 'compare' && <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Current</div>}
                        <div
                          className="min-h-[500px] overflow-hidden rounded-xl border border-border bg-white"
                          style={{ width: viewMode === 'compare' ? breakpointWidths[breakpoint] / 1.6 : breakpointWidths[breakpoint] }}
                        >
                          <StructurePreview structure={currentPage?.structure ?? []} />
                        </div>
                      </div>
                    )}
                    {(viewMode === 'proposed' || viewMode === 'compare') && (
                      <div className={viewMode === 'compare' ? 'flex flex-col items-center gap-2' : 'mx-auto flex flex-col items-center gap-2'}>
                        {viewMode === 'compare' && <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Proposed</div>}
                        <div
                          className="min-h-[500px] rounded-xl border border-border bg-panel p-8"
                          style={{ width: viewMode === 'compare' ? breakpointWidths[breakpoint] / 1.6 : breakpointWidths[breakpoint] }}
                        >
                          <CanvasRoot node={tree} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {activity === 'pages' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-text">Pages in this Feature</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setNewPageCreatorOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-[12px] font-semibold text-text-2 hover:text-text"
                  >
                    <Plus size={13} />
                    Create New Page
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrowserOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2"
                  >
                    <Search size={13} />
                    Add Existing Page
                  </button>
                </div>
              </div>

              {/* PHASE 16 (New Page Creation) — new pages the designer
                  invented (`FeaturePage`), separate from real indexed pages
                  above. */}
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">New Pages ({newPages.length})</div>
              <div className="mb-6 flex flex-col gap-2">
                {newPages.map((p) => (
                  <NewPageCard key={p.id} page={p} onDesign={() => void handleDesignNewPage(p)} />
                ))}
                {newPages.length === 0 && <div className="text-[12px] text-text-3">No new pages yet — create one from a blank canvas, the project's own layout, or an existing page.</div>}
              </div>

              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Editable ({designPages.length})</div>
              <div className="mb-6 flex flex-col gap-2">
                {designPages.map((p) => (
                  <PageCard key={p.id} page={p} onDesign={() => void handleDesignThisPage(p)} />
                ))}
                {designPages.length === 0 && <div className="text-[12px] text-text-3">No editable pages yet — add one from the application browser.</div>}
              </div>

              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Reference Only ({referencePages.length})</div>
              <div className="flex flex-col gap-2">
                {referencePages.map((p) => (
                  <PageCard key={p.id} page={p} reference />
                ))}
                {referencePages.length === 0 && <div className="text-[12px] text-text-3">No reference pages yet.</div>}
              </div>

              {newPageCreatorOpen && projectModel && (
                <NewPageCreator
                  projectId={activeProject.id}
                  featureId={feature.id}
                  projectModel={projectModel}
                  onCreated={(page: FeaturePage) => {
                    setNewPageCreatorOpen(false)
                    void saveFeature({ ...feature, newPageIds: feature.newPageIds.includes(page.id) ? feature.newPageIds : [...feature.newPageIds, page.id] })
                    void loadNewPages()
                  }}
                  onClose={() => setNewPageCreatorOpen(false)}
                />
              )}

              {browserOpen && projectModel && (
                <ApplicationBrowser projectModel={projectModel} feature={feature} onAddPage={(pageId, mode) => void handleAddPage(pageId, mode)} onClose={() => setBrowserOpen(false)} />
              )}
            </div>
          )}

          {activity === 'components' && componentsTab === 'library' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold text-text">Project Component Library</h2>
                <span className="font-mono text-[10px] text-text-3">
                  {featureComponentList(projectModel, designPages, feature.componentIds).length} linked to this feature · {projectModel?.components.length ?? 0} total
                </span>
              </div>
              <ComponentLibraryPanel
                components={featureComponentsFirst(projectModel, feature.componentIds)}
                pages={projectModel?.pages ?? []}
                activeProjectId={activeProject.id}
                onInsert={handleInsertComponent}
              />
            </div>
          )}

          {activity === 'components' && componentsTab === 'concept' && (
            <div className="flex-1 overflow-y-auto p-6">
              <h2 className="mb-4 text-[15px] font-semibold text-text">Concept Components</h2>
              <ConceptComponentPanel projectId={activeProject.id} featureId={feature.id} onInsert={handleInsertNode} />
            </div>
          )}

          {/* PHASE 21 (Journeys) — full pan/zoom/multi-select canvas over
              the selected Journey's steps/connections, reusing @xyflow/react
              the same way the old FlowWorkspaceView did. */}
          {activity === 'journey' && (
            <JourneyCanvas
              projectId={activeProject.id}
              featureId={feature.id}
              projectModel={projectModel}
              journeyId={selectedJourneyId}
              onJourneyChange={setSelectedJourneyId}
              onOpenInDesign={() => setActivity('design')}
            />
          )}

          {activity === 'review' && (
            <div className="relative flex-1 overflow-auto bg-bg p-8" onClick={() => select(null)}>
              {tree ? <div className="mx-auto min-h-[500px] rounded-xl border border-border bg-panel p-8" style={{ width: breakpointWidths[breakpoint] }}><CanvasRoot node={tree}/></div> : <div className="flex h-full items-center justify-center text-[12px] text-text-3">Open a page, then enter Review to annotate its page or elements.</div>}
            </div>
          )}

          {activity === 'history' && <div className="flex-1 overflow-y-auto"><VersionHistoryPanel projectId={activeProject.id} featureId={feature.id}/></div>}
        </div>

        {/* Right inspector */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-border bg-bg-raised p-3">
          {activity === 'design' &&
            (selectedNode && tree ? (
              <LayoutInspector
                node={selectedNode}
                tree={tree}
                breakpoint={breakpoint}
                components={projectModel?.components ?? []}
                conceptComponents={conceptComponents}
                tokens={projectModel?.tokens ?? []}
                dispatch={dispatch}
                onSelect={select}
              />
            ) : (
              <div className="text-[11.5px] text-text-3">Select an element to edit its properties.</div>
            ))}

          {activity === 'pages' && <PageInspector page={projectModel?.pages.find((p) => p.id === selectedPageId) ?? null} feature={feature} />}

          {/* PHASE 21/23 (Journeys/Interactions) — selected step or
              connection details (page/state/provenance for a step; the full
              interaction editor — trigger/element/destination — for a
              connection). */}
          {activity === 'journey' && <JourneyInspector projectId={activeProject.id} featureId={feature.id} journeyId={selectedJourneyId} />}

          {activity === 'components' && <div className="text-[11.5px] text-text-3">Feature: {feature.name}</div>}
          {activity === 'review' && <FeatureMetadataEditor feature={feature} onSave={saveFeature}/>}
          {activity === 'history' && <div className="text-[11px] leading-relaxed text-text-3">Versions retain page/state/alternative operations and restore into a new working milestone.</div>}
        </div>
      </div>

      {/* Bottom status bar */}
      <footer className="flex h-[26px] shrink-0 items-center gap-4 border-t border-border bg-bg-raised px-3 font-mono text-[10px] text-text-3">
        <span className="text-text-2">{feature.name}</span>
        <span>{STATUS_LABEL[feature.status]}</span>
        {activity === 'design' && <span>{designSaving ? 'Saving…' : 'Saved'}</span>}
        <span className="ml-auto">{activeProject.name}</span>
      </footer>

      {sharePanelOpen && <SharePreviewPanel projectId={activeProject.id} featureId={feature.id} onClose={() => setSharePanelOpen(false)} />}
    </div>
  )
}

function FeatureMetadataEditor({ feature, onSave }: { feature: Feature; onSave: (feature: Feature) => Promise<Feature> }) {
  const [owner, setOwner] = useState(feature.owner ?? '')
  const [reviewers, setReviewers] = useState(feature.reviewers.join(', '))
  const [dueDate, setDueDate] = useState(feature.dueDate ?? '')
  const [ticket, setTicket] = useState(feature.externalTicketRef ?? '')
  async function commit() {
    await onSave({ ...feature, owner: owner.trim() || null, reviewers: reviewers.split(',').map((value) => value.trim()).filter(Boolean), dueDate: dueDate || null, externalTicketRef: ticket.trim() || null })
  }
  const inputClass = 'mt-1 h-7 w-full rounded border border-border bg-panel-2 px-2 text-[10.5px] text-text outline-none focus:border-accent/60'
  return <div className="space-y-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Feature handoff</div><label className="block text-[10px] text-text-3">Owner<input value={owner} onChange={(e) => setOwner(e.target.value)} onBlur={() => void commit()} className={inputClass}/></label><label className="block text-[10px] text-text-3">Reviewers<input value={reviewers} onChange={(e) => setReviewers(e.target.value)} onBlur={() => void commit()} placeholder="Comma separated" className={inputClass}/></label><label className="block text-[10px] text-text-3">Due date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} onBlur={() => void commit()} className={inputClass}/></label><label className="block text-[10px] text-text-3">External ticket<input value={ticket} onChange={(e) => setTicket(e.target.value)} onBlur={() => void commit()} placeholder="e.g. APP-142" className={inputClass}/></label><div className="border-t border-border pt-2 text-[9.5px] text-text-3">Created {new Date(feature.createdAt).toLocaleDateString()}<br/>Updated {new Date(feature.updatedAt).toLocaleString()}</div></div>
}

function featureComponentList(projectModel: ProjectModel | null, pages: Page[], explicitlyAdded: string[] = []): Component[] {
  if (!projectModel) return []
  const names = new Set(pages.flatMap((p) => p.componentNames))
  const ids = new Set(explicitlyAdded)
  return projectModel.components.filter((c) => names.has(c.name) || ids.has(c.id))
}

function featureComponentsFirst(projectModel: ProjectModel | null, explicitlyAdded: string[]): Component[] {
  if (!projectModel) return []
  const ids = new Set(explicitlyAdded)
  return [...projectModel.components].sort((left, right) => Number(ids.has(right.id)) - Number(ids.has(left.id)))
}

function PageRow({ page, selected, onClick, reference }: { page: Page; selected: boolean; onClick: () => void; reference?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-2 text-left text-[12px] ${selected ? 'bg-accent/12 text-accent-2' : 'text-text-2 hover:bg-white/5 hover:text-text'}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate font-medium">{page.name}</span>
        {reference && <span className="shrink-0 rounded bg-white/5 px-1 py-px text-[9px] font-bold uppercase text-text-3">Ref</span>}
      </div>
      <div className="truncate font-mono text-[10px] text-text-3">{page.route ?? page.source.filePath}</div>
    </button>
  )
}

function PageCard({ page, onDesign, reference }: { page: Page; onDesign?: () => void; reference?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-panel-2 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium text-text">{page.name}</div>
        <div className="font-mono text-[10.5px] text-accent-2">{page.route ?? 'No route'}</div>
        <div className="truncate font-mono text-[10px] text-text-3">{page.source.filePath}</div>
      </div>
      {!reference && onDesign && (
        <button type="button" onClick={onDesign} className="ml-3 shrink-0 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11.5px] font-semibold text-text-2 hover:text-text">
          Design This Page
        </button>
      )}
      {reference && <span className="ml-3 shrink-0 rounded bg-white/5 px-2 py-1 text-[10px] font-bold uppercase text-text-3">Reference Only</span>}
    </div>
  )
}

function NewPageCard({ page, onDesign }: { page: FeaturePage; onDesign: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-accent-2/25 bg-accent-2/[0.04] px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-text">{page.name}</span>
          <span className="shrink-0 rounded bg-accent-2/15 px-1.5 py-px text-[9px] font-bold uppercase text-accent-2">New</span>
        </div>
        <div className="font-mono text-[10.5px] text-accent-2">{page.suggestedRoute ?? 'No suggested route'}</div>
        {page.basedOnPageId && <div className="truncate text-[10px] text-text-3">Created from: {page.basedOnPageId}</div>}
      </div>
      <button type="button" onClick={onDesign} className="ml-3 shrink-0 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11.5px] font-semibold text-text-2 hover:text-text">
        Design This Page
      </button>
    </div>
  )
}

function PageInspector({ page, feature }: { page: Page | null; feature: { pageIds: string[]; referenceOnlyPageIds: string[] } }) {
  if (!page) return <div className="text-[11.5px] text-text-3">Select a page to see its details.</div>
  const isEditable = feature.pageIds.includes(page.id)
  const isReference = feature.referenceOnlyPageIds.includes(page.id)
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10.5px] text-text-3">Name</div>
        <div className="text-[12.5px] font-medium text-text">{page.name}</div>
      </div>
      <div>
        <div className="mb-1 text-[10.5px] text-text-3">Route</div>
        <div className="font-mono text-[11.5px] text-text-2">{page.route ?? 'No route'}</div>
      </div>
      <div>
        <div className="mb-1 text-[10.5px] text-text-3">Components</div>
        <div className="text-[11.5px] text-text-2">{page.componentNames.length}</div>
      </div>
      <div>
        <div className="mb-1 text-[10.5px] text-text-3">Provenance</div>
        <div className="text-[11.5px] text-text-2">{isEditable ? 'Editable in this feature' : isReference ? 'Reference only (never editable)' : 'Not in feature'}</div>
      </div>
    </div>
  )
}

function InsertTab({
  onInsert,
  onInsertComponent,
  components,
}: {
  onInsert: (kind: PrimitiveKind) => void
  onInsertComponent: (component: Component) => void
  components: Component[]
}) {
  const [query, setQuery] = useState('')

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return INSERT_CATEGORIES
    return INSERT_CATEGORIES.map((c) => ({ ...c, items: c.items.filter((i) => i.label.toLowerCase().includes(q)) })).filter((c) => c.items.length > 0)
  }, [query])

  const filteredComponents = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return components
    return components.filter((c) => c.name.toLowerCase().includes(q) || c.source.filePath.toLowerCase().includes(q))
  }, [query, components])

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-panel-2 px-2.5 py-2">
        <Search size={13} className="text-text-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search components…"
          className="flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-3"
        />
      </div>

      {filteredComponents.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Project Components</div>
          <div className="flex flex-col gap-1.5">
            {filteredComponents.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onInsertComponent(c)}
                title={c.source.filePath}
                className="rounded-lg border border-warning/25 bg-warning/[0.04] px-3 py-2 text-left text-[12.5px] font-medium text-text-2 hover:text-text"
              >
                <div>+ {c.name}</div>
                <div className="truncate font-mono text-[10px] text-text-3">{c.source.filePath}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {filteredCategories.map((c) => (
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
