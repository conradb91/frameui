import { useEffect, useMemo, useState } from 'react'
import { Download, FileArchive, Layers3 } from 'lucide-react'
import type { Breakpoint } from '@shared/types/designNode'
import type { ExportRecord, FeatureExportSettings, HandoffInput } from '@shared/types/handoff'
import type { PageRef } from '@shared/types/model/featureModel'
import { useProjectStore } from '../../state/projectStore'
import { useFeatureStore } from '../../state/featureStore'
import { useUiStore } from '../../state/uiStore'
import { loadFeatureDelivery } from '../../lib/loadFeatureDelivery'
import { buildFeatureHandoff } from '@core/handoff/buildFeatureHandoff'
import { buildExportScenes, exportFeaturePackage, pageRefKey, sanitizeFilename } from '@core/export/featureExporter'
import { SvgExporter } from '@core/export/svgSerializer'

const DEFAULT_SETTINGS: FeatureExportSettings = { pageRefs: [], stateIds: [], viewports: ['desktop'], componentIds: [], journeyIds: [], includeAnnotations: false, includePageLabels: true, includeMetadata: true, embedImages: true, textHandling: 'editable', background: 'design', journeyLayout: 'horizontal' }

export function FeatureExportPanelView() {
  const project = useProjectStore((s) => s.activeProject)
  const model = useProjectStore((s) => s.activeIndex?.projectModel ?? null)
  const featureId = useUiStore((s) => s.activeFeatureId)
  const setView = useUiStore((s) => s.setView)
  const features = useFeatureStore((s) => s.features)
  const feature = features.find((item) => item.id === featureId) ?? null
  const [data, setData] = useState<HandoffInput | null>(null)
  const [settings, setSettings] = useState<FeatureExportSettings>(DEFAULT_SETTINGS)
  const [stage, setStage] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [history, setHistory] = useState<ExportRecord[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    if (!project || !feature || !model) return
    let live = true
    void Promise.all([loadFeatureDelivery(project.id, feature, model), window.frameui.workspace.listExportHistory(project.id, feature.id)]).then(([loaded, records]) => {
      if (!live) return
      setData(loaded); setHistory(records)
      const persisted = records[0]?.configuration
      setSettings(persisted ? { ...DEFAULT_SETTINGS, ...persisted } : { ...DEFAULT_SETTINGS, pageRefs: loaded.states.map((state) => state.pageRef).filter((ref, index, all) => all.findIndex((item) => pageRefKey(item) === pageRefKey(ref)) === index), stateIds: loaded.states.map((state) => state.id), componentIds: loaded.conceptComponents.map((item) => item.id), journeyIds: loaded.journeys.map((item) => item.id) })
    })
    return () => { live = false }
  }, [project, feature, model])

  const handoff = useMemo(() => data ? buildFeatureHandoff(data) : null, [data])
  if (!project || !feature || !model) return null
  if (!data || !handoff) return <div className="flex h-full items-center justify-center bg-bg text-[13px] text-text-2">Preparing Feature export…</div>

  const toggleRef = (ref: PageRef) => setSettings((current) => ({ ...current, pageRefs: current.pageRefs.some((item) => pageRefKey(item) === pageRefKey(ref)) ? current.pageRefs.filter((item) => pageRefKey(item) !== pageRefKey(ref)) : [...current.pageRefs, ref] }))
  const toggleList = (key: 'stateIds' | 'componentIds' | 'journeyIds', id: string) => setSettings((current) => ({ ...current, [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id] }))
  const toggleViewport = (viewport: Breakpoint) => setSettings((current) => ({ ...current, viewports: current.viewports.includes(viewport) ? current.viewports.filter((item) => item !== viewport) : [...current.viewports, viewport] }))

  async function record(type: ExportRecord['type'], count: number, outputPath: string | null) {
    const item: ExportRecord = { id: `export.${Date.now()}`, featureId: feature!.id, versionId: handoff!.approvedVersion?.id ?? null, versionName: handoff!.approvedVersion?.name ?? 'Working design', type, fileCount: count, configuration: settings, createdAt: new Date().toISOString(), outputPath }
    await window.frameui.workspace.recordExport(project!.id, item)
    setHistory((current) => [item, ...current].slice(0, 50))
  }
  async function exportOne() {
    setStage('Preparing selected page')
    try {
      const scene = buildExportScenes({ ...data!, approvedVersion: handoff!.approvedVersion, settings })[0]
      if (!scene) { setMessage('Select at least one page, state and viewport.'); return }
      setStage('Rendering vectors')
      const result = new SvgExporter().exportScene(scene, settings)
      setWarnings(result.warnings.map((item) => item.message))
      const output = await window.frameui.export.saveSvg(result.svg, `${sanitizeFilename(scene.name)}.svg`)
      if (output.ok) { await record('page', 1, output.filePath ?? null); setMessage(`Saved ${output.filePath}`) } else setMessage('Export cancelled.')
    } finally { setStage(null) }
  }
  async function exportPackage() {
    setStage(`Preparing ${settings.pageRefs.length} selected pages`)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      setStage('Rendering vectors and embedding assets')
      const result = exportFeaturePackage({ ...data!, approvedVersion: handoff!.approvedVersion, settings })
      setWarnings(result.warnings.map((item) => item.message))
      setStage(`Writing ${result.files.length} files`)
      const output = await window.frameui.export.savePackage(result.files, feature!.name)
      if (output.ok) { await record('feature', output.fileCount ?? result.files.length, output.directoryPath ?? null); setMessage(`Exported ${output.fileCount} files to ${output.directoryPath}`) } else setMessage(output.error ? `Export failed: ${output.error}` : 'Export cancelled.')
    } finally { setStage(null) }
  }

  return <div className="flex h-full min-h-0 flex-col bg-bg">
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-raised px-5"><div><span className="text-[13px] font-semibold text-text">Export Feature — {feature.name}</span><span className="ml-2 rounded bg-panel px-2 py-0.5 text-[12px] font-semibold text-success">SVG V1 available</span></div><button type="button" onClick={() => setView('feature-workspace')} className="text-[12px] text-text-2">Close</button></header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(440px,1fr)_320px] gap-5 overflow-hidden p-4">
      <section className="overflow-y-auto pr-2">
        <Group title="Pages">{handoff.pages.map((page) => <Check key={pageRefKey(page.ref)} checked={settings.pageRefs.some((item) => pageRefKey(item) === pageRefKey(page.ref))} label={page.name} meta={`${page.kind} · ${page.route ?? 'no route'}`} onChange={() => toggleRef(page.ref)} />)}</Group>
        <Group title="States">{handoff.pages.flatMap((page) => page.states.map((state) => <Check key={state.id} checked={settings.stateIds.includes(state.id)} label={`${page.name} / ${state.name}`} meta={state.origin} onChange={() => toggleList('stateIds', state.id)} />))}</Group>
        <Group title="Responsive views"><div className="grid grid-cols-3 gap-2">{(['desktop', 'tablet', 'mobile'] as Breakpoint[]).map((viewport) => <Check key={viewport} checked={settings.viewports.includes(viewport)} label={viewport} meta={viewport === 'desktop' ? '1440px' : viewport === 'tablet' ? '768px' : '390px'} onChange={() => toggleViewport(viewport)} />)}</div></Group>
        {data.conceptComponents.length > 0 && <Group title="Components">{data.conceptComponents.map((component) => <Check key={component.id} checked={settings.componentIds.includes(component.id)} label={component.name} meta="New concept component" onChange={() => toggleList('componentIds', component.id)} />)}</Group>}
        {data.journeys.length > 0 && <Group title="Journey boards">{data.journeys.map((journey) => <Check key={journey.id} checked={settings.journeyIds.includes(journey.id)} label={journey.name} meta={`${journey.steps.length} steps · ${journey.connections.length} interactions`} onChange={() => toggleList('journeyIds', journey.id)} />)}</Group>}
      </section>
      <aside className="overflow-y-auto rounded-xl border border-border bg-panel p-4">
        <h2 className="text-[13px] font-semibold text-text">Export settings</h2>
        <Option label="Include annotations" checked={settings.includeAnnotations} onChange={(value) => setSettings({ ...settings, includeAnnotations: value })} />
        <Option label="Include FrameUI metadata" checked={settings.includeMetadata} onChange={(value) => setSettings({ ...settings, includeMetadata: value })} />
        <Option label="Embed portable images" checked={settings.embedImages} onChange={(value) => setSettings({ ...settings, embedImages: value })} />
        <label className="mt-3 block text-[12px] font-semibold text-text-3">Journey layout<select value={settings.journeyLayout} onChange={(event) => setSettings({ ...settings, journeyLayout: event.target.value as 'horizontal' | 'vertical' })} className="mt-1 w-full rounded border border-border bg-panel-2 p-2 text-[12px] text-text"><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>
        <div className="mt-4 rounded-lg border border-border bg-panel-2 p-3"><div className="text-[12px] font-semibold text-text">Figma V2 · Planned</div><p className="mt-1 text-[12px] leading-relaxed text-text-3">Direct components, variables, Auto Layout and prototype connections. No authentication or placeholder action is enabled.</p></div>
        <button type="button" disabled={!!stage} onClick={() => void exportOne()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-panel-2 py-2 text-[12px] font-semibold text-text-2 disabled:opacity-50"><Download size={13}/> Export first selection</button>
        <button type="button" disabled={!!stage} onClick={() => void exportPackage()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-[12px] font-semibold text-on-accent disabled:opacity-50"><FileArchive size={13}/> Export Feature package</button>
        {stage && <div className="mt-3 flex items-center gap-2 text-[12px] text-accent-2"><Layers3 size={12} className="animate-pulse"/>{stage}</div>}
        {message && <p className="mt-3 break-words text-[12px] leading-relaxed text-text-2">{message}</p>}
        {warnings.length > 0 && <div className="mt-3 rounded-lg border border-warning/30 bg-panel p-2.5 text-[12px] text-warning">{warnings.map((warning) => <div key={warning}>• {warning}</div>)}</div>}
        {history.length > 0 && <div className="mt-5"><div className="text-[12px] font-semibold tracking-wide text-text-3">Export history</div>{history.slice(0, 5).map((item) => <div key={item.id} className="mt-2 border-t border-border pt-2 text-[12px] text-text-2"><div>{item.versionName} · {item.fileCount} files</div><div className="text-text-3">{new Date(item.createdAt).toLocaleString()}</div></div>)}</div>}
      </aside>
    </div>
  </div>
}

function Group({ title, children }: { title: string; children: React.ReactNode }) { return <div className="mb-5"><h2 className="mb-2 text-[12px] font-semibold tracking-wide text-text-3">{title}</h2><div className="space-y-1.5">{children}</div></div> }
function Check({ checked, label, meta, onChange }: { checked: boolean; label: string; meta: string; onChange: () => void }) { return <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-panel px-3 py-2.5"><input type="checkbox" checked={checked} onChange={onChange}/><span className="min-w-0 flex-1"><span className="block text-[12px] font-medium capitalize text-text">{label}</span><span className="block truncate text-[12px] text-text-3">{meta}</span></span></label> }
function Option({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="mt-3 flex items-center gap-2 text-[12px] text-text-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/>{label}</label> }
