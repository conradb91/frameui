import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CornerUpLeft, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Annotation, PageRef } from '@shared/types/model/featureModel'
import type { Breakpoint, DesignNode } from '@shared/types/designNode'
import { findNode } from '@core/design-model/tree'

interface Props {
  projectId: string
  featureId: string
  pageRef: PageRef | null
  designStateId: string | null
  alternativeId: string | null
  breakpoint: Breakpoint
  selectedNode: DesignNode | null
  tree: DesignNode | null
  onJump: (item: Annotation) => void
}

export function FeatureReviewPanel(props: Props) {
  const [items, setItems] = useState<Annotation[]>([])
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open')
  const [context, setContext] = useState<'all' | 'current' | 'proposed'>('all')
  const [viewport, setViewport] = useState<'all' | Breakpoint>('all')
  const [pageFilter, setPageFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [comment, setComment] = useState('')
  const [priority, setPriority] = useState<Annotation['priority']>('normal')
  const [newContext, setNewContext] = useState<Annotation['context']>('proposed')

  async function load() {
    const loaded = await window.frameui.workspace.listAnnotations(props.projectId, props.featureId)
    // Resolve the canonical node link for the currently open design. A
    // missing node is flagged, never discarded or dereferenced blindly.
    const checked = loaded.map((item) => item.designStateId === props.designStateId && item.elementId && props.tree
      ? { ...item, needsAttention: !findNode(props.tree, item.elementId) }
      : item)
    setItems(checked)
    await Promise.all(checked.filter((item, index) => item.needsAttention !== loaded[index].needsAttention).map((item) => window.frameui.workspace.saveAnnotation(props.projectId, item)))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [props.projectId, props.featureId, props.designStateId, props.tree])

  const visible = useMemo(() => items.filter((item) => {
    if (tab === 'open' && item.status === 'resolved') return false
    if (tab === 'resolved' && item.status !== 'resolved') return false
    if (context !== 'all' && item.context !== context) return false
    if (pageFilter !== 'all' && item.pageRef.pageId !== pageFilter) return false
    if (stateFilter !== 'all' && item.designStateId !== stateFilter) return false
    return viewport === 'all' || item.viewport === viewport
  }), [items, tab, context, viewport, pageFilter, stateFilter])
  const pages = [...new Set(items.map((item) => item.pageRef.pageId))]
  const states = [...new Set(items.flatMap((item) => item.designStateId ? [item.designStateId] : []))]

  useEffect(() => {
    document.querySelectorAll<HTMLElement>('[data-review-count]').forEach((element) => element.removeAttribute('data-review-count'))
    const counts = new Map<string, number>()
    for (const item of visible) if (item.elementId && item.status !== 'resolved') counts.set(item.elementId, (counts.get(item.elementId) ?? 0) + 1)
    for (const [nodeId, count] of counts) {
      const element = document.querySelector<HTMLElement>(`[data-frameui-node-id="${CSS.escape(nodeId)}"]`)
      if (element) element.dataset.reviewCount = String(count)
    }
    return () => document.querySelectorAll<HTMLElement>('[data-review-count]').forEach((element) => element.removeAttribute('data-review-count'))
  }, [visible, props.tree])

  async function create() {
    if (!props.pageRef || !props.designStateId || !comment.trim()) return
    const now = new Date().toISOString()
    const node = props.selectedNode
    const sourceReference = node?.kind === 'placeholder' ? node.sourceReference ?? null : null
    const saved = await window.frameui.workspace.saveAnnotation(props.projectId, {
      id: crypto.randomUUID(), featureId: props.featureId, pageRef: props.pageRef,
      designStateId: props.designStateId, alternativeId: props.alternativeId, viewport: props.breakpoint,
      context: newContext, elementId: newContext === 'proposed' ? node?.id ?? null : null,
      elementLabel: node ? ('label' in node ? node.label : 'content' in node ? node.content : node.kind) : null,
      componentId: newContext === 'proposed' && node?.kind === 'concept' ? node.conceptComponentId : null,
      versionId: null, screenshotAssetId: null, sourceReference: newContext === 'proposed' ? sourceReference : null, comment: comment.trim(), status: 'open', priority,
      needsAttention: false, createdAt: now, updatedAt: now, createdBy: 'Local designer',
    })
    setItems((current) => [saved, ...current])
    setComment('')
  }

  async function setStatus(item: Annotation, status: Annotation['status']) {
    const saved = await window.frameui.workspace.saveAnnotation(props.projectId, { ...item, status })
    setItems((current) => current.map((value) => value.id === saved.id ? saved : value))
  }

  async function remove(item: Annotation) {
    if (!window.confirm(`Delete review item “${item.comment}”? This cannot be undone.`)) return
    await window.frameui.workspace.deleteAnnotation(props.projectId, props.featureId, item.id)
    setItems((current) => current.filter((value) => value.id !== item.id))
  }

  async function edit(item: Annotation) {
    const comment = window.prompt('Edit review comment', item.comment)?.trim()
    if (!comment || comment === item.comment) return
    const saved = await window.frameui.workspace.saveAnnotation(props.projectId, { ...item, comment })
    setItems((current) => current.map((value) => value.id === saved.id ? saved : value))
  }

  return <div className="flex h-full flex-col">
    <div className="border-b border-border p-2.5">
      <div className="mb-2 flex gap-1">{(['open', 'resolved', 'all'] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={`rounded px-2 py-1 text-[10px] font-semibold capitalize ${tab === value ? 'bg-accent/20 text-accent-2' : 'text-text-3'}`}>{value}</button>)}</div>
      <div className="mb-2 flex gap-1">
        <select value={viewport} onChange={(e) => setViewport(e.target.value as typeof viewport)} className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-1 py-1 text-[10px] text-text"><option value="all">All viewports</option><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></select>
        <select value={context} onChange={(e) => setContext(e.target.value as typeof context)} className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-1 py-1 text-[10px] text-text"><option value="all">Current + Proposed</option><option value="current">Current</option><option value="proposed">Proposed</option></select>
      </div>
      <div className="mb-2 flex gap-1"><select value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-1 py-1 text-[10px] text-text"><option value="all">All pages</option>{pages.map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-1 py-1 text-[10px] text-text"><option value="all">All states</option>{states.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder={props.selectedNode ? `Annotate selected ${props.selectedNode.kind}…` : 'Annotate this page…'} className="w-full resize-none rounded border border-border bg-panel-2 p-2 text-[11px] text-text outline-none" />
      <div className="mt-1.5 flex gap-1.5"><select value={newContext} onChange={(e) => setNewContext(e.target.value as Annotation['context'])} className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-1 text-[10px] text-text"><option value="proposed">Proposed</option><option value="current">Current page</option></select><select value={priority} onChange={(e) => setPriority(e.target.value as Annotation['priority'])} className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-1 text-[10px] text-text"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select><button disabled={!comment.trim() || !props.pageRef} onClick={() => void create()} className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40"><Plus size={11}/>Add</button></div>
    </div>
    <div className="flex-1 overflow-y-auto p-2">{visible.map((item) => <div key={item.id} className="mb-2 rounded-md border border-border bg-panel-2 p-2">
      <button onClick={() => props.onJump(item)} className="w-full text-left"><div className="flex items-center gap-1 text-[9px] uppercase text-text-3">{item.needsAttention ? <AlertTriangle size={10} className="text-warning"/> : <MapPin size={10} className="text-accent-2"/>}{item.viewport} · {item.priority} · {item.status}</div><div className="mt-1 text-[11px] leading-relaxed text-text">{item.comment}</div><div className="mt-1 truncate font-mono text-[9px] text-text-3">{item.elementLabel ?? item.pageRef.pageId}</div></button>
      <div className="mt-2 flex gap-2">{item.status === 'resolved' ? <button onClick={() => void setStatus(item, 'reopened')} className="flex items-center gap-1 text-[9px] text-text-3"><CornerUpLeft size={10}/>Reopen</button> : <button onClick={() => void setStatus(item, 'resolved')} className="flex items-center gap-1 text-[9px] text-emerald-300"><Check size={10}/>Resolve</button>}<button onClick={() => void edit(item)} className="ml-auto text-text-3 hover:text-text"><Pencil size={10}/></button><button onClick={() => void remove(item)} className="text-text-3 hover:text-danger"><Trash2 size={10}/></button></div>
    </div>)}{visible.length === 0 && <div className="p-3 text-center text-[10.5px] text-text-3">No review items in this view.</div>}</div>
  </div>
}
