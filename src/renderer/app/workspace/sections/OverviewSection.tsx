import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import type { IndexProgressStep } from '@shared/types/projectIndex'
import { useProjectStore } from '../../../state/projectStore'
import { useUiStore } from '../../../state/uiStore'

const PROGRESS_STEPS: { step: IndexProgressStep; label: string }[] = [
  { step: 'detecting', label: 'Framework detected' },
  { step: 'pages', label: 'Routes understood' },
  { step: 'components', label: 'Components indexing' },
  { step: 'tokens', label: 'Styles analysing' },
  { step: 'model', label: 'Building model' },
  { step: 'done', label: 'Ready' },
]

export function OverviewSection() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const indexing = useProjectStore((s) => s.indexing)
  const reindex = useProjectStore((s) => s.reindex)
  const setSection = useUiStore((s) => s.setSection)
  if (!activeProject) return null
  const model = activeIndex?.projectModel

  return <main className="min-w-0 flex-1 overflow-y-auto p-4">
    <div className="w-full">
      <div className="flex items-start justify-between border-b border-border pb-5"><div><h1 className="text-[13px] font-semibold text-text">{activeProject.name}</h1><div className="mt-1 flex items-center gap-2 text-[12px] text-text-3"><span>{frameworkLabel(activeIndex?.framework)}</span>{model?.tokenSource !== 'none' && <><span>·</span><span>{styleLabel(model?.tokenSource)}</span></>}<span>·</span><span className="font-mono">{activeProject.path}</span></div></div><button type="button" onClick={() => void reindex()} disabled={indexing} className="flex items-center gap-1.5 rounded-[5px] border border-border bg-panel px-2.5 py-1.5 text-[12px] text-text-2 hover:text-text disabled:opacity-50"><RefreshCw size={12} className={indexing ? 'animate-spin' : ''} />{indexing ? 'Analysing…' : 'Reanalyse'}</button></div>

      {!model ? <AnalysisProgress /> : <>
        <section className="mt-3"><div className="mb-3 text-[12px] font-semibold tracking-normal text-text-3">Product discovered</div><div className="grid max-w-3xl grid-cols-2 gap-x-6 border-t border-border">{[
          [model.statistics.pages, 'Screens'], [model.statistics.components, 'Components'], [model.statistics.tokens, 'Design tokens'], [model.statistics.layouts, 'Layouts'], [model.statistics.navigationGroups, 'Navigation groups'], [model.statistics.connections, 'Connections'], [model.statistics.issues, 'Needs review'], [model.statistics.renderIssues, 'Render issues'],
        ].map(([value, label]) => <button key={label} type="button" onClick={() => label === 'Needs review' || label === 'Render issues' ? setSection('review') : label === 'Screens' ? setSection('screens') : label === 'Components' ? setSection('components') : undefined} className="flex flex-row-reverse items-center justify-between border-b border-border px-2 py-2 text-left hover:bg-hover"><span className="block text-[13px] font-semibold text-text">{value}</span><span className="mt-0.5 block text-[12px] text-text-3">{label}</span></button>)}</div></section>

        <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-3">
          <section><div className="mb-2 flex items-center justify-between"><span className="text-[12px] font-semibold tracking-normal text-text-3">Application areas</span><button type="button" onClick={() => setSection('screens')} className="text-[12px] text-accent-2">Open screens</button></div><div className="border-t border-border">{model.areas.map((area) => <div key={area.id} className="grid grid-cols-[1fr_80px] border-b border-border py-2 text-[12px]"><span className="text-text-2">{area.name}</span><span className="text-right font-mono text-text-3">{area.pageIds.length} screens</span></div>)}</div></section>
          <section><div className="mb-2 text-[12px] font-semibold tracking-normal text-text-3">Analysis status</div><div className="border-t border-border"><StatusRow label="Project structure" value="Complete" ok /><StatusRow label="Routes" value={`${model.routes.length} found`} ok /><StatusRow label="Views" value={`${model.statistics.pages} found`} ok /><StatusRow label="Components" value={`${model.statistics.components} found`} ok /><StatusRow label="Relationships" value={`${model.statistics.connections} resolved`} ok={model.statistics.unresolvedRoutes === 0} /><StatusRow label="Review" value={model.statistics.issues ? `${model.statistics.issues} findings` : 'No findings'} ok={model.statistics.issues === 0} /></div></section>
        </div>
      </>}
    </div>
  </main>
}

function AnalysisProgress() {
  const indexProgress = useProjectStore((s) => s.indexProgress)
  const [appRunning, setAppRunning] = useState(false)

  useEffect(() => {
    void window.frameui.preview.getStatus().then(({ status }) => setAppRunning(status === 'running'))
    return window.frameui.preview.onStatus(({ status }) => setAppRunning(status === 'running'))
  }, [])

  // Steps are cumulative — the furthest recorded step in PROGRESS_STEPS
  // order implies everything before it is also done, even if this specific
  // renderer instance mounted after an earlier step's event already fired.
  const furthestIndex = indexProgress.reduce((max, step) => Math.max(max, PROGRESS_STEPS.findIndex((s) => s.step === step)), -1)

  return <div className="mt-3 max-w-md">
    <div className="mb-3 text-[12px] font-semibold text-text">Building project intelligence</div>
    <div className="flex items-center justify-between border-b border-border py-2 text-[12px]"><span className="text-text-2">Application running</span><span className={appRunning ? 'text-success' : 'text-text-3'}>{appRunning ? 'Running' : 'Not started'}</span></div>
    {PROGRESS_STEPS.map(({ step, label }, index) => <div key={step} className="flex items-center justify-between border-b border-border py-2 text-[12px]"><span className="text-text-2">{label}</span><span className={index <= furthestIndex ? 'text-success' : 'text-text-3'}>{index <= furthestIndex ? 'Complete' : 'Analysing…'}</span></div>)}
  </div>
}
function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) { return <div className="flex items-center justify-between border-b border-border py-2 last:border-0"><span className="flex items-center gap-2 text-[12px] text-text-2">{ok ? <CheckCircle2 size={11} className="text-success" /> : <AlertTriangle size={11} className="text-warning" />}{label}</span><span className="font-mono text-[12px] text-text-3">{value}</span></div> }
function frameworkLabel(value?: string): string { return value ? value === 'node' ? 'Node.js' : value.charAt(0).toUpperCase() + value.slice(1) : 'Analysing stack' }
function styleLabel(value?: string): string { return value?.startsWith('tailwind') ? 'Tailwind CSS' : value === 'css-custom-properties' ? 'CSS variables' : value === 'stylesheets' ? 'Project styles' : '' }
