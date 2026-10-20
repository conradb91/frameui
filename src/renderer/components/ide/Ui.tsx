import './project-home.css'
import { useStoredValue } from './preferences'
import type { ProjectLibraryEntry } from '@shared/types/project'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Search,
  X,
  ChevronRight,
  Info,
  Moon,
  Sun,
  Monitor,
  FolderOpen,
  FilePlus2,
  Copy,
  Trash2,
  Archive,
  ArrowRight,
  PanelsTopLeft,
  Pipette,
  LayoutGrid,
  List,
  Clock3,
  Code2,
  HardDrive,
  BookOpen,
  Plus,
} from 'lucide-react'
import type { VisualDocument, DesignVariable } from '@shared/types/visualDesign'
import {
  applyAppearance,
  usePreferencesStore,
} from '../../state/preferencesStore'
import { ModalShell } from '../ui/Modal'

export type IdeAction = {
  id: string
  label: string
  category?: string
  shortcut?: string
  run: () => void
  disabled?: boolean
  danger?: boolean
}
export function ThemeControl() {
  const appearance = usePreferencesStore((s) => s.appearance),
    setAppearance = usePreferencesStore((s) => s.setAppearance)
  useEffect(() => {
    applyAppearance(appearance)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyAppearance(appearance)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [appearance])
  return (
    <div className="ide-theme-control" aria-label="Appearance">
      {(
        [
          { value: 'system', Icon: Monitor },
          { value: 'light', Icon: Sun },
          { value: 'dark', Icon: Moon },
        ] as const
      ).map(({ value, Icon }) => (
        <button
          key={value}
          className={appearance === value ? 'active' : ''}
          aria-label={`${value} appearance`}
          title={`${value} appearance`}
          onClick={() => setAppearance(value)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}
export function TooltipLayer() {
  const [tip, setTip] = useState<{
    label: string
    x: number
    y: number
  } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const hide = () => {
      clearTimeout(timer)
      setTip(null)
    }
    const over = (e: PointerEvent) => {
      hide()
      const target = (e.target as Element).closest(
        '[data-tip],[title]',
      ) as HTMLElement | null
      if (!target) return
      const label = target.dataset.tip || target.title
      if (!label) return
      if (target.title) {
        if (!target.getAttribute('aria-label'))
          target.setAttribute('aria-label', label)
        target.dataset.tip = target.title
        target.removeAttribute('title')
      }
      const rect = target.getBoundingClientRect()
      timer = setTimeout(
        () =>
          setTip({
            label,
            x: Math.max(
              10,
              Math.min(innerWidth - 240, rect.left + rect.width / 2 - 80),
            ),
            y:
              rect.bottom + 8 > innerHeight - 55
                ? rect.top - 40
                : rect.bottom + 8,
          }),
        500,
      )
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', hide)
    document.addEventListener('pointerdown', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', hide)
      document.removeEventListener('pointerdown', hide)
    }
  }, [])
  return tip ? (
    <div
      className="ide-tooltip"
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.label}
    </div>
  ) : null
}
export function InlineName({
  value,
  onChange,
  label,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  label: string
  className?: string
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value)
  if (!editing)
    return (
      <span
        className={`ide-inline-name ${className}`}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(value)
          setEditing(true)
        }}
        title={`${value} · Double-click to rename`}
      >
        {value}
      </span>
    )
  const finish = () => {
    if (draft.trim() && draft !== value) onChange(draft.trim())
    setEditing(false)
  }
  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}
export function EmptyState({
  title,
  children,
  action,
  onAction,
  onDismiss,
  dismissLabel = 'Dismiss guidance',
}: {
  title: string
  children: ReactNode
  action?: string
  onAction?: () => void
  onDismiss?: () => void
  dismissLabel?: string
}) {
  return (
    <div className="ide-zero">
      {onDismiss && <button className="ide-zero-close" type="button" aria-label={dismissLabel} title={dismissLabel} onClick={onDismiss}><X size={14} /></button>}
      <PanelsTopLeft size={24} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action && (
        <button onClick={onAction}>
          {action}
          <ArrowRight size={13} />
        </button>
      )}
    </div>
  )
}
/** Subtly highlights the substring(s) of `text` matching `query`, for search results. */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}
export function Guidance({
  id,
  children,
}: {
  id: string
  children: ReactNode
}) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(`frameui:help:${id}`) === 'done',
  )
  return dismissed ? null : (
    <div className="ide-guidance">
      <Info size={14} />
      <p>{children}</p>
      <button
        title="Dismiss this tip"
        onClick={() => {
          setDismissed(true)
          localStorage.setItem(`frameui:help:${id}`, 'done')
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}
export function ActionMenu({
  actions,
  x,
  y,
  onClose,
}: {
  actions: IdeAction[]
  x: number
  y: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus()
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // Canvas gestures stop propagation, so observe outside presses before they do.
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [onClose])
  return (
    <div
      ref={ref}
      className="ide-menu"
      role="menu"
      style={{
        left: Math.min(x, innerWidth - 255),
        top: Math.max(8, Math.min(y, innerHeight - actions.length * 30 - 20)),
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault()
          const buttons = [
            ...ref.current!.querySelectorAll<HTMLButtonElement>(
              'button:not(:disabled)',
            ),
          ]
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[
            (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
              buttons.length
          ]?.focus()
        }
      }}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          role="menuitem"
          disabled={action.disabled}
          className={action.danger ? 'danger' : ''}
          onClick={() => {
            onClose()
            action.run()
          }}
        >
          <span>{action.label}</span>
          {action.shortcut && <kbd>{action.shortcut}</kbd>}
        </button>
      ))}
    </div>
  )
}
export function CommandPalette({
  actions,
  onClose,
}: {
  actions: IdeAction[]
  onClose: () => void
}) {
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0)
  const results = actions
    .filter(
      (a) =>
        !a.disabled &&
        `${a.label} ${a.category ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice(0, 40)
  return (
    <ModalShell
        size="standard"
        variant="selection"
        className="ide-command"
        ariaLabel="Search and commands"
        onClose={onClose}
        closeOnBackdrop
        onDialogKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(results.length - 1, i + 1))
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(0, i - 1))
          }
          if (e.key === 'Enter' && results[index]) {
            e.preventDefault()
            results[index].run()
            onClose()
          }
        }}
      >
        <header>
          <Search size={18} />
          <input
            autoFocus
            aria-label="Search pages, objects and commands"
            placeholder="Search pages, objects and commands…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
          />
          <kbd>esc</kbd>
        </header>
        <div className="ide-command-results" role="listbox">
          {results.map((a, i) => (
            <button
              role="option"
              aria-selected={i === index}
              className={i === index ? 'selected' : ''}
              key={a.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                a.run()
                onClose()
              }}
            >
              <span>
                <small>{a.category ?? 'Commands'}</small>
                {a.label}
              </span>
              {a.shortcut ? (
                <kbd>{a.shortcut}</kbd>
              ) : (
                <ChevronRight size={14} />
              )}
            </button>
          ))}
          {!results.length && (
            <EmptyState title="No matches">
              Try a page name, an object, or an action such as “Create frame”.
            </EmptyState>
          )}
        </div>
        <footer>
          ↑ ↓ to browse <span>↵ to open</span>
        </footer>
    </ModalShell>
  )
}
export function ColorField({
  label,
  value,
  opacity,
  variables,
  colours,
  onChange,
  onOpacity,
  onBind,
}: {
  label: string
  value: string
  opacity: number
  variables: DesignVariable[]
  colours: string[]
  onChange: (colour: string, gradient?: string) => void
  onOpacity: (opacity: number) => void
  onBind: (id: string) => void
}) {
  const [open, setOpen] = useState(false),
    [recent, setRecent] = useState<string[]>(() => {
      try {
        return JSON.parse(
          localStorage.getItem('frameui:recent-colours') ?? '[]',
        )
      } catch {
        return []
      }
    })
  const update = (color: string) => {
    onChange(color)
    const next = [color, ...recent.filter((c) => c !== color)].slice(0, 12)
    setRecent(next)
    localStorage.setItem('frameui:recent-colours', JSON.stringify(next))
  }
  return (
    <div className="ide-colour-field">
      <label>
        {label}
        <button
          className="ide-colour-trigger"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="ide-colour-chip" style={{ background: value }} />
          {value}
          <ChevronRight size={12} />
        </button>
      </label>
      {open && (
        <div className="ide-colour-editor">
          <div className="ide-colour-line">
            <input
              aria-label={`${label} colour picker`}
              type="color"
              value={/^#[a-f0-9]{6}$/i.test(value) ? value : '#386bea'}
              onChange={(e) => update(e.target.value)}
            />
            <input
              aria-label={`${label} colour value`}
              placeholder="Hex, RGB or HSL"
              value={value}
              onChange={(e) => update(e.target.value)}
            />
          </div>
          <label>
            Opacity
            <input
              aria-label={`${label} opacity slider`}
              type="range"
              min="0"
              max="100"
              value={opacity * 100}
              onChange={(e) => onOpacity(Number(e.target.value) / 100)}
            />
          </label>
          <details>
            <summary>Gradient</summary>
            <input
              aria-label={`${label} gradient`}
              placeholder="linear-gradient(90deg, #246bff, #68c6ff)"
              onChange={(e) => onChange(value, e.target.value)}
            />
          </details>
          <button
            title="Pick a colour from your screen"
            onClick={async () => {
              const Picker = (
                window as unknown as {
                  EyeDropper?: new () => {
                    open: () => Promise<{ sRGBHex: string }>
                  }
                }
              ).EyeDropper
              if (Picker) {
                try {
                  const result = await new Picker().open()
                  update(result.sRGBHex)
                } catch {
                  /* Picking was cancelled. */
                }
              }
            }}
          >
            <Pipette size={14} />
            Eyedropper
          </button>
          <small>Document & recent colours</small>
          <div className="ide-colour-swatches">
            {[...new Set([...colours, ...recent])].slice(0, 20).map((c) => (
              <button
                key={c}
                title={c}
                style={{ background: c }}
                onClick={() => update(c)}
              />
            ))}
          </div>
          {variables
            .filter((v) => v.type === 'Colour')
            .slice(0, 12)
            .map((v) => (
              <button
                className="ide-variable-choice"
                key={v.id}
                onClick={() => {
                  onBind(v.id)
                  setOpen(false)
                }}
              >
                <span
                  className="ide-colour-chip"
                  style={{ background: v.value }}
                />
                {v.name}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
export function Welcome({ recents, projects, onOpen, onConnectApplication, onImportPrototype, onOpenProject, onBlank, onRecent, onDuplicate, onRemove, onReveal, status, error, onGettingStarted }: {
  recents: (Pick<VisualDocument, 'id' | 'name' | 'projectId' | 'updatedAt'> & { designCount?: number })[]
  projects: ProjectLibraryEntry[]
  onOpen: () => void
  onConnectApplication: () => void
  onImportPrototype: () => void
  onOpenProject: (path: string) => void
  onBlank: () => void
  onRecent: (id: string) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  onReveal: (id: string) => void
  status: string
  error: string
  onGettingStarted: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'codebases' | 'designs' | 'prototypes'>('all')
  const [archivedProjects, setArchivedProjects] = useStoredValue<string[]>('frameui:archived-projects', [])
  const [showArchived, setShowArchived] = useState(false)
  function toggleArchived(key: string) { setArchivedProjects(archivedProjects.includes(key) ? archivedProjects.filter(id=>id!==key) : [...archivedProjects,key]) }
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [sort, setSort] = useState('recent')
  const [opening, setOpening] = useState<string | null>(null)
  useEffect(() => { if (!status) setOpening(null) }, [status])
  const busy = !!opening || status === 'Scanning repository…'
  const rows = [
    ...projects.map(project => ({
      key: `project:${project.id}`, project,
      document: recents.filter(r => r.projectId === project.id).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0],
      name: project.name, date: project.lastOpenedAt,
    })),
    ...recents.filter(r => !projects.some(p => p.id === r.projectId)).map(document => ({
      key: `design:${document.id}`, project: undefined, document, name: document.name, date: document.updatedAt,
    })),
  ]
  const shown = rows.filter(row => archivedProjects.includes(row.key) === showArchived && (filter === 'all' || (filter === 'prototypes' ? !!row.project?.path.includes('/artifact-projects/') : filter === 'codebases' ? !row.project?.path.includes('/artifact-projects/') && !row.project?.path.includes('/blank-projects/') && (!!row.project || !!row.document?.projectId) : !!row.project?.path.includes('/blank-projects/') || !row.project && !row.document?.projectId)) &&
    `${row.name} ${row.project?.path ?? ''} ${row.project?.framework ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : b.date.localeCompare(a.date))
  const prototypeCount = rows.filter(row => row.project?.path.includes('/artifact-projects/')).length
  const codebaseCount = rows.filter(row => !row.project?.path.includes('/artifact-projects/') && !row.project?.path.includes('/blank-projects/') && (row.project || row.document?.projectId)).length
  const openRow = (row: typeof rows[number]) => {
    if (busy) return
    if (row.project) { setOpening(row.key); onOpenProject(row.project.path) }
    else if (row.document) onRecent(row.document.id)
  }
  return <div className="ide-start project-home">
    <header className="project-home-top app-drag-region">
      <div className="ide-brand"><PanelsTopLeft size={21} />FrameUI <span>WORKSPACE</span></div>
      <div className="project-home-tools app-no-drag"><span className="project-local"><i /> Local workspace</span><ThemeControl /></div>
    </header>
    <div className="project-home-layout">
      <aside className="project-home-nav">
        <div className="project-workspace-avatar"><span>F</span><div><strong>Your workspace</strong><small>Design with context.</small></div></div>
        <small className="project-nav-label">LIBRARY</small>
        <nav aria-label="Project filters">
          {([{id:'all',label:'All projects',Icon:LayoutGrid,count:rows.length},{id:'codebases',label:'Codebases',Icon:Code2,count:codebaseCount},{id:'prototypes',label:'Prototypes',Icon:PanelsTopLeft,count:prototypeCount},{id:'designs',label:'Blank designs',Icon:FilePlus2,count:rows.length-codebaseCount-prototypeCount}] as const).map(item => <button key={item.id} aria-current={filter===item.id?'page':undefined} onClick={()=>setFilter(item.id)}><item.Icon size={16}/><span>{item.label}</span><small>{item.count}</small></button>)}
        </nav>
        <div className="project-nav-bottom"><div className="project-guide"><BookOpen size={19}/><strong>New to FrameUI?</strong><p>From your codebase to your first editable canvas.</p><button onClick={onGettingStarted}>Getting started <ArrowRight size={14}/></button></div><span><HardDrive size={13}/> Stored on this computer</span></div>
      </aside>
      <main className="project-home-main">
        <div className="project-home-heading"><div><span className="project-kicker">FRAMEUI</span><h1>Your design workspace</h1><p>Start from your product. Capture real pages, explore ideas and test what comes next.</p></div><button className="primary" onClick={onOpen} disabled={busy}><Plus size={17}/> Open Codebase</button></div>
        <section className="project-launch-strip" aria-label="Start creating">
          <button className="prototype-quick-start" onClick={onImportPrototype} disabled={busy}><span className="project-launch-icon"><PanelsTopLeft size={23}/></span><span><strong>Import HTML prototype</strong><small>HTML or ZIP from ChatGPT, Claude or other tools. Capture editable pages and linked flows. No repository needed.</small></span><ArrowRight size={18}/></button>
          <button onClick={onOpen} disabled={busy}><span className="project-launch-icon"><FolderOpen size={23}/></span><span><strong>Open an existing repository</strong><small>Recommended. Add localhost or a hosted app, or explore the repository first.</small></span><ArrowRight size={18}/></button>
          <button onClick={onConnectApplication} disabled={busy}><span className="project-launch-icon"><Monitor size={23}/></span><span><strong>Connect a running app</strong><small>Capture by URL. Repository component mapping unavailable.</small></span><ArrowRight size={18}/></button>
          <button onClick={onBlank} disabled={busy} aria-label="Create Blank Design"><span className="project-launch-icon"><FilePlus2 size={23}/></span><span><strong>Start a blank design</strong><small>Explore an idea on an empty canvas.</small></span><ArrowRight size={18}/></button>
        </section>
        {!rows.length&&<ol className="studio-start-path" aria-label="Your first project"><li><span>1</span><strong>Start</strong><small>Prototype, app or repository</small></li><li><span>2</span><strong>Capture</strong><small>Only the pages you need</small></li><li><span>3</span><strong>Explore</strong><small>Design, flows and AI drafts</small></li><li><span>4</span><strong>Approve</strong><small>Test before importing</small></li></ol>}
        <section className="project-collection" aria-label="Saved projects">
          <div className="project-collection-heading"><h2>{showArchived?'Archived projects':filter==='all'?'All projects':filter==='codebases'?'Codebases':filter==='prototypes'?'Prototypes':'Blank designs'} <span>{shown.length}</span></h2><span>Saved on this computer</span></div>
          {!!rows.length&&<div className="project-collection-controls"><label className="project-search"><Search size={16}/><input aria-label="Search projects" placeholder="Search projects…" value={query} onChange={e=>setQuery(e.target.value)}/>{query && <button aria-label="Clear project search" onClick={()=>setQuery('')}><X size={14}/></button>}</label><select aria-label="Sort projects" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Recently opened</option><option value="name">Name A–Z</option></select><button aria-label="View archived projects" aria-pressed={showArchived} onClick={()=>setShowArchived(!showArchived)}><Archive size={15}/>{showArchived?'Back to projects':'Archive'}</button><div className="project-view-switch"><button aria-label="Grid view" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><LayoutGrid size={16}/></button><button aria-label="List view" aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={16}/></button></div></div>}
          {shown.length ? <div className={`project-cards project-cards--${view}`}>{shown.map((row,index)=><article className="project-card" key={row.key}>
            <button className="project-card-open" aria-label={`Open ${row.name}`} disabled={busy} onClick={()=>openRow(row)}>
              <div className={`project-card-art project-card-art--${index%4}`} aria-hidden="true"><div className="project-card-orbit"/><span>{row.project || row.document?.projectId ? <Code2 size={32} strokeWidth={1.3}/> : <PanelsTopLeft size={32} strokeWidth={1.3}/>}</span><small>{(row.project?.path?.includes('/artifact-projects/')?'HTML prototype':row.project?.framework) || (row.project || row.document?.projectId ? 'Codebase' : 'Design file')}</small><ArrowRight size={16}/></div>
              <div className="project-card-copy"><div><h3>{row.name}</h3></div><p title={row.project?.path}>{row.project?.path?.includes('/artifact-projects/')?'HTML prototype · No repository needed':row.project?.path?.includes('/application-projects/')?'Running app · No repository connected':row.project?.path?.includes('/blank-projects/')?'Blank design · Local project':row.project?.path || 'Independent design workspace'}</p><footer><span className={`project-card-status ${row.project?.missing?'is-missing':''}`}>{row.project?.missing?'Folder unavailable':row.project?.path.includes('/artifact-projects/')?'Prototype':row.project?.path.includes('/blank-projects/')?'Design project':row.project?.repositoryStatus==='not-indexed'?'Ready to set up':row.document ? `${row.document.designCount ?? 0} ${row.document.designCount === 1 ? 'design' : 'designs'}` : 'Codebase'}</span><span><Clock3 size={12}/>{new Date(row.date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</span><span>{opening===row.key?'Opening…':row.project?.pageCount != null ? `${row.project.pageCount} ${row.project.pageCount === 1 ? 'page' : 'pages'}` : 'Local'}</span></footer></div>
            </button>
            <div className="project-card-actions"><button title={showArchived?'Restore project':'Archive project'} aria-label={`${showArchived?'Restore':'Archive'} ${row.name}`} onClick={()=>toggleArchived(row.key)}><Archive size={14}/></button>{row.project && <button title="Reveal project folder" aria-label={`Reveal ${row.name} folder`} onClick={()=>onReveal(row.project!.id)}><FolderOpen size={14}/></button>}{row.document && <><button title="Duplicate design file" aria-label={`Duplicate ${row.name}`} onClick={()=>onDuplicate(row.document!.id)}><Copy size={14}/></button>{!row.project && <button title="Remove from Recent · Keeps the design file" aria-label={`Remove ${row.name} from recent`} onClick={()=>onRemove(row.document!.id)}><Trash2 size={14}/></button>}</>}</div>
          </article>)}</div> : <div className="project-empty"><span><FolderOpen size={27} strokeWidth={1.4}/></span><h3>{rows.length?'No projects found.':'Your projects will appear here'}</h3><p>{rows.length?'Try a different search or choose another collection.':'Import a prototype, connect your app, or open a repository to get started.'}</p>{rows.length ? <button onClick={()=>{setQuery('');setFilter('all')}}>Show all projects <ArrowRight size={14}/></button> : null}</div>}
        </section>
        <div className="project-home-footer"><span>Capture → Design → Prototype</span><span>FrameUI · Local by design</span></div>
        {busy && status && <p role="status" className="project-home-status">{status}</p>}{error && <p className="ide-error" role="alert">{error}</p>}
      </main>
    </div>
  </div>
}
