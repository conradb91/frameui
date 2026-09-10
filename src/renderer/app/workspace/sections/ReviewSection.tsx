import { useMemo, useState } from 'react'
import { AlertTriangle, CircleCheck, FileWarning, Link2Off } from 'lucide-react'
import type { Diagnostic } from '@shared/types/model/projectModel'
import { useProjectStore } from '../../../state/projectStore'
import { useUiStore } from '../../../state/uiStore'

type IssueFilter = 'all' | Diagnostic['kind']
const EMPTY_ISSUES: Diagnostic[] = []

export function ReviewSection() {
  const model = useProjectStore((s) => s.activeIndex?.projectModel)
  const setSection = useUiStore((s) => s.setSection)
  const setSelectedScreenId = useUiStore((s) => s.setSelectedScreenId)
  const [filter, setFilter] = useState<IssueFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const issues = model?.diagnostics ?? EMPTY_ISSUES
  const filtered = useMemo(() => filter === 'all' ? issues : issues.filter((issue) => issue.kind === filter), [filter, issues])
  const selected = issues.find((issue) => issue.id === selectedId) ?? filtered[0] ?? null

  function openScreen(issue: Diagnostic) {
    setSelectedScreenId(issue.pageId)
    setSection('screens')
  }

  const filters: { id: IssueFilter; label: string; count: number; icon: typeof AlertTriangle }[] = [
    { id: 'all', label: 'All findings', count: issues.length, icon: AlertTriangle },
    { id: 'unresolved-navigation', label: 'Navigation', count: issues.filter((issue) => issue.kind === 'unresolved-navigation').length, icon: Link2Off },
    { id: 'empty-page', label: 'Empty structures', count: issues.filter((issue) => issue.kind === 'empty-page').length, icon: FileWarning },
    { id: 'unreadable-page', label: 'Read errors', count: issues.filter((issue) => issue.kind === 'unreadable-page').length, icon: FileWarning },
  ]

  return <div className="flex min-h-0 flex-1">
    <aside className="w-[240px] shrink-0 border-r border-border bg-bg-raised p-2"><div className="px-2 pb-3 pt-1 text-[12px] font-semibold tracking-normal text-text-3">Review</div>{filters.map(({ id, label, count, icon: Icon }) => <button key={id} type="button" onClick={() => setFilter(id)} className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12px] ${filter === id ? 'bg-selected text-text' : 'text-text-2 hover:bg-hover'}`}><Icon size={13} /><span className="flex-1 text-left">{label}</span><span className="font-mono text-[12px] text-text-3">{count}</span></button>)}</aside>
    <main className="min-w-0 flex-1 overflow-y-auto">{issues.length === 0 ? <div className="flex h-full items-center justify-center"><div className="text-center"><CircleCheck size={22} className="mx-auto mb-3 text-success" /><div className="text-[12.5px] font-semibold text-text">No structural issues found</div><div className="mt-1 text-[12px] text-text-3">All detected screens produced a readable structure and navigation targets resolved.</div></div></div> : <div><div className="grid grid-cols-[110px_1fr_1fr_80px] border-b border-border bg-bg-raised px-4 py-2 text-[12px] font-semibold tracking-wide text-text-3"><span>Severity</span><span>Finding</span><span>Source</span><span className="text-right">Line</span></div>{filtered.map((issue) => <button key={issue.id} type="button" onClick={() => setSelectedId(issue.id)} className={`grid w-full grid-cols-[110px_1fr_1fr_80px] border-b border-border px-4 py-2.5 text-left hover:bg-hover ${selected?.id === issue.id ? 'bg-selected' : ''}`}><span className={`text-[12px] capitalize ${issue.severity === 'error' ? 'text-danger' : 'text-warning'}`}>{issue.severity}</span><span className="truncate text-[12px] text-text">{issue.title}</span><span className="truncate font-mono text-[12px] text-text-3">{issue.source.filePath}</span><span className="text-right font-mono text-[12px] text-text-3">{issue.source.line ?? '—'}</span></button>)}</div>}</main>
    <aside className="w-[280px] shrink-0 border-l border-border bg-bg-raised">{selected ? <><div className="border-b border-border p-3"><div className="text-[12px] font-semibold text-text">{selected.title}</div><div className="mt-1 text-[12px] capitalize text-warning">{selected.severity} · {selected.kind.replace(/-/g, ' ')}</div></div><div className="p-3"><div className="text-[12px] leading-relaxed text-text-2">{selected.detail}</div><div className="mt-4 border-t border-border pt-3"><div className="text-[12px] text-text-3">Source</div><div className="mt-1 break-all font-mono text-[12px] text-text-2">{selected.source.filePath}{selected.source.line ? `:${selected.source.line}` : ''}</div></div><button type="button" onClick={() => openScreen(selected)} className="mt-4 w-full rounded-[5px] bg-accent px-3 py-2 text-[12px] font-semibold text-on-accent">Show affected screen</button></div></> : <div className="p-3 text-[12px] text-text-3">Select a finding to inspect it.</div>}</aside>
  </div>
}
