import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, GitFork, Grid2X2, Maximize2, Monitor, MousePointer2, Search, Smartphone, Tablet, TreePine } from 'lucide-react'
import type { Diagnostic, Interaction, Page, Token } from '@shared/types/model/projectModel'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { resolveClassName } from '@core/adapters/tailwind/resolveClassName'
import { useProjectStore } from '../../../state/projectStore'
import { useFlowStore } from '../../../state/flowStore'
import { useDesignStore } from '../../../state/designStore'
import { useUiStore } from '../../../state/uiStore'
import { StructurePreview } from '../../../components/project/StructurePreview'

type WorkspaceMode = 'grid' | 'canvas' | 'routes' | 'journey' | 'responsive'
type ScreenFilter = 'all' | 'ready' | 'review' | 'errors'
const EMPTY_SCREENS: Page[] = []

const MODES: { id: WorkspaceMode; label: string; icon: typeof Grid2X2 }[] = [
  { id: 'grid', label: 'Grid', icon: Grid2X2 },
  { id: 'canvas', label: 'Canvas', icon: Maximize2 },
  { id: 'routes', label: 'Route tree', icon: TreePine },
  { id: 'journey', label: 'Application map', icon: GitFork },
  { id: 'responsive', label: 'Responsive', icon: Smartphone },
]

export function ScreensSection() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const summaries = useFlowStore((s) => s.summaries)
  const createFlow = useFlowStore((s) => s.createFlow)
  const openFlow = useFlowStore((s) => s.openFlow)
  const setNodesInStore = useFlowStore((s) => s.setNodes)
  const loadScreen = useDesignStore((s) => s.loadScreen)
  const setView = useUiStore((s) => s.setView)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ScreenFilter>('all')
  const [mode, setMode] = useState<WorkspaceMode>('grid')
  const selectedId = useUiStore((s) => s.selectedScreenId)
  const setSelectedId = useUiStore((s) => s.setSelectedScreenId)
  const [selectedElement, setSelectedElement] = useState<{ item: PageStructureItem; path: string } | null>(null)
  const [opening, setOpening] = useState(false)

  const model = activeIndex?.projectModel
  const screens = model?.pages ?? EMPTY_SCREENS
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return screens.filter((screen) => {
      if (filter === 'ready' && screen.analysisStatus !== 'ready') return false
      if (filter === 'review' && !model?.diagnostics.some((issue) => issue.pageId === screen.id)) return false
      if (filter === 'errors' && screen.analysisStatus === 'ready') return false
      return !normalizedQuery || [screen.name, screen.route ?? '', screen.source.filePath, ...screen.textContent, ...screen.componentNames].some((value) => value.toLowerCase().includes(normalizedQuery))
    })
  }, [filter, model?.diagnostics, query, screens])
  const selected = screens.find((screen) => screen.id === selectedId) ?? filtered[0] ?? screens[0] ?? null

  useEffect(() => {
    if (!selectedId && screens[0]) setSelectedId(screens[0].id)
  }, [screens, selectedId, setSelectedId])

  function selectScreen(screen: Page) {
    setSelectedId(screen.id)
    setSelectedElement(null)
  }

  async function handleOpenDesigner(page: Page) {
    if (!activeProject) return
    setOpening(true)
    try {
      await openPageInDesigner(page)
    } finally {
      setOpening(false)
    }
  }

  async function openPageInDesigner(page: Page) {
    if (!activeProject) return
    for (const summary of summaries) {
      const flow = await window.frameui.workspace.getFlow(activeProject.id, summary.id)
      const node = flow?.nodes.find((item) => item.source.type === 'existing-page' && item.source.pageFilePath === page.source.filePath)
      if (flow && node) {
        await openFlow(activeProject.id, flow.id)
        await loadScreen(activeProject.id, flow.id, node.id, node.source)
        setView('screen-designer')
        return
      }
    }
    let screensFlowId = summaries.find((summary) => summary.name === 'Screens')?.id
    if (!screensFlowId) screensFlowId = (await createFlow(activeProject.id, 'Screens')).id
    await openFlow(activeProject.id, screensFlowId)
    const flow = useFlowStore.getState().activeFlow
    if (!flow) return
    const nodeId = crypto.randomUUID()
    setNodesInStore([...flow.nodes, {
      id: nodeId,
      name: page.name,
      source: { type: 'existing-page' as const, pageFilePath: page.source.filePath },
      position: { x: 80 + flow.nodes.length * 40, y: 80 + flow.nodes.length * 40 },
    }])
    await loadScreen(activeProject.id, screensFlowId, nodeId, { type: 'existing-page', pageFilePath: page.source.filePath })
    setView('screen-designer')
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ScreenExplorer screens={screens} selected={selected} query={query} setQuery={setQuery} onSelect={selectScreen} />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-raised px-3">
          <div className="flex items-center gap-1">
            {MODES.map(({ id, label, icon: Icon }) => <button key={id} type="button" title={label} onClick={() => setMode(id)} className={`flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[11px] ${mode === id ? 'bg-blue-500/15 text-blue-300' : 'text-text-3 hover:bg-white/5 hover:text-text-2'}`}><Icon size={13} />{label}</button>)}
          </div>
          <div className="flex items-center gap-1 text-[10.5px]">
            {([
              ['all', `All ${screens.length}`],
              ['ready', `Ready ${screens.filter((screen) => screen.analysisStatus === 'ready').length}`],
              ['review', `Needs review ${new Set(model?.diagnostics.map((issue) => issue.pageId) ?? []).size}`],
              ['errors', `Render issues ${model?.statistics.renderIssues ?? 0}`],
            ] as [ScreenFilter, string][]).map(([id, label]) => <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-[5px] px-2 py-1 ${filter === id ? 'bg-white/[0.08] text-text' : 'text-text-3 hover:text-text-2'}`}>{label}</button>)}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {!activeIndex ? <AnalysisLoading /> : screens.length === 0 ? <EmptyScreens /> : (
            <>
              {mode === 'grid' && <ScreenGrid screens={filtered} selectedId={selected?.id ?? null} onSelect={selectScreen} />}
              {mode === 'canvas' && selected && <ScreenCanvas screen={selected} onSelectElement={(item, path) => setSelectedElement({ item, path })} />}
              {mode === 'routes' && <RouteTree screens={filtered} onSelect={selectScreen} />}
              {mode === 'journey' && model && <ApplicationMap screens={screens} areas={model.areas} connectionCount={model.statistics.connections} onSelect={selectScreen} />}
              {mode === 'responsive' && selected && <ResponsiveComparison screen={selected} />}
            </>
          )}
        </div>
      </main>
      <ScreenInspector screen={selected} selectedElement={selectedElement} interactions={model?.interactions.filter((item) => item.sourcePageId === selected?.id) ?? []} issues={model?.diagnostics.filter((item) => item.pageId === selected?.id) ?? []} tokens={model?.tokens ?? []} opening={opening} onOpen={() => selected && void handleOpenDesigner(selected)} onClearElement={() => setSelectedElement(null)} />
    </div>
  )
}

function ScreenExplorer({ screens, selected, query, setQuery, onSelect }: { screens: Page[]; selected: Page | null; query: string; setQuery: (value: string) => void; onSelect: (screen: Page) => void }) {
  const groups = useMemo(() => {
    const result = new Map<string, Page[]>()
    for (const screen of screens) result.set(screen.area, [...(result.get(screen.area) ?? []), screen])
    return [...result.entries()]
  }, [screens])
  return <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-bg-raised">
    <div className="flex h-10 items-center justify-between px-3"><span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Screens</span><span className="font-mono text-[10px] text-text-3">{screens.length}</span></div>
    <div className="border-b border-border px-2 pb-2"><div className="flex h-7 items-center gap-2 rounded-[5px] border border-border bg-panel px-2"><Search size={12} className="text-text-3" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search screens, text, routes…" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-text outline-none placeholder:text-text-3" /></div></div>
    <div className="flex-1 overflow-y-auto px-1.5 py-2">{groups.map(([area, items]) => <div key={area} className="mb-3"><div className="mb-1 flex items-center justify-between px-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-text-3"><span>{area}</span><span>{items.length}</span></div>{items.map((screen) => <button key={screen.id} type="button" onClick={() => onSelect(screen)} className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left ${selected?.id === screen.id ? 'bg-blue-500/14 text-text' : 'text-text-2 hover:bg-white/[0.04] hover:text-text'}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${screen.analysisStatus === 'ready' ? 'bg-green-400' : screen.analysisStatus === 'empty' ? 'bg-amber-400' : 'bg-red-400'}`} /><span className="min-w-0 flex-1 truncate text-[11.5px]">{screen.name}</span><span className="max-w-20 truncate font-mono text-[9px] text-text-3">{screen.route}</span></button>)}</div>)}</div>
  </aside>
}

function ScreenGrid({ screens, selectedId, onSelect }: { screens: Page[]; selectedId: string | null; onSelect: (screen: Page) => void }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-5">{screens.map((screen) => <button key={screen.id} type="button" onClick={() => onSelect(screen)} className={`overflow-hidden rounded-[6px] border text-left ${selectedId === screen.id ? 'border-blue-400/70 ring-1 ring-blue-400/20' : 'border-border hover:border-border-strong'}`}><div className="aspect-[16/10] overflow-hidden bg-white"><StructurePreview structure={screen.structure} compact /></div><div className="border-t border-border bg-panel px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="truncate text-[12px] font-semibold text-text">{screen.name}</span>{screen.analysisStatus !== 'ready' && <AlertTriangle size={12} className="shrink-0 text-amber-400" />}</div><div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9.5px] text-text-3"><span className="truncate">{screen.route ?? 'No route'}</span><span>{screen.elementCount} elements</span></div></div></button>)}</div>
}

function ScreenCanvas({ screen, onSelectElement }: { screen: Page; onSelectElement: (item: PageStructureItem, path: string) => void }) {
  return <div className="flex min-h-full items-start justify-center bg-[radial-gradient(rgb(255_255_255/0.045)_1px,transparent_1px)] bg-[length:20px_20px] p-10"><div className="w-full max-w-[920px]"><div className="mb-2 flex items-center justify-between font-mono text-[10px] text-text-3"><span>{screen.route ?? screen.name}</span><span>1440 × 900 · source structure</span></div><div className="aspect-[16/10] overflow-hidden rounded-[6px] border border-border-strong bg-white shadow-2xl"><StructurePreview structure={screen.structure} onSelect={onSelectElement} /></div></div></div>
}

function RouteTree({ screens, onSelect }: { screens: Page[]; onSelect: (screen: Page) => void }) {
  const byArea = new Map<string, Page[]>()
  for (const screen of screens) byArea.set(screen.area, [...(byArea.get(screen.area) ?? []), screen])
  return <div className="mx-auto max-w-4xl p-7"><div className="mb-4 text-[13px] font-semibold text-text">Detected route tree</div>{[...byArea.entries()].map(([area, items]) => <div key={area} className="mb-5 border-l border-border pl-4"><div className="mb-1 text-[11px] font-semibold text-text-2">{area}</div>{items.map((screen) => <button key={screen.id} type="button" onClick={() => onSelect(screen)} className="grid w-full grid-cols-[1fr_1fr_110px] border-b border-border py-2 text-left text-[11.5px] hover:bg-white/[0.025]"><span className="text-text">{screen.name}</span><span className="font-mono text-[10px] text-text-3">{screen.route ?? '—'}</span><span className="text-right text-text-3">{screen.elementCount} elements</span></button>)}</div>)}</div>
}

function ApplicationMap({ screens, areas, connectionCount, onSelect }: { screens: Page[]; areas: { id: string; name: string; pageIds: string[] }[]; connectionCount: number; onSelect: (screen: Page) => void }) {
  return <div className="min-h-full bg-[radial-gradient(rgb(255_255_255/0.04)_1px,transparent_1px)] bg-[length:22px_22px] p-7"><div className="mb-6 flex items-baseline gap-3"><h2 className="text-[16px] font-semibold text-text">Application Map</h2><span className="font-mono text-[10px] text-text-3">{screens.length} screens · {connectionCount} detected connections</span></div><div className="flex flex-wrap items-start gap-5">{areas.map((area) => <section key={area.id} className="w-56 border border-border bg-panel"><div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11.5px] font-semibold text-text"><span>{area.name}</span><span className="font-mono text-[9.5px] text-text-3">{area.pageIds.length}</span></div><div className="p-1.5">{area.pageIds.map((id) => { const screen = screens.find((item) => item.id === id); return screen ? <button key={id} type="button" onClick={() => onSelect(screen)} className="flex w-full items-center justify-between gap-2 rounded-[3px] px-2 py-1.5 text-left text-[10.5px] text-text-2 hover:bg-blue-500/12 hover:text-text"><span className="truncate">{screen.name}</span><span className="truncate font-mono text-[8.5px] text-text-3">{screen.route}</span></button> : null })}</div></section>)}</div></div>
}

function ResponsiveComparison({ screen }: { screen: Page }) {
  const frames = [{ label: 'Desktop', width: '46%', icon: Monitor }, { label: 'Tablet', width: '30%', icon: Tablet }, { label: 'Mobile', width: '20%', icon: Smartphone }]
  return <div className="flex min-h-full items-start justify-center gap-5 p-6">{frames.map(({ label, width, icon: Icon }) => <div key={label} style={{ width }}><div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-text-3"><Icon size={12} />{label}</div><div className="aspect-[10/12] overflow-hidden rounded-[5px] border border-border-strong bg-white"><StructurePreview structure={screen.structure} compact /></div></div>)}</div>
}

function ScreenInspector({ screen, selectedElement, interactions, issues, tokens, opening, onOpen, onClearElement }: { screen: Page | null; selectedElement: { item: PageStructureItem; path: string } | null; interactions: Interaction[]; issues: Diagnostic[]; tokens: Token[]; opening: boolean; onOpen: () => void; onClearElement: () => void }) {
  const attributes = selectedElement?.item.attributes ?? {}
  const classAttr = attributes.className ?? attributes.class
  const resolvedClasses = classAttr ? resolveClassName(classAttr, tokens) : []
  return <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-border bg-bg-raised">{!screen ? <div className="p-4 text-[11.5px] text-text-3">No screen selected.</div> : <>{selectedElement ? <div><InspectorHeader title={selectedElement.item.tagName} subtitle="Selected element" onBack={onClearElement} /><div className="p-3"><InspectorRow label="Type" value={selectedElement.item.isKnownComponent ? 'Project component' : 'Source element'} /><InspectorRow label="Tree path" value={selectedElement.path} mono /><InspectorRow label="Source" value={`${selectedElement.item.sourceFilePath ?? screen.source.filePath}${selectedElement.item.sourceLine ? `:${selectedElement.item.sourceLine}` : ''}`} mono />{selectedElement.item.textPreview && <InspectorRow label="Text" value={selectedElement.item.textPreview} />}{attributes.id && <InspectorRow label="ID" value={attributes.id} mono />}{classAttr && <InspectorRow label="Classes" value={classAttr} mono />}{resolvedClasses.length > 0 && <InspectorSection title={`Resolved tokens ${resolvedClasses.length}`}>{resolvedClasses.map((resolved, index) => <div key={`${resolved.className}-${index}`} className="border-b border-border py-1.5 font-mono text-[9.5px] last:border-0"><span className="text-text-2">{resolved.className}</span><span className="text-text-3"> → {resolved.properties.join(', ')}: </span><span className="text-text">{resolved.value}</span></div>)}</InspectorSection>}{attributes.role && <InspectorRow label="Role" value={attributes.role} />}{attributes['aria-label'] && <InspectorRow label="A11y label" value={attributes['aria-label']} />}<div className="mt-4 rounded-[4px] border border-blue-400/20 bg-blue-400/[0.06] p-2.5 text-[10.5px] leading-relaxed text-text-2">Static source details are available now. Run the application to add computed CSS, contrast, touch-target and runtime-state checks.</div></div></div> : <div><InspectorHeader title={screen.name} subtitle={screen.area} /><div className="p-3"><InspectorRow label="Route" value={screen.route ?? 'No route detected'} mono /><InspectorRow label="Source" value={screen.source.filePath} mono /><InspectorRow label="Elements" value={String(screen.elementCount)} /><InspectorRow label="Components" value={String(screen.componentNames.length)} /><InspectorRow label="States" value={String(screen.states.length)} /><InspectorRow label="Viewports" value="Desktop · Tablet · Mobile" /><button type="button" onClick={onOpen} disabled={opening} className="mt-4 w-full rounded-[5px] bg-blue-600 px-3 py-2 text-[11.5px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{opening ? 'Opening…' : 'Open design workspace'}</button>{interactions.length > 0 && <InspectorSection title={`Actions ${interactions.length}`}>{interactions.map((item) => <div key={item.id} className="border-b border-border py-2 last:border-0"><div className="truncate text-[10.5px] text-text-2">{item.label}</div><div className="mt-0.5 flex justify-between font-mono text-[9px] text-text-3"><span>{item.destinationRoute}</span><span className={item.resolved ? 'text-green-400' : 'text-amber-400'}>{item.resolved ? 'Resolved' : `Line ${item.source.line}`}</span></div></div>)}</InspectorSection>}{issues.length > 0 && <InspectorSection title={`Needs review ${issues.length}`}>{issues.map((item) => <div key={item.id} className="border-b border-border py-2 text-[10.5px] last:border-0"><div className="text-amber-300">{item.title}</div><div className="mt-0.5 truncate font-mono text-[9px] text-text-3">{item.detail}</div></div>)}</InspectorSection>}</div></div>}</>}</aside>
}

function InspectorHeader({ title, subtitle, onBack }: { title: string; subtitle: string; onBack?: () => void }) { return <div className="border-b border-border p-3">{onBack && <button type="button" onClick={onBack} className="mb-2 text-[10px] text-blue-300">← Screen</button>}<div className="text-[12.5px] font-semibold text-text">{title}</div><div className="mt-0.5 text-[10px] text-text-3">{subtitle}</div></div> }
function InspectorRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="grid grid-cols-[75px_1fr] gap-2 border-b border-border py-2"><span className="text-[10px] text-text-3">{label}</span><span className={`break-all text-[10.5px] text-text-2 ${mono ? 'font-mono text-[9.5px]' : ''}`}>{value}</span></div> }
function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mt-5"><div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wider text-text-3">{title}</div>{children}</section> }
function AnalysisLoading() { return <div className="flex h-full items-center justify-center"><div className="w-80"><div className="mb-3 text-[12px] font-semibold text-text">Analysing product structure…</div>{['Routes', 'Views', 'Components', 'Design tokens', 'Relationships'].map((item, index) => <div key={item} className="flex items-center justify-between border-b border-border py-2 text-[10.5px]"><span className="text-text-2">{item}</span><span className={index < 2 ? 'text-green-400' : 'text-text-3'}>{index < 2 ? 'Complete' : 'Analysing'}</span></div>)}</div></div> }
function EmptyScreens() { return <div className="flex h-full items-center justify-center"><div className="max-w-sm text-center"><MousePointer2 size={20} className="mx-auto mb-3 text-text-3" /><div className="text-[12px] font-semibold text-text">No screen sources found</div><div className="mt-1 text-[10.5px] leading-relaxed text-text-3">FrameUI indexed the project, but no supported page or view directory was detected.</div></div></div> }
