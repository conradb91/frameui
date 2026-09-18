import { useMemo, useRef, useState } from 'react'
import { Search, ArrowUpRight, MoreHorizontal, CheckCircle2, AlertTriangle, Lock, FileQuestion, RefreshCcw, X } from 'lucide-react'
import type { PageRegistryEntry, VisualDocument, VisualPage } from '@shared/types/visualDesign'
import type { IdeAction } from './Ui'
import { ActionMenu, HighlightMatch } from './Ui'
import { viewportOf, type Viewport } from './pageLibrary'
import { formatRoute, groupByArea, humanizeName, pageStatus, type PageStatus } from './displayFormat'

const statusIcon: Record<PageStatus, typeof CheckCircle2> = {
  Ready: CheckCircle2,
  Updated: RefreshCcw,
  Partial: AlertTriangle,
  Failed: AlertTriangle,
  'Needs login': Lock,
  'Not captured': FileQuestion,
}

type Entry = {
  registry: PageRegistryEntry
  matches: VisualPage[]
  best?: VisualPage
  status: PageStatus
}

/**
 * A page here is view-only, never a shortcut into the editable canvas —
 * that only ever happens through a deliberate "Create design" action
 * (mirroring PageBrowser's own Add-to-design flow). Clicking a captured
 * page pins its existing hover-preview flyout open; clicking an uncaptured
 * one goes straight to Connect-app, since there's nothing to view yet.
 */
export function PageExplorer({ document, archivedPages, onImport, onCreateDesign, onReveal, onArchive, onDuplicate }: {
  document: VisualDocument
  archivedPages: string[]
  onImport: (route?: string) => void
  onCreateDesign: (page: VisualPage) => void
  onReveal: (sourceFile: string) => void
  onArchive: (pattern: string) => void
  onDuplicate: (pattern: string) => Promise<boolean>
}) {
  const [query, setQuery] = useState('')
  const [viewport, setViewport] = useState<Viewport>('All')
  const [menu, setMenu] = useState<{ x: number; y: number; pattern: string } | null>(null)
  const [preview, setPreview] = useState<Entry | null>(null)
  const [pinned, setPinned] = useState(false)
  const [notice, setNotice] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>()

  const entries = useMemo<Entry[]>(() => (document.pageRegistry ?? [])
    .filter(entry => !archivedPages.includes(entry.pattern))
    .map(registry => {
      const matches = document.pages.filter(p => p.route === registry.pattern)
      const best = matches.find(p => viewportOf(p) === 'Desktop') ?? matches[0]
      return { registry, matches, best, status: pageStatus(registry, matches) }
    }), [document.pageRegistry, document.pages, archivedPages])

  const filtered = entries.filter(e =>
    (viewport === 'All' || !e.matches.length || e.matches.some(p => viewportOf(p) === viewport)) &&
    (!query || `${humanizeName(e.registry.name, e.registry.area)} ${e.registry.pattern} ${e.registry.area}`.toLowerCase().includes(query.toLowerCase())),
  )
  const groups = groupByArea(filtered, e => e.registry.area)

  function view(entry: Entry) {
    if (entry.best) { setPreview(entry); setPinned(true) }
    else onImport(entry.registry.pattern)
  }
  function closePreview() { setPreview(null); setPinned(false) }
  function runAction(id: string, entry: Entry) {
    if (id === 'reveal') onReveal(entry.registry.source ?? '')
    if (id === 'archive') onArchive(entry.registry.pattern)
    if (id === 'duplicate') void onDuplicate(entry.registry.pattern).then(ok => { setNotice(ok ? 'Design file duplicated.' : 'Open this page as a design first — nothing to duplicate yet.'); clearTimeout(timer.current); timer.current = setTimeout(() => setNotice(''), 4000) })
  }

  const menuEntry = menu && filtered.find(e => e.registry.pattern === menu.pattern)
  const menuActions: IdeAction[] = menuEntry ? [
    { id: 'view', label: 'View', disabled: !menuEntry.best, run: () => view(menuEntry) },
    { id: 'capture', label: menuEntry.best ? 'Capture again' : 'Capture this page', run: () => onImport(menuEntry.registry.pattern) },
    { id: 'create-design', label: 'Create design', disabled: !menuEntry.best, run: () => menuEntry.best && onCreateDesign(menuEntry.best) },
    { id: 'reveal', label: 'Reveal source', disabled: !menuEntry.registry.source, run: () => runAction('reveal', menuEntry) },
    { id: 'duplicate', label: 'Duplicate design', run: () => runAction('duplicate', menuEntry) },
    { id: 'archive', label: 'Archive', run: () => runAction('archive', menuEntry) },
  ] : []

  return <div className="ide-page-explorer">
    <div className="ide-explorer-search">
      <Search size={13} />
      <input aria-label="Search pages" placeholder="Search pages…" value={query} onChange={e => setQuery(e.target.value)} />
    </div>
    <div className="ide-asset-tabs ide-explorer-viewports">
      {(['All', 'Desktop', 'Tablet', 'Mobile'] as Viewport[]).map(v => <button key={v} aria-pressed={viewport === v} className={viewport === v ? 'active' : ''} onClick={() => setViewport(v)}>{v}</button>)}
    </div>
    {notice && <p className="ide-status-pill" role="status">{notice}</p>}
    <div className="ide-explorer-tree">
      {groups.map(group => <details open key={group.area} className="ide-explorer-group">
        <summary>{group.area} <small>{group.items.length}</small></summary>
        {group.items.map(entry => {
          const Icon = statusIcon[entry.status]
          const name = humanizeName(entry.registry.name, entry.registry.area)
          return <div
            className="ide-explorer-row" key={entry.registry.pattern} role="button" tabIndex={0}
            onClick={() => view(entry)}
            onKeyDown={e => { if (e.key === 'Enter') view(entry) }}
            onMouseEnter={() => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => { if (!pinned) setPreview(entry) }, 350) }}
            onMouseLeave={() => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => { if (!pinned) setPreview(p => (p === entry ? null : p)) }, 400) }}
          >
            <div className="ide-explorer-thumb" title={entry.best?.thumbnail ? undefined : 'Not captured'}>{entry.best?.thumbnail ? <img src={entry.best.thumbnail} alt="" loading="lazy" /> : <FileQuestion size={13} />}</div>
            <div className="ide-explorer-meta">
              <strong><HighlightMatch text={name} query={query} /></strong>
              <small><HighlightMatch text={formatRoute(entry.registry.pattern)} query={query} /></small>
            </div>
            <span className={`ide-status ide-status-${entry.status.replace(/\s+/g, '-').toLowerCase()}`} title={entry.status}><Icon size={13} /></span>
            <div className="ide-explorer-row-actions">
              <button aria-label={entry.best ? `View ${name}` : `Capture ${name}`} title={entry.best ? 'View' : 'Capture this page'} onClick={e => { e.stopPropagation(); view(entry) }}><ArrowUpRight size={14} /></button>
              <button aria-label={`More actions for ${name}`} title="More" onClick={e => { e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, pattern: entry.registry.pattern }) }}><MoreHorizontal size={14} /></button>
            </div>
          </div>
        })}
      </details>)}
      {!filtered.length && <p>No matching pages.</p>}
    </div>
    {menu && menuActions.length > 0 && <ActionMenu actions={menuActions} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    {preview && <aside className="ide-asset-flyout ide-page-flyout" aria-label="Page preview" onMouseEnter={() => clearTimeout(hoverTimer.current)} onMouseLeave={() => { if (!pinned) setPreview(null) }}>
      <header>
        <strong>{humanizeName(preview.registry.name, preview.registry.area)}</strong>
        <button aria-label="Close page preview" onClick={closePreview}><X size={16} /></button>
      </header>
      <div className="ide-page-full-preview">{preview.best?.thumbnail ? <img src={preview.best.thumbnail} alt="" /> : <p>Not captured yet.</p>}</div>
      <code>{formatRoute(preview.registry.pattern)}</code>
      <p>{preview.best ? `${viewportOf(preview.best)} · ${preview.status}` : preview.status}</p>
      {preview.matches.length > 1 && <p>{preview.matches.length} states</p>}
      <div className="ide-page-flyout-actions">
        <button onClick={() => onImport(preview.registry.pattern)}>{preview.best ? 'Capture again' : 'Capture this page'}</button>
        <button className="primary" disabled={!preview.best} onClick={() => preview.best && onCreateDesign(preview.best)}>Create design from this page</button>
      </div>
    </aside>}
  </div>
}
