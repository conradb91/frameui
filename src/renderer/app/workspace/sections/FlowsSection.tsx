import { useDesignFilesStore } from '../../../state/designFilesStore'
import { useState } from 'react'
import { ArrowRight, GitFork, Map, Plus, Route } from 'lucide-react'
import type { Interaction } from '@shared/types/model/projectModel'
import type { FlowSummary } from '@shared/types/flow'
import { useProjectStore } from '../../../state/projectStore'
import { useFlowStore } from '../../../state/flowStore'
import { useUiStore } from '../../../state/uiStore'
import { formatRelativeTime } from '../../../lib/formatRelativeTime'

export function FlowsSection({ flowSummaries }: { flowSummaries: FlowSummary[] }) {
  const designFiles = useDesignFilesStore((s) => s.files)
  const activeProject = useProjectStore((s) => s.activeProject)
  const model = useProjectStore((s) => s.activeIndex?.projectModel)
  const createFlow = useFlowStore((s) => s.createFlow)
  const openFlow = useFlowStore((s) => s.openFlow)
  const setView = useUiStore((s) => s.setView)
  const setSection = useUiStore((s) => s.setSection)
  const setSelectedScreenId = useUiStore((s) => s.setSelectedScreenId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const selectedConnection = model?.interactions.find((item) => item.id === selectedConnectionId) ?? model?.interactions[0] ?? null

  async function handleOpen(flowId: string) {
    if (!activeProject) return
    await openFlow(activeProject.id, flowId)
    setView('flow-workspace')
  }

  async function handleCreate() {
    if (!activeProject || !name.trim()) return
    const flow = await createFlow(activeProject.id, name.trim())
    setCreating(false)
    setName('')
    await openFlow(activeProject.id, flow.id)
    setView('flow-workspace')
  }

  function openScreen(pageId: string) {
    setSelectedScreenId(pageId)
    setSection('screens')
  }

  return <div className="flex min-h-0 flex-1">
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-bg-raised">
      <div className="flex h-10 items-center px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Journeys</div>
      <button type="button" className="mx-1.5 flex items-center gap-2 rounded-[4px] bg-blue-500/12 px-2 py-2 text-left"><Map size={14} className="text-blue-300" /><span className="min-w-0 flex-1"><span className="block text-[11.5px] font-medium text-text">Application Map</span><span className="mt-0.5 block font-mono text-[9px] text-text-3">{model?.statistics.pages ?? 0} screens · {model?.statistics.connections ?? 0} connections</span></span></button>
      {designFiles.filter((file) => file.flowPageIds && !file.archived).map((file) => <button key={file.id} onClick={() => { useDesignFilesStore.getState().selectFile(file.id); setSection('canvas') }} className="mx-2 mt-2 rounded border border-border p-3 text-left"><span className="block text-xs text-text">{file.name}</span><span className="mt-1 block text-[10px] text-text-3">{file.flowPageIds!.length} screens · Design flow</span></button>)}
      <div className="mt-5 flex items-center justify-between px-3"><span className="text-[9.5px] font-semibold uppercase tracking-wider text-text-3">Curated journeys</span><button type="button" title="Create journey" onClick={() => setCreating(true)} className="text-text-3 hover:text-text"><Plus size={13} /></button></div>
      {creating && <div className="m-2 flex gap-1"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleCreate(); if (event.key === 'Escape') setCreating(false) }} placeholder="Journey name" className="min-w-0 flex-1 rounded-[4px] border border-border bg-panel px-2 py-1.5 text-[10.5px] text-text outline-none focus:border-blue-400" /><button type="button" onClick={() => void handleCreate()} className="rounded-[4px] bg-blue-600 px-2 text-[10px] text-white">Create</button></div>}
      <div className="mt-1 overflow-y-auto px-1.5">{flowSummaries.map((flow) => <button key={flow.id} type="button" onClick={() => void handleOpen(flow.id)} className="block w-full rounded-[4px] px-2 py-2 text-left text-text-2 hover:bg-white/[0.04] hover:text-text"><span className="block text-[11px]">{flow.name}</span><span className="mt-0.5 block text-[9.5px] text-text-3">{flow.screenCount} screens · {formatRelativeTime(flow.updatedAt)}</span></button>)}{flowSummaries.length === 0 && <div className="px-2 py-3 text-[10px] leading-relaxed text-text-3">Create a focused UX journey from the detected application map.</div>}</div>
    </aside>

    <main className="min-w-0 flex-1 overflow-auto bg-[radial-gradient(rgb(255_255_255/0.04)_1px,transparent_1px)] bg-[length:22px_22px] p-6">
      <div className="mb-5 flex items-baseline gap-3"><h1 className="text-[16px] font-semibold text-text">Application Map</h1><span className="font-mono text-[10px] text-text-3">{model?.statistics.pages ?? 0} screens · {model?.statistics.connections ?? 0} connections · {model?.statistics.unresolvedRoutes ?? 0} unresolved</span></div>
      <div className="flex flex-wrap items-start gap-5">{model?.areas.map((area) => <section key={area.id} className="w-60 border border-border bg-panel shadow-lg"><div className="flex items-center justify-between border-b border-border bg-bg-raised px-3 py-2"><span className="text-[11.5px] font-semibold text-text">{area.name}</span><span className="font-mono text-[9px] text-text-3">{area.pageIds.length}</span></div><div className="p-1.5">{area.pageIds.map((pageId) => { const screen = model.pages.find((item) => item.id === pageId); const outgoing = model.interactions.filter((item) => item.sourcePageId === pageId); return screen ? <div key={screen.id} className="border-b border-border py-1.5 last:border-0"><button type="button" onClick={() => openScreen(screen.id)} className="flex w-full items-center justify-between gap-2 rounded-[3px] px-2 py-1 text-left hover:bg-blue-500/10"><span className="truncate text-[10.5px] text-text-2">{screen.name}</span><span className="font-mono text-[8.5px] text-text-3">{screen.route}</span></button>{outgoing.slice(0, 3).map((connection) => <button key={connection.id} type="button" onClick={() => setSelectedConnectionId(connection.id)} className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-1.5 px-2 py-0.5 text-left text-[8.5px] ${selectedConnection?.id === connection.id ? 'text-blue-300' : 'text-text-3 hover:text-text-2'}`}><ArrowRight size={9} /><span className="truncate">{connection.label}</span></button>)}</div> : null })}</div></section>)}</div>
      {!model && <div className="text-[11px] text-text-3">Building application relationships…</div>}
    </main>

    <ConnectionInspector connection={selectedConnection} screenName={selectedConnection ? model?.pages.find((page) => page.id === selectedConnection.sourcePageId)?.name : undefined} />
  </div>
}

function ConnectionInspector({ connection, screenName }: { connection: Interaction | null; screenName?: string }) {
  return <aside className="w-[280px] shrink-0 border-l border-border bg-bg-raised">{connection ? <><div className="border-b border-border p-3"><div className="flex items-center gap-2"><GitFork size={13} className="text-blue-300" /><span className="text-[12px] font-semibold text-text">Connection</span></div><div className="mt-1 truncate text-[10px] text-text-3">{connection.label}</div></div><div className="p-3"><ConnectionField label="Trigger" value={`${connection.trigger}: ${connection.label}`} /><ConnectionField label="Source" value={`${connection.source.filePath}:${connection.source.line ?? '—'}`} mono /><ConnectionField label="From" value={screenName ?? 'Unknown screen'} /><ConnectionField label="Destination" value={connection.destinationRoute} mono /><ConnectionField label="Status" value={connection.resolved ? 'Resolved' : 'Unresolved route'} warning={!connection.resolved} /></div></> : <div className="flex h-full items-center justify-center px-5 text-center"><div><Route size={18} className="mx-auto mb-2 text-text-3" /><div className="text-[10.5px] text-text-3">Select a detected connection to inspect its trigger and source.</div></div></div>}</aside>
}

function ConnectionField({ label, value, mono, warning }: { label: string; value: string; mono?: boolean; warning?: boolean }) { return <div className="border-b border-border py-2.5"><div className="mb-1 text-[9.5px] text-text-3">{label}</div><div className={`break-all text-[10.5px] ${warning ? 'text-amber-400' : 'text-text-2'} ${mono ? 'font-mono text-[9.5px]' : ''}`}>{value}</div></div> }
