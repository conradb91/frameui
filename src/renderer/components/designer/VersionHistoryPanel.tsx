import { useEffect, useState } from 'react'
import { Copy, GitCompare, History, Pencil, Plus, RotateCcw } from 'lucide-react'
import type { Version, VersionDifference } from '@shared/types/model/featureModel'
import { useDesignStore } from '../../state/designStore'

export function VersionHistoryPanel({ projectId, featureId }: { projectId: string; featureId: string }) {
  const [versions, setVersions] = useState<Version[]>([])
  const [name, setName] = useState('')
  const [left, setLeft] = useState<string | null>(null)
  const [right, setRight] = useState<string | null>(null)
  const [differences, setDifferences] = useState<VersionDifference[]>([])
  const stateId = useDesignStore((s) => s.designStateId)
  const alternativeId = useDesignStore((s) => s.alternativeId)
  const operations = useDesignStore((s) => s.operations)

  async function load() { setVersions(await window.frameui.workspace.listVersions(projectId, featureId)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [projectId, featureId])

  async function create() {
    if (!name.trim()) return
    if (stateId) await window.frameui.workspace.saveDesignOperations(projectId, featureId, alternativeId ?? stateId, operations)
    await window.frameui.workspace.createVersion(projectId, featureId, name.trim(), 'Local designer')
    setName(''); await load()
  }
  async function compare() { setDifferences(await window.frameui.workspace.compareVersions(projectId, featureId, left, right)) }
  async function restore(version: Version) {
    if (!window.confirm(`Restore “${version.name}” as a new working state? Newer history will be preserved.`)) return
    await window.frameui.workspace.restoreVersion(projectId, featureId, version.id, 'Local designer')
    if (stateId) await useDesignStore.getState().loadDesignState(projectId, stateId, alternativeId)
    await load()
  }
  async function duplicate(version: Version) {
    await window.frameui.workspace.duplicateVersion(projectId, featureId, version.id, 'Local designer')
    if (stateId) await useDesignStore.getState().loadDesignState(projectId, stateId, alternativeId)
    await load()
  }
  async function rename(version: Version) {
    const next = window.prompt('Rename version', version.name)?.trim()
    if (!next || next === version.name) return
    await window.frameui.workspace.renameVersion(projectId, featureId, version.id, next)
    await load()
  }

  return <div className="mx-auto max-w-3xl p-6">
    <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text"><History size={16}/>Version History</h2>
    <div className="mt-4 flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create() }} placeholder="Named milestone, e.g. Review Round 1" className="h-8 flex-1 rounded border border-border bg-panel px-2.5 text-[11px] text-text outline-none"/><button onClick={() => void create()} disabled={!name.trim()} className="flex items-center gap-1 rounded bg-accent px-3 text-[11px] font-semibold text-white disabled:opacity-40"><Plus size={12}/>Save version</button></div>
    <div className="mt-5 rounded-lg border border-border bg-panel-2 p-3"><div className="mb-2 text-[10px] font-semibold uppercase text-text-3">Compare meaningful intent</div><div className="flex gap-2"><select value={left ?? ''} onChange={(e) => setLeft(e.target.value || null)} className="flex-1 rounded border border-border bg-panel px-2 text-[10px] text-text"><option value="">Current working state</option>{versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select><select value={right ?? ''} onChange={(e) => setRight(e.target.value || null)} className="flex-1 rounded border border-border bg-panel px-2 text-[10px] text-text"><option value="">Current working state</option>{versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select><button onClick={() => void compare()} className="rounded border border-border px-2 text-text-2"><GitCompare size={13}/></button></div>{differences.map((diff) => <div key={`${diff.operationId}-${diff.kind}`} className="mt-2 flex gap-2 text-[10.5px]"><span className={diff.kind === 'added' ? 'text-emerald-300' : diff.kind === 'removed' ? 'text-danger' : 'text-warning'}>{diff.kind}</span><span className="text-text-2">{diff.summary}</span></div>)}{differences.length === 0 && <div className="mt-2 text-[10px] text-text-3">No compared differences.</div>}</div>
    <div className="mt-5 space-y-2">{versions.map((version) => <div key={version.id} className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2.5"><button onClick={() => { setLeft(version.id); setRight(null); void window.frameui.workspace.compareVersions(projectId, featureId, version.id, null).then(setDifferences) }} className="text-left"><div className="text-[12px] font-semibold text-text">{version.name}</div><div className="mt-0.5 text-[9.5px] text-text-3">{new Date(version.createdAt).toLocaleString()} · {version.createdBy}{version.restoredFromVersionId ? ' · derived milestone' : ''}</div></button><div className="flex gap-1"><button title="Rename" onClick={() => void rename(version)} className="rounded border border-border p-1.5 text-text-3"><Pencil size={10}/></button><button title="Duplicate into working state" onClick={() => void duplicate(version)} className="rounded border border-border p-1.5 text-text-3"><Copy size={10}/></button><button onClick={() => void restore(version)} className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-2"><RotateCcw size={10}/>Restore</button></div></div>)}</div>
  </div>
}
