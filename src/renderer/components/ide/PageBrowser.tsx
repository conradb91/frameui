import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Grid2X2, ImageOff, List, Plus, X } from 'lucide-react'
import type { VisualPage } from '@shared/types/visualDesign'
import { groupPages, viewportOf, type Viewport } from './pageLibrary'
import { formatRoute } from './displayFormat'
import { ModalEmptyState } from '../ui/Modal'
export function PageBrowser({ pages, projectId, search, onClearSearch, onAdd, compact = false, appUrl }: {
  pages: VisualPage[]; projectId: string; appUrl?: string; search?: string; onClearSearch?: () => void; onAdd: (page: VisualPage) => void; compact?: boolean
}) {
  const [error,setError] = useState('')
  const [query, setQuery] = useState('')
  const [viewport, setViewport] = useState<Viewport>(() => (sessionStorage.getItem(`frameui:viewport:${projectId}`) as Viewport) || 'All')
  const [route, setRoute] = useState('All Routes')
  const [list, setList] = useState(compact)
  const [sort, setSort] = useState('Name')
  const [limit, setLimit] = useState(40)
  const [preview, setPreview] = useState<VisualPage | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const usesExternalSearch = search !== undefined
  useEffect(() => { setLimit(40) }, [query, search, viewport, route, sort])
  const groups = useMemo(() => groupPages(pages), [pages])
  const text = (search ?? query).trim().toLowerCase()
  const filtered = useMemo(() => groups.filter(g =>
    (route === 'All Routes' || g.group === route) &&
    (!text || `${g.name} ${g.route} ${g.pages.map(p => p.state).join(' ')}`.toLowerCase().includes(text)) &&
    (viewport === 'All' || g.pages.some(p => viewportOf(p) === viewport))
  ).sort((a,b) => sort === 'Recent' ? Math.max(...b.pages.map(p => Date.parse(p.capturedAt || '') || 0)) - Math.max(...a.pages.map(p => Date.parse(p.capturedAt || '') || 0)) : a.name.localeCompare(b.name)), [groups, route, text, viewport, sort])
  const sections = [...new Set(filtered.slice(0, limit).map(g => text ? 'Search results' : g.group))]
  let originalUrl = ''
  try { if(preview?.route) {const url=new URL(preview.route,appUrl);if(![':', '*', '[', ']'].some(char=>url.pathname.includes(char)))originalUrl=url.href} } catch { /* unavailable route */ }
  const previewGroup = preview && groups.find(g => g.pages.some(p => p.id === preview.id))
  function add(page: VisualPage) {clearTimeout(timer.current);setPreview(null);onAdd(page)}
  function show(page: VisualPage) {
    setPreview(page)
    const key = `frameui:viewed:${projectId}`
    let ids: string[] = []
    try { ids = JSON.parse(sessionStorage.getItem(key) || '[]') } catch { /* empty history */ }
    sessionStorage.setItem(key, JSON.stringify([page.id, ...ids.filter(id => id !== page.id)].slice(0, 12)))
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element) || !event.target.closest('.ide-page-thumbnail')) return
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.ide-page-thumbnail'))
    const current = (event.target as Element).closest('.ide-page-card')?.querySelector<HTMLButtonElement>('.ide-page-thumbnail')
    const index = current ? items.indexOf(current) : -1
    if (!items.length) return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    items[(index + delta + items.length) % items.length]?.focus()
  }
  function resetFilters() {
    if (usesExternalSearch) onClearSearch?.()
    else setQuery('')
    setViewport('All')
    setRoute('All Routes')
  }
  return <div className={`ide-page-browser ${compact ? 'compact' : ''}`}>
    <div className="ide-browser-controls">
      {!usesExternalSearch && <input aria-label="Search pages, routes or states" placeholder="Search pages, routes or states…" value={query} onChange={e => setQuery(e.target.value)} />}
      <div className="ide-browser-filters">
        {compact ? <select aria-label="Device filter" value={viewport} onChange={e => { const value = e.target.value as Viewport; setViewport(value); sessionStorage.setItem(`frameui:viewport:${projectId}`, value) }}>
          <option value="All">All devices</option><option>Desktop</option><option>Tablet</option><option>Mobile</option>
        </select> : <div className="ide-asset-tabs">{(['All','Desktop','Tablet','Mobile'] as Viewport[]).map(v => <button key={v} aria-pressed={viewport === v} className={viewport === v ? 'active' : ''} onClick={() => { setViewport(v); sessionStorage.setItem(`frameui:viewport:${projectId}`,v) }}>{v}</button>)}</div>}
        <select aria-label="Route group" value={route} onChange={e => setRoute(e.target.value)}><option value="All Routes">All routes</option>{[...new Set(groups.map(g => g.group))].sort().map(g => <option key={g}>{g}</option>)}</select>
        <select aria-label="Sort pages" value={sort} onChange={e => setSort(e.target.value)}><option>Name</option><option>Recent</option></select>
        {!compact && <button onClick={() => setList(!list)} aria-label={list ? 'Switch to grid' : 'Switch to list'} title={list ? 'Grid view' : 'List view'}>{list ? <Grid2X2 size={14} /> : <List size={14} />}</button>}
      </div>
    </div>
    <p className="ide-browser-summary">{filtered.length} {filtered.length === 1 ? 'page' : 'pages'} · {pages.length} {pages.length === 1 ? 'variant' : 'variants'}</p>
    {sections.map(section => <details open key={section} className="ide-page-group"><summary>{section} <small>{filtered.filter(g => (text ? 'Search results' : g.group) === section).length}</small></summary>
      <div className={list ? 'ide-page-list' : 'ide-page-grid'} onKeyDown={navigate}>{filtered.slice(0, limit).filter(g => (text ? 'Search results' : g.group) === section).map(g => {
        const available = g.pages.filter(p => viewport === 'All' || viewportOf(p) === viewport)
        const page = available.find(p => p.id === choices[g.key]) || available.find(p => viewportOf(p) === 'Desktop') || available[0]
        return <article className="ide-page-card" key={g.key} draggable onDragStart={e => { clearTimeout(timer.current); e.dataTransfer.setData('application/frameui-asset', JSON.stringify({kind:'screen',id:page.id})); e.dataTransfer.effectAllowed='copy' }} onMouseEnter={() => { clearTimeout(timer.current); timer.current=setTimeout(() => show(page),350) }} onMouseLeave={() => {clearTimeout(timer.current);timer.current=setTimeout(()=>setPreview(null),400)}}>
          <button className="ide-page-thumbnail" onClick={() => show(page)} onDoubleClick={() => add(page)} aria-label={`Preview ${page.name}`}>{page.thumbnail ? <img src={page.thumbnail} alt={page.name} loading="lazy" /> : compact ? <ImageOff size={15} aria-hidden="true" /> : <span className="ide-preview-placeholder"><ImageOff size={24} strokeWidth={1.4}/><span>No preview yet</span></span>}</button>
          <div className="ide-page-card-copy"><strong>{g.name}</strong><small>{g.route ? formatRoute(g.route) : page.folder}</small><small>{viewportOf(page)} · {page.width} × {page.height}</small>
            {available.length > 1 && (compact
              ? <select className="ide-page-variant-select" aria-label={`Variant for ${g.name}`} value={page.id} onChange={event => setChoices({...choices,[g.key]:event.target.value})}>{available.map(p => <option key={p.id} value={p.id}>{p.state || viewportOf(p)}</option>)}</select>
              : <div className="ide-asset-tabs">{available.map(p => <button key={p.id} className={page.id === p.id ? 'active' : ''} onClick={() => setChoices({...choices,[g.key]:p.id})}>{p.state || viewportOf(p)}</button>)}</div>)}
          </div><button className="ide-page-add" aria-label={`Add ${page.name}`} title={compact ? 'Add to canvas' : 'Add to design file'} onClick={() => add(page)}><Plus size={16}/></button>
        </article>
      })}</div></details>)}
    {!filtered.length && (compact
      ? <div className="ide-sidebar-filter-empty"><strong>No matching pages</strong><span>Try another search, route, or device.</span><button onClick={resetFilters}>Reset filters</button></div>
      : <ModalEmptyState title="No matching pages" action={<button onClick={resetFilters}>Reset filters</button>}>Try another search, route, or device.</ModalEmptyState>)}
    {filtered.length > limit && <button onClick={() => setLimit(limit+40)}>Show 40 more</button>}
    {preview && <aside className="ide-asset-flyout ide-page-flyout" aria-label="Page preview" onMouseEnter={()=>clearTimeout(timer.current)} onKeyDown={e => {if(e.key==='Escape') setPreview(null)}}>
      <header><strong>{preview.name}</strong><button aria-label="Close page preview" onClick={() => setPreview(null)}><X size={16}/></button></header>
      <div className="ide-page-full-preview">{preview.thumbnail ? <img src={preview.thumbnail} alt={preview.name}/> : <p>Preview unavailable. Capture this page to generate one.</p>}</div>
      {preview.captureWarnings?.map(warning => <p key={warning} role="note">{warning}</p>)}
      <code>{preview.route ? formatRoute(preview.route) : preview.folder}</code><p>{preview.width} × {preview.height} · {preview.state}</p>
      <div className="ide-asset-tabs">{previewGroup?.pages.map(p => <button key={p.id} className={p.id===preview.id ? 'active' : ''} onClick={() => show(p)}>{p.state || viewportOf(p)}</button>)}</div>
      <small>Last captured: {preview.capturedAt ? new Date(preview.capturedAt).toLocaleString() : 'Unknown'}</small>
      <p>{previewGroup?.pages.length || 0} captured variants</p>
      <button onClick={() => {void window.frameui.preview.openExternal(originalUrl).then(r=>{if(!r.ok)setError('Could not open this page.')}).catch(()=>setError('Could not open this page.'))}} disabled={!originalUrl}>Open original page</button>
      {error && <p role="alert">{error}</p>}
      <button className="primary" onClick={() => add(preview)}>{compact ? 'Add to canvas' : 'Add to design file'}</button>
    </aside>}
  </div>
}
