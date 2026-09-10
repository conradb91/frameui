import { useEffect, useRef, useState } from 'react'
import {
  Archive, ChevronDown, ChevronRight, Component, File, Folder, FolderPlus,
  GitBranch, Map, MoreHorizontal, Plus, Search, Settings, Star, Trash2,
} from 'lucide-react'
import { useDesignFilesStore, type DesignFile, type DesignFolder } from '../../state/designFilesStore'
import { useProjectStore } from '../../state/projectStore'

interface DesignFilesSidebarProps {
  section: string
  onSection: (section: 'canvas' | 'components' | 'design-system' | 'flows' | 'settings') => void
}

export function DesignFilesSidebar({ section, onSection }: DesignFilesSidebarProps) {
  const project = useProjectStore((state) => state.activeProject)
  const sourceStatus = useProjectStore((state) => state.sourceStatus)
  const indexing = useProjectStore((state) => state.indexing)
  const folders = useDesignFilesStore((state) => state.folders)
  const files = useDesignFilesStore((state) => state.files)
  const activeFileId = useDesignFilesStore((state) => state.activeFileId)
  const initialise = useDesignFilesStore((state) => state.initialise)
  const createFile = useDesignFilesStore((state) => state.createFile)
  const createFolder = useDesignFilesStore((state) => state.createFolder)
  const selectFile = useDesignFilesStore((state) => state.selectFile)
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({ product: true, features: true, concepts: true })
  const [query, setQuery] = useState('')
  const [newMenu, setNewMenu] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  useEffect(() => { if (project) initialise(project.id) }, [initialise, project])

  function openFile(fileId: string) {
    selectFile(fileId)
    onSection('canvas')
  }

  function addFile(folderId?: string) {
    const file = createFile(folderId)
    setOpenFolders((value) => ({ ...value, [file.folderId]: true }))
    setNewMenu(false)
    onSection('canvas')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('frameui:rename-design-file', { detail: file.id })), 0)
  }

  function addFolder() {
    const folder = createFolder()
    setOpenFolders((value) => ({ ...value, [folder.id]: true }))
    setNewMenu(false)
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('frameui:rename-design-folder', { detail: folder.id })), 0)
  }

  const visibleFiles = files.filter((file) => !file.archived && (!query || file.name.toLowerCase().includes(query.toLowerCase())))

  return <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-bg-raised">
    <div className="px-3 pb-2 pt-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-text">{project?.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-text-3">
            <span className={`h-1.5 w-1.5 rounded-full ${indexing ? 'animate-pulse bg-accent-2' : sourceStatus === 'warning' ? 'bg-warning' : 'bg-success'}`}/>
            {indexing ? 'Syncing…' : sourceStatus === 'warning' ? 'Sync issue' : 'Synced'}
          </div>
        </div>
        <button type="button" title="Project settings" onClick={() => onSection('settings')} className="flex h-7 w-7 items-center justify-center rounded text-text-3 hover:bg-white/5 hover:text-text"><Settings size={13}/></button>
      </div>
      <div className="mt-3 flex h-7 items-center gap-1.5 rounded border border-border bg-panel px-2">
        <Search size={11} className="text-text-3"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" className="min-w-0 flex-1 bg-transparent text-[10px] text-text outline-none placeholder:text-text-3"/>
      </div>
    </div>

    <div className="flex items-center gap-1 border-y border-border px-2 py-1.5">
      <NavButton active={section === 'canvas'} label="Files" icon={<File size={12}/>} onClick={() => onSection('canvas')}/>
      <NavButton active={section === 'components' || section === 'design-system'} label="Assets" icon={<Component size={12}/>} onClick={() => onSection('components')}/>
      <NavButton active={section === 'flows'} label="Flows" icon={<Map size={12}/>} onClick={() => onSection('flows')}/>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
      {[...folders].sort((a, b) => a.order - b.order).map((folder) => <FolderGroup key={folder.id} folder={folder} files={visibleFiles.filter((file) => file.folderId === folder.id)} open={openFolders[folder.id] ?? true} activeFileId={activeFileId} onToggle={() => setOpenFolders((value) => ({ ...value, [folder.id]: !(value[folder.id] ?? true) }))} onOpenFile={openFile} onAddFile={() => addFile(folder.id)}/>)}
      {files.some((file) => file.archived) && <div className="mt-3 border-t border-border pt-2"><button type="button" onClick={() => setArchiveOpen((value) => !value)} className="flex h-7 w-full items-center gap-2 rounded px-2 text-[9.5px] text-text-3 hover:bg-white/[.03] hover:text-text-2">{archiveOpen ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}<Archive size={11}/>Archive<span className="ml-auto">{files.filter((file) => file.archived).length}</span></button>{archiveOpen && <div className="mt-0.5">{files.filter((file) => file.archived).map((file) => <DesignFileRow key={file.id} file={file} active={false} archived onOpen={() => undefined}/>)}</div>}</div>}
    </div>

    <div className="relative border-t border-border p-2">
      {newMenu && <div className="absolute bottom-11 left-2 right-2 z-50 overflow-hidden rounded-md border border-border-strong bg-[#202228] py-1 shadow-2xl">
        <button type="button" onClick={() => addFile()} className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[10.5px] text-text-2 hover:bg-white/5 hover:text-text"><File size={12}/>Design file<span className="ml-auto text-[8px] text-text-3">empty canvas</span></button>
        <button type="button" onClick={addFolder} className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[10.5px] text-text-2 hover:bg-white/5 hover:text-text"><FolderPlus size={12}/>Folder</button>
      </div>}
      <button type="button" onClick={() => setNewMenu((value) => !value)} className="flex h-8 w-full items-center justify-center gap-2 rounded bg-accent text-[10.5px] font-semibold text-white hover:bg-accent-2"><Plus size={13}/>New</button>
    </div>
  </aside>
}

function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-[9px] ${active ? 'bg-white/[.07] text-text' : 'text-text-3 hover:text-text-2'}`}>{icon}{label}</button>
}

function FolderGroup({ folder, files, open, activeFileId, onToggle, onOpenFile, onAddFile }: { folder: DesignFolder; files: DesignFile[]; open: boolean; activeFileId: string; onToggle: () => void; onOpenFile: (id: string) => void; onAddFile: () => void }) {
  const renameFolder = useDesignFilesStore((state) => state.renameFolder)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.name)
  useEffect(() => { const listener = (event: Event) => { if ((event as CustomEvent).detail === folder.id) setEditing(true) }; window.addEventListener('frameui:rename-design-folder', listener); return () => window.removeEventListener('frameui:rename-design-folder', listener) }, [folder.id])
  function commit() { renameFolder(folder.id, name); setEditing(false) }
  return <div className="mb-2">
    <div className="group flex h-7 items-center gap-1 rounded px-1 text-text-3 hover:bg-white/[.025]">
      <button type="button" onClick={onToggle} className="flex h-6 w-5 items-center justify-center">{open ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}</button>
      <Folder size={11}/>
      {editing ? <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit() }} className="min-w-0 flex-1 bg-transparent text-[9px] font-semibold uppercase tracking-[.1em] text-text outline-none"/> : <button type="button" onDoubleClick={() => setEditing(true)} onClick={onToggle} className="min-w-0 flex-1 truncate text-left text-[9px] font-semibold uppercase tracking-[.1em]">{folder.name}</button>}
      <button type="button" title={`New file in ${folder.name}`} onClick={onAddFile} className="hidden h-5 w-5 items-center justify-center rounded hover:bg-white/5 group-hover:flex"><Plus size={10}/></button>
    </div>
    {open && <div className="mt-0.5">{files.map((file) => <DesignFileRow key={file.id} file={file} active={file.id === activeFileId} onOpen={() => onOpenFile(file.id)}/>)}{files.length === 0 && <div className="px-7 py-1 text-[8.5px] text-text-3">No files</div>}</div>}
  </div>
}

function DesignFileRow({ file, active, archived = false, onOpen }: { file: DesignFile; active: boolean; archived?: boolean; onOpen: () => void }) {
  const folders = useDesignFilesStore((state) => state.folders)
  const renameFile = useDesignFilesStore((state) => state.renameFile)
  const duplicateFile = useDesignFilesStore((state) => state.duplicateFile)
  const toggleStar = useDesignFilesStore((state) => state.toggleStar)
  const archiveFile = useDesignFilesStore((state) => state.archiveFile)
  const deleteFile = useDesignFilesStore((state) => state.deleteFile)
  const moveFile = useDesignFilesStore((state) => state.moveFile)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(file.name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const listener = (event: Event) => { if ((event as CustomEvent).detail === file.id) setEditing(true) }; window.addEventListener('frameui:rename-design-file', listener); return () => window.removeEventListener('frameui:rename-design-file', listener) }, [file.id])
  useEffect(() => { if (editing) input.current?.select() }, [editing])
  function commit() { renameFile(file.id, name); setEditing(false) }
  return <div className="relative group/file">
    <button type="button" onClick={onOpen} onDoubleClick={() => file.kind === 'design' && setEditing(true)} className={`flex h-7 w-full items-center gap-2 rounded px-2 text-left ${active ? 'bg-accent/15 text-text' : 'text-text-2 hover:bg-white/[.04] hover:text-text'} ${archived ? 'opacity-60' : ''}`}>
      {file.kind === 'source' ? <GitBranch size={11} className="shrink-0 text-success"/> : <File size={11} className="shrink-0 text-text-3"/>}
      {editing ? <input ref={input} value={name} onClick={(event) => event.stopPropagation()} onChange={(event) => setName(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') setEditing(false) }} className="min-w-0 flex-1 bg-transparent text-[10px] outline-none"/> : <span className="min-w-0 flex-1 truncate text-[10px]">{file.name}</span>}
      {file.starred && <Star size={9} className="fill-warning text-warning"/>}
    </button>
    {file.kind === 'design' && <button type="button" onClick={(event) => { event.stopPropagation(); setMenu((value) => !value) }} className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded bg-bg-raised text-text-3 group-hover/file:flex"><MoreHorizontal size={11}/></button>}
    {menu && <div className="absolute right-1 top-7 z-50 w-40 overflow-hidden rounded border border-border-strong bg-[#24262c] py-1 shadow-xl">
      {!archived && <><MenuItem label="Rename" onClick={() => { setMenu(false); setEditing(true) }}/><MenuItem label="Duplicate" onClick={() => { duplicateFile(file.id); setMenu(false) }}/><MenuItem label={file.starred ? 'Unstar' : 'Star'} onClick={() => { toggleStar(file.id); setMenu(false) }}/>{folders.filter((folder) => folder.id !== file.folderId).map((folder) => <MenuItem key={folder.id} label={`Move to ${folder.name}`} onClick={() => { moveFile(file.id, folder.id); setMenu(false) }}/>)}</>}
      <MenuItem label={archived ? 'Restore' : 'Archive'} onClick={() => { archiveFile(file.id); setMenu(false) }}/><MenuItem danger label="Delete" icon={<Trash2 size={10}/>} onClick={() => { if (window.confirm(`Delete “${file.name}”? This removes the design file and its canvas.`)) deleteFile(file.id); setMenu(false) }}/>
    </div>}
  </div>
}

function MenuItem({ label, icon, danger, onClick }: { label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[9.5px] hover:bg-white/5 ${danger ? 'text-danger' : 'text-text-2'}`}>{icon}{label}</button>
}
