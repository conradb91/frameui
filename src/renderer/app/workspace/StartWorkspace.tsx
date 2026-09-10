import { GitHubImportDialog } from '../../components/project/GitHubImportDialog'
import { pendingWorkspaceSaves } from '../../state/pendingSaves'
import { CreateHostedProject } from '../../components/project/CreateHostedProject'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes, ChevronDown, CircleAlert, Clock3, Copy, FolderOpen, Grid2X2, List,
  MoreHorizontal, Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react'
import type { ProjectLibraryEntry, RecentProject } from '@shared/types/project'
import { FrameMark } from '../../components/icons/icons'
import { formatRelativeTime } from '../../lib/formatRelativeTime'

type LibraryView = 'all' | 'recent'
type DisplayMode = 'grid' | 'list'
type SortMode = 'opened' | 'name' | 'added'

export function StartWorkspace({ recentProjects, activeProject, onOpenFolder, onOpenProject, onProjectRemoved, onLibraryChanged }: {
  recentProjects: RecentProject[]
  activeProject: RecentProject | null
  onOpenFolder: (relinkId?: string) => Promise<void>
  onOpenProject: (project: RecentProject) => Promise<void>
  onProjectRemoved: (projectId: string) => void
  onLibraryChanged: () => void
}) {
  const [projects, setProjects] = useState<ProjectLibraryEntry[]>([])
  const [cloning, setCloning] = useState(false)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<LibraryView>('recent')
  const [display, setDisplay] = useState<DisplayMode>(() => localStorage.getItem('frameui:project-library:view') === 'list' ? 'list' : 'grid')
  const [sort, setSort] = useState<SortMode>('opened')
  const [query, setQuery] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectLibraryEntry | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const projectRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  async function refresh() { setProjects(await window.frameui.project.listLibrary()) }
  useEffect(() => { void refresh() }, [recentProjects])
  useEffect(() => { localStorage.setItem('frameui:project-library:view', display) }, [display])
  useEffect(() => {
    const requested = localStorage.getItem('frameui:project-library:section')
    if (requested === 'all' || requested === 'recent') setView(requested)
    const show = (event: Event) => { const requestedView = (event as CustomEvent<string>).detail; if (requestedView === 'all' || requestedView === 'recent') setView(requestedView) }
    window.addEventListener('frameui:show-projects', show)
    return () => window.removeEventListener('frameui:show-projects', show)
  }, [])
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDragging(false); setMenuId(null); if (deleteTarget) setDeleteTarget(null) } }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [deleteTarget])
  useEffect(() => {
    if (!menuId) return
    const close = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest('[data-project-menu]')) setMenuId(null) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuId])

  const shown = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return projects
      .filter((project) => view === 'all' || project.recent)
      .filter((project) => !normalized || `${project.name} ${project.path} ${project.framework ?? ''}`.toLowerCase().includes(normalized))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'added' ? new Date(b.addedAt ?? b.lastOpenedAt).getTime() - new Date(a.addedAt ?? a.lastOpenedAt).getTime() : new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
  }, [projects, query, sort, view])

  async function removeRecent(project: ProjectLibraryEntry) {
    await window.frameui.project.removeFromRecent(project.id); setMenuId(null); onLibraryChanged(); await refresh()
  }
  async function clearRecent() { await window.frameui.project.clearRecent(); onLibraryChanged(); await refresh() }
  async function removeFrameUi(project: ProjectLibraryEntry) {
    await pendingWorkspaceSaves.flush()
    await window.frameui.project.removeFromFrameUi(project.id)
    localStorage.removeItem(`frameui:session:${project.id}`); localStorage.removeItem(`frameui:visual-canvas:${project.id}:v1`)
    onProjectRemoved(project.id); setMenuId(null); await refresh()
  }
  async function deleteDisk(project: ProjectLibraryEntry, confirmation: string) {
    await pendingWorkspaceSaves.flush()
    await window.frameui.project.deleteFromDisk(project.id, confirmation)
    localStorage.removeItem(`frameui:session:${project.id}`); localStorage.removeItem(`frameui:visual-canvas:${project.id}:v1`)
    onProjectRemoved(project.id); setDeleteTarget(null); await refresh()
  }
  async function copyPath(project: ProjectLibraryEntry) {
    await navigator.clipboard.writeText(project.path); setNotice('Project path copied'); setMenuId(null); window.setTimeout(() => setNotice(null), 1800)
  }
  async function refreshProject(project: ProjectLibraryEntry) {
    setMenuId(null); await onOpenProject(project); await window.frameui.project.reindex()
  }
  async function handleDrop(event: React.DragEvent) {
    event.preventDefault(); setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    const droppedPath = window.frameui.app.getPathForFile(file)
    if (!droppedPath) { setNotice('Drop a local project folder.'); return }
    const result = await window.frameui.project.openPath(droppedPath)
    if (result.ok) await onOpenProject(result.project)
    else setNotice('That folder could not be opened.')
  }
  function moveFocus(event: React.KeyboardEvent, projectId: string) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    const index = shown.findIndex((project) => project.id === projectId); if (index < 0) return
    const columns = display === 'grid' ? 3 : 1
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? columns : -columns
    const next = shown[Math.max(0, Math.min(shown.length - 1, index + delta))]
    if (next) { event.preventDefault(); projectRefs.current.get(next.id)?.focus() }
  }

  const latest = projects.filter((project) => project.recent).sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()).slice(0, 3)
  return <div onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} className="relative flex min-w-0 flex-1 bg-bg">
    {cloning && <GitHubImportDialog onClose={() => setCloning(false)} onImported={onOpenProject}/>}
    {creating && <CreateHostedProject onClose={() => setCreating(false)} onCreated={async project => { await refresh(); await onOpenProject(project) }}/>}
    <aside className="project-library-rail context-rail" aria-label="Application navigation">
      <div className="px-2 pb-2 pt-2 text-[12px] font-semibold tracking-normal text-text-3">Projects</div>
      <SidebarButton active={view === 'all'} icon={<Boxes size={13}/>} label="All Projects" onClick={() => setView('all')}/>
      <SidebarButton active={view === 'recent'} icon={<Clock3 size={13}/>} label="Recent" onClick={() => setView('recent')}/>
      <SidebarButton icon={<FolderOpen size={13}/>} label="Open project folder" onClick={() => void onOpenFolder()}/>
      {latest.length > 0 && <div className="mt-3"><div className="px-2 pb-1 text-[11px] font-semibold tracking-normal text-text-3">Recent</div>{latest.map((project) => <button key={project.id} type="button" onClick={() => project.missing ? void onOpenFolder(project.id) : void onOpenProject(project)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-text-2 hover:bg-hover hover:text-text"><span className={`h-1.5 w-1.5 rounded-full ${project.missing ? 'bg-danger' : 'bg-text-3'}`}/><span className="truncate">{project.name}</span></button>)}</div>}
      <div className="mt-auto border-t border-border px-2 py-2 text-[12px] leading-relaxed text-text-3">{activeProject ? <><span className="block text-text-2">Active · {activeProject.name}</span><span className="mt-1 block">Opening another project switches the active workspace.</span></> : 'Drag a local project folder anywhere into this window to open it.'}</div>
    </aside>

    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-4 pb-8 pt-6">
        <section className="flex items-start justify-between gap-3 border-b border-border pb-4">
          <div><div className="flex items-center gap-2"><FrameMark className="h-6 w-6 text-accent-2"/><h1 className="text-[13px] font-semibold tracking-normal text-text">FrameUI</h1></div><h2 className="mt-4 text-[13px] font-medium text-text">Design directly from your product.</h2><p className="mt-1.5 max-w-[620px] text-[12.5px] leading-relaxed text-text-2">Open an existing application to inspect its real pages, components and design system, then work with them visually inside FrameUI.</p></div>
          <div className="flex max-w-lg flex-wrap items-center justify-end gap-2 pt-2"><button type="button" onClick={() => void onOpenFolder()} className="flex h-8 items-center gap-2 rounded bg-accent px-3 text-[12px] font-semibold text-on-accent hover:bg-accent-hover"><FolderOpen size={13}/>New Design Project</button><button type="button" disabled={!latest[0]} onClick={() => latest[0] && void onOpenProject(latest[0])} className="h-8 rounded border border-border bg-panel px-3 text-[12px] text-text-2 hover:border-border-strong hover:text-text disabled:opacity-35">Open Recent</button><button type="button" onClick={() => setCloning(true)} className="h-8 rounded border border-border px-3 text-xs hover:bg-hover">Clone from GitHub</button><button type="button" onClick={() => setCreating(true)} className="h-8 rounded border border-border px-3 text-[12px] text-text-2 hover:bg-hover hover:text-text">Create Project</button></div>
        </section>

        {projects.length === 0 ? <EmptyProjects onOpen={() => void onOpenFolder()}/> : <>
          <div className="flex items-center gap-3 py-5"><div><h2 className="text-[13px] font-semibold text-text">{view === 'all' ? 'All Projects' : 'Recent Projects'}</h2><div className="mt-0.5 text-[12px] text-text-3">{shown.length} project{shown.length === 1 ? '' : 's'}</div></div><div className="ml-auto flex h-7 w-[230px] items-center gap-1.5 rounded border border-border bg-panel px-2"><Search size={11} className="text-text-3"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects…" className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none"/></div><label className="flex h-7 items-center rounded border border-border bg-panel px-2 text-[12px] text-text-3">Sort&nbsp;<select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="bg-transparent text-text-2 outline-none"><option value="opened">Recently opened</option><option value="name">Name</option><option value="added">Recently added</option></select><ChevronDown size={10}/></label><div className="flex rounded border border-border bg-panel p-0.5"><IconButton title="Grid view" active={display === 'grid'} onClick={() => setDisplay('grid')}><Grid2X2 size={12}/></IconButton><IconButton title="List view" active={display === 'list'} onClick={() => setDisplay('list')}><List size={12}/></IconButton></div>{view === 'recent' && shown.length > 0 && <button type="button" onClick={() => void clearRecent()} className="text-[12px] text-text-3 hover:text-danger">Clear Recent</button>}</div>
          {shown.length === 0 ? <div className="flex h-52 items-center justify-center rounded border border-dashed border-border text-[12px] text-text-3">{query ? 'No projects match your search.' : 'No recent projects. Your registered projects remain in All Projects.'}</div> : <div className={display === 'grid' ? 'grid grid-cols-2 gap-4 xl:grid-cols-3' : 'flex flex-col gap-1.5'}>{shown.map((project) => <ProjectCard key={project.id} project={project} mode={display} menuOpen={menuId === project.id} setMenuOpen={(open) => setMenuId(open ? project.id : null)} setRef={(node) => { if (node) projectRefs.current.set(project.id, node); else projectRefs.current.delete(project.id) }} onKeyDown={(event) => moveFocus(event, project.id)} onOpen={() => project.missing ? void onOpenFolder(project.id) : void onOpenProject(project)} onLocate={() => void onOpenFolder(project.id)} onCopy={() => void copyPath(project)} onReveal={() => void window.frameui.project.reveal(project.id)} onRefresh={() => void refreshProject(project)} onRemoveRecent={() => void removeRecent(project)} onRemove={() => void removeFrameUi(project)} onDelete={() => { setMenuId(null); setDeleteTarget(project) }}/>)}</div>}
          <button type="button" onClick={() => void onOpenFolder()} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded border border-dashed border-border text-[12px] text-text-3 hover:border-border-strong hover:text-text-2"><Plus size={12}/>Open another project or drop a folder here</button>
        </>}
      </div>
    </main>
    {dragging && <div onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }} onDrop={(event) => void handleDrop(event)} className="absolute inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-accent-2 bg-panel"><div className="text-center"><FolderOpen size={30} className="mx-auto text-accent-2"/><div className="mt-3 text-[13px] font-semibold text-text">Drop project folder to open</div><div className="mt-1 text-[12px] text-text-3">FrameUI will validate, register and open the application.</div></div></div>}
    {deleteTarget && <DeleteProjectDialog project={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={(name) => void deleteDisk(deleteTarget, name)}/>} 
    {notice && <div className="absolute bottom-5 left-1/2 z-50 -translate-x-1/2 rounded border border-border bg-panel px-3 py-2 text-[12px] text-text shadow-sm">{notice}</div>}
  </div>
}

function SidebarButton({ active, icon, label, onClick }: { active?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button type="button" title={label} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick} className={`mb-0.5 flex h-8 items-center gap-2 rounded px-2 text-left text-[12px] ${active ? 'bg-selected text-text' : 'text-text-2 hover:bg-hover hover:text-text'}`}>{icon}{label}</button> }
function IconButton({ children, title, active, onClick }: { children: React.ReactNode; title: string; active: boolean; onClick: () => void }) { return <button type="button" title={title} onClick={onClick} className={`flex h-6 w-7 items-center justify-center rounded ${active ? 'bg-hover text-text' : 'text-text-3 hover:text-text'}`}>{children}</button> }

function ProjectCard({ project, mode, menuOpen, setMenuOpen, setRef, onKeyDown, onOpen, onLocate, onCopy, onReveal, onRefresh, onRemoveRecent, onRemove, onDelete }: { project: ProjectLibraryEntry; mode: DisplayMode; menuOpen: boolean; setMenuOpen: (open: boolean) => void; setRef: (node: HTMLDivElement | null) => void; onKeyDown: (event: React.KeyboardEvent) => void; onOpen: () => void; onLocate: () => void; onCopy: () => void; onReveal: () => void; onRefresh: () => void; onRemoveRecent: () => void; onRemove: () => void; onDelete: () => void }) {
  if (mode === 'list') return <div ref={setRef} tabIndex={0} onKeyDown={(event) => { onKeyDown(event); if (event.key === 'Enter') onOpen() }} onDoubleClick={onOpen} className="group relative grid grid-cols-[44px_minmax(140px,1fr)_100px_90px_90px_110px_28px] items-center gap-3 rounded border border-transparent px-2 py-1.5 outline-none hover:border-border hover:bg-hover focus:border-accent/60"><ProjectCover project={project} compact/><ProjectIdentity project={project}/><span className="text-[12px] capitalize text-text-3">{project.framework ?? 'Not indexed'}</span><span className="text-[12px] text-text-3">{project.pageCount ?? '—'} pages</span><span className="text-[12px] text-text-3">{project.componentCount ?? '—'} components</span><span className="text-[12px] text-text-3">{project.missing ? 'Missing folder' : formatRelativeTime(project.lastOpenedAt)}</span><ProjectMenuButton open={menuOpen} onToggle={setMenuOpen}/>{menuOpen && <ProjectMenu project={project} onOpen={onOpen} onLocate={onLocate} onCopy={onCopy} onReveal={onReveal} onRefresh={onRefresh} onRemoveRecent={onRemoveRecent} onRemove={onRemove} onDelete={onDelete}/>}</div>
  return <div ref={setRef} tabIndex={0} onKeyDown={(event) => { onKeyDown(event); if (event.key === 'Enter') onOpen() }} onDoubleClick={onOpen} className="group relative overflow-visible rounded-md border border-border bg-panel outline-none transition-colors hover:border-border-strong focus:border-accent/70"><ProjectCover project={project}/><div className="p-3"><div className="flex items-start gap-2"><ProjectIdentity project={project}/><ProjectMenuButton open={menuOpen} onToggle={setMenuOpen}/></div><div className="mt-3 flex items-center gap-3 border-t border-border pt-2.5 text-[12px] text-text-3"><span>{project.pageCount ?? '—'} pages</span><span>{project.componentCount ?? '—'} components</span><span className="ml-auto capitalize">{project.framework ?? 'Not indexed'}</span></div>{project.missing && <div className="mt-2 flex items-center justify-between rounded bg-panel px-2 py-1.5 text-[12px] text-danger"><span className="flex items-center gap-1"><CircleAlert size={10}/>Project folder moved or missing</span><button type="button" onClick={onLocate} className="font-semibold text-accent-2">Locate Folder</button></div>}</div><button type="button" onClick={onOpen} className="absolute right-10 top-[116px] hidden rounded bg-accent px-2 py-1 text-[11px] font-semibold text-on-accent shadow-sm group-hover:block">{project.missing ? 'Locate' : 'Open'}</button>{menuOpen && <ProjectMenu project={project} onOpen={onOpen} onLocate={onLocate} onCopy={onCopy} onReveal={onReveal} onRefresh={onRefresh} onRemoveRecent={onRemoveRecent} onRemove={onRemove} onDelete={onDelete}/>}</div>
}

function ProjectCover({ project, compact }: { project: ProjectLibraryEntry; compact?: boolean }) { const [cover, setCover] = useState<string | null>(null); useEffect(() => { let cancelled = false; void window.frameui.project.getLibraryCover(project.id).then((value) => { if (!cancelled) setCover(value) }); return () => { cancelled = true } }, [project.id]); return <div className={`${compact ? 'h-8 w-11 rounded' : 'h-[128px] w-full rounded-t-md'} overflow-hidden bg-panel`}>{cover ? <img src={cover} alt="" className="h-full w-full object-cover object-top"/> : <div className="flex h-full items-center justify-center" style={{ backgroundImage: 'none', backgroundSize: '12px 12px' }}><FrameMark className={`${compact ? 'h-3 w-3' : 'h-8 w-8'} text-text-3`}/></div>}</div> }
function ProjectIdentity({ project }: { project: ProjectLibraryEntry }) { return <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate text-[12px] font-semibold text-text">{project.name}</span>{project.branch && <span className="rounded bg-hover px-1 py-0.5 font-mono text-[11px] text-text-3">{project.branch}</span>}</div><div title={project.path} className="mt-0.5 truncate font-mono text-[11px] text-text-3">{project.path}</div><div className={`mt-1 text-[11px] ${project.missing ? 'text-danger' : 'text-text-3'}`}>{project.missing ? 'Missing folder' : formatRelativeTime(project.lastOpenedAt)}</div></div> }
function ProjectMenuButton({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) { return <button data-project-menu type="button" title="Project actions" aria-expanded={open} onClick={(event) => { event.stopPropagation(); onToggle(!open) }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-3 hover:bg-hover hover:text-text"><MoreHorizontal size={14}/></button> }
function ProjectMenu({ project, onOpen, onLocate, onCopy, onReveal, onRefresh, onRemoveRecent, onRemove, onDelete }: { project: ProjectLibraryEntry; onOpen: () => void; onLocate: () => void; onCopy: () => void; onReveal: () => void; onRefresh: () => void; onRemoveRecent: () => void; onRemove: () => void; onDelete: () => void }) { return <div data-project-menu className="absolute right-2 top-10 z-30 w-44 overflow-hidden rounded border border-border-strong bg-panel py-1 shadow-sm">{project.missing ? <MenuItem label="Locate Folder" icon={<FolderOpen size={11}/>} onClick={onLocate}/> : <><MenuItem label="Open" icon={<FolderOpen size={11}/>} onClick={onOpen}/><MenuItem label="Reveal in Finder" icon={<FolderOpen size={11}/>} onClick={onReveal}/><MenuItem label="Copy Path" icon={<Copy size={11}/>} onClick={onCopy}/><MenuItem label="Refresh Project" icon={<RefreshCw size={11}/>} onClick={onRefresh}/></>}{project.recent && <MenuItem label="Remove from Recent" icon={<Clock3 size={11}/>} onClick={onRemoveRecent}/>}<div className="my-1 h-px bg-border"/><MenuItem label="Remove from FrameUI" icon={<X size={11}/>} onClick={onRemove}/>{!project.missing && <MenuItem danger label="Delete From Disk…" icon={<Trash2 size={11}/>} onClick={onDelete}/>}</div> }
function MenuItem({ label, icon, danger, onClick }: { label: string; icon: React.ReactNode; danger?: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-hover ${danger ? 'text-danger' : 'text-text-2'}`}>{icon}{label}</button> }
function EmptyProjects({ onOpen }: { onOpen: () => void }) { return <div className="flex min-h-[420px] items-center justify-center"><div className="max-w-sm text-center"><FrameMark className="mx-auto h-10 w-10 text-accent-2"/><h2 className="mt-4 text-[13px] font-semibold text-text">Design from your real product</h2><p className="mt-2 text-[12px] leading-relaxed text-text-3">FrameUI runs a private local copy of your application so you can design with its real screens, components and styles. Your source stays on your computer.</p><button type="button" onClick={onOpen} className="mt-5 inline-flex h-8 items-center gap-2 rounded bg-accent px-3 text-[12px] font-semibold text-on-accent"><FolderOpen size={13}/>New Design Project</button><div className="mt-3 text-[12px] text-text-3">Open Recent · Drag a folder here</div></div></div> }

function DeleteProjectDialog({ project, onCancel, onConfirm }: { project: ProjectLibraryEntry; onCancel: () => void; onConfirm: (name: string) => void }) { const [name, setName] = useState(''); return <div className="absolute inset-0 z-[100] flex items-center justify-center bg-scrim"><div role="dialog" aria-modal="true" aria-labelledby="delete-project-title" className="w-[440px] rounded-lg border border-danger/40 bg-panel p-5 shadow-sm"><div className="flex items-start gap-3"><div className="rounded bg-panel p-2 text-danger"><Trash2 size={18}/></div><div><h2 id="delete-project-title" className="text-[13px] font-semibold text-text">Permanently delete {project.name}?</h2><p className="mt-1.5 text-[12px] leading-relaxed text-text-3">This deletes the actual project folder and every file inside it. This cannot be undone. Removing the project from FrameUI is the safe alternative.</p></div></div><div className="mt-4 rounded border border-danger/20 bg-panel p-2.5 font-mono text-[12px] text-danger">{project.path}</div><label className="mt-4 block text-[12px] text-text-2">Type <strong>{project.name}</strong> to confirm<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-8 w-full rounded border border-border bg-bg px-2 text-[12px] text-text outline-none focus:border-danger"/></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="h-8 rounded border border-border px-3 text-[12px] text-text-2">Cancel</button><button type="button" disabled={name !== project.name} onClick={() => onConfirm(name)} className="h-8 rounded bg-danger px-3 text-[12px] font-semibold text-on-status disabled:opacity-30">Delete Project From Disk</button></div></div></div> }
