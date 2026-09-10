import { DesignFilePreview } from '../../components/project/DesignFilePreview'
import type { ProjectVisuals } from '@shared/types/projectVisuals'
import { useEffect, useState } from 'react'
import { ArrowUpRight, FilePlus2, FolderPlus, Frame, GitBranch, Plus, Search } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import { useDesignFilesStore } from '../../state/designFilesStore'
import { useUiStore } from '../../state/uiStore'
import { formatRelativeTime } from '../../lib/formatRelativeTime'

/** The project library never starts the imported application or opens routes. */
export function ProjectHome() {
  const project = useProjectStore((s) => s.activeProject)
  const index = useProjectStore((s) => s.activeIndex)
  const pages = index?.projectModel.pages ?? []
  const files = useDesignFilesStore((s) => s.files)
  const folders = useDesignFilesStore((s) => s.folders)
  const [visuals, setVisuals] = useState<ProjectVisuals | null>(null)
  useEffect(() => { let cancelled = false; void window.frameui.project.getVisuals().then((value) => { if (!cancelled) setVisuals(value) }).catch(() => {}); return () => { cancelled = true } }, [project?.id])
  const [folder, setFolder] = useState('all')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState<'page' | 'flow' | 'blank' | null>(null)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [folderName, setFolderName] = useState<string | null>(null)
  function open(id: string) { useDesignFilesStore.getState().selectFile(id); useUiStore.getState().setSection('canvas') }
  function create() {
    if (!project) return
    const file = useDesignFilesStore.getState().createFile(folder === 'all' ? undefined : folder, name.trim() || (creating === 'flow' ? 'Untitled flow' : creating === 'blank' ? 'Untitled design' : pages.find((p) => p.id === selected[0])?.name), creating === 'flow' ? selected : undefined)
    // Seed only the explicitly chosen screens. Blank designs are seeded by the canvas.
    localStorage.setItem(`frameui:canvas-seed:${project.id}:${file.id}`, JSON.stringify({ pageIds: selected, blank: creating === 'blank' }))
    open(file.id)
  }
  const visible = files.filter((f) => f.kind === 'design' && !f.archived && (folder === 'all' || f.folderId === folder) && f.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return <main className="project-home min-w-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-[1180px] px-10 py-10">
      <div className="flex items-center justify-between gap-6"><div><p className="text-xs text-text-3">{project?.name}</p><h1 className="mt-2 text-[28px] font-semibold tracking-tight text-text">A place for your next idea.</h1><p className="mt-2 text-sm text-text-2">Start with your product. Make room for what comes next.</p></div><button className="home-primary" onClick={() => { setCreating('blank'); setSelected([]); setName('') }}><Plus size={15}/>New Design</button></div>
      <div className="my-9 grid grid-cols-3 gap-3">{([{ id: 'page', icon: FilePlus2, title: 'Existing Page', text: 'Bring a screen into your design.' }, { id: 'flow', icon: GitBranch, title: 'Feature Flow', text: 'Work across a sequence of screens.' }, { id: 'blank', icon: Frame, title: 'Blank Design', text: 'A fresh frame. Your design system.' }] as const).map(({ id, icon: Icon, title, text }) => <button key={id} onClick={() => { setCreating(id); setName(''); setSelected([]) }} className="home-start"><Icon size={20}/><strong>{title}</strong><span>{text}</span><ArrowUpRight size={14} className="absolute right-4 top-4 text-text-3"/></button>)}</div>
      <div className="mb-4 flex items-center gap-2"><h2 className="flex-1 text-sm font-semibold">Folders</h2><button className="home-secondary" onClick={() => setFolderName('')}><FolderPlus size={14}/>New folder</button></div>
      {folderName !== null && <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (folderName.trim()) { useDesignFilesStore.getState().createFolder(folderName.trim()); setFolderName(null) } }}><input autoFocus aria-label="Folder name" className="home-input" value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Folder name"/><button className="home-primary">Create</button><button type="button" className="home-secondary" onClick={() => setFolderName(null)}>Cancel</button></form>}
      <div className="mb-9 flex flex-wrap gap-2">{[{ id: 'all', name: 'All designs' }, ...folders].map((f) => <button key={f.id} onClick={() => setFolder(f.id)} className={`home-folder ${folder === f.id ? 'is-active' : ''}`}>{f.name}<span>{files.filter((file) => file.kind === 'design' && !file.archived && (f.id === 'all' || file.folderId === f.id)).length}</span></button>)}</div>
      <div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent designs & flows</h2><label className="flex items-center gap-2 text-text-3"><Search size={14}/><input aria-label="Find a design" placeholder="Find a design" className="bg-transparent text-xs outline-none" value={query} onChange={(e) => setQuery(e.target.value)}/></label></div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">{visible.map((file) => {
        const preview = localStorage.getItem(`frameui:design-preview:${project?.id}:${file.id}`)
        return <button key={file.id} onClick={() => open(file.id)} className="home-file"><div className="home-file-preview">{preview ? <img src={preview} alt={`${file.name} canvas preview`}/> : <DesignFilePreview projectId={project!.id} fileId={file.id} visuals={visuals}/>}</div><div className="flex items-center justify-between px-1 pt-3"><strong className="truncate text-[13px] font-medium">{file.name}</strong><ArrowUpRight size={13}/></div><p className="px-1 pt-1 text-left text-[11px] text-text-3">{file.flowPageIds ? `${file.flowPageIds.length} screens · ` : ''}{formatRelativeTime(file.updatedAt)}</p></button>
      })}</div>
      {!visible.length && <div className="rounded-lg border border-dashed border-border-strong px-8 py-14 text-center"><Frame size={26} className="mx-auto text-text-3"/><p className="mt-4 text-sm">{query ? 'No matching designs' : 'Your designs will live here'}</p><p className="mt-2 text-xs text-text-3">{query ? 'Try another name.' : 'Open an existing page, assemble a flow, or begin with a blank design.'}</p></div>}
    </div>
    {creating && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8" onKeyDown={(e) => { if (e.key === 'Escape') setCreating(null) }}><form onSubmit={(e) => { e.preventDefault(); create() }} className="w-full max-w-xl rounded-xl border border-border-strong bg-bg-raised p-6 shadow-2xl"><h2 className="text-lg font-semibold">{creating === 'flow' ? 'Create a feature flow' : creating === 'page' ? 'Choose a page' : 'Start a blank design'}</h2><input autoFocus aria-label="Design name" className="home-input my-5 w-full" placeholder="Name your design" value={name} onChange={(e) => setName(e.target.value)}/>{creating !== 'blank' ? <div className="max-h-72 space-y-1 overflow-auto">{pages.map((page) => <label key={page.id} className="flex cursor-pointer items-center gap-3 rounded px-3 py-3 text-sm hover:bg-white/5"><input type={creating === 'page' ? 'radio' : 'checkbox'} name="pages" checked={selected.includes(page.id)} onChange={() => setSelected((ids) => creating === 'page' ? [page.id] : ids.includes(page.id) ? ids.filter((id) => id !== page.id) : [...ids, page.id])}/>{page.name}{selected.includes(page.id) && creating === 'flow' && <span className="ml-auto text-xs text-text-3">{selected.indexOf(page.id) + 1}</span>}</label>)}{!pages.length && <p className="py-6 text-sm text-text-3">No pages available yet. You can start with a blank design.</p>}</div> : <p className="text-sm leading-6 text-text-2">Your project’s detected fonts, colours, spacing and components are available in the workspace.</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className="home-secondary" onClick={() => setCreating(null)}>Cancel</button><button disabled={creating !== 'blank' && !selected.length} className="home-primary disabled:opacity-40">{creating === 'flow' ? `Open ${selected.length} screens` : 'Create design'}</button></div></form></div>}
  </main>
}
