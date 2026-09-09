import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CircleAlert,
  Command,
  Component as ComponentIcon,
  FileStack,
  FolderOpen,
  Download,
  HelpCircle,
  Layers3,
  Map,
  Palette,
  Plus,
  Play,
  RefreshCw,
  ScanEye,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  GitCompareArrows,
  Sparkles,
} from 'lucide-react'
import type { RecentProject } from '@shared/types/project'
import { useProjectStore } from '../../state/projectStore'
import { useWorkspaceStore } from '../../state/workspaceStore'
import { useUiStore, type ShellSection } from '../../state/uiStore'
import { useFlowStore } from '../../state/flowStore'
import { FrameMark, ChevronRightIcon } from '../../components/icons/icons'
import { formatRelativeTime } from '../../lib/formatRelativeTime'
import { FeaturesSection } from './sections/FeaturesSection'
import { OverviewSection } from './sections/OverviewSection'
import { ScreensSection } from './sections/ScreensSection'
import { FlowsSection } from './sections/FlowsSection'
import { ComponentsSection } from './sections/ComponentsSection'
import { DesignSystemSection } from './sections/DesignSystemSection'
import { SettingsSection } from './sections/SettingsSection'
import { CapturesSection } from './sections/CapturesSection'
import { ReviewSection } from './sections/ReviewSection'
import { ChangesSection } from './sections/ChangesSection'

interface NavItem {
  section: ShellSection | null
  label: string
  icon: typeof Layers3
  disabled?: boolean
}

// Features first (spec Phase 6: the primary unit of design work and the
// main project experience) — "Project" (repo statistics/structure
// browsing) demoted to one click away rather than the landing section.
const NAV_ITEMS: NavItem[] = [
  { section: 'features', label: 'Features', icon: Sparkles },
  { section: 'overview', label: 'Project', icon: Layers3 },
  { section: 'screens', label: 'Screens', icon: FileStack },
  { section: 'flows', label: 'Journeys', icon: Map },
  { section: 'components', label: 'Components', icon: ComponentIcon },
  { section: 'design-system', label: 'Design System', icon: Palette },
  { section: 'captures', label: 'Captures', icon: ScanEye },
  { section: 'review', label: 'Review', icon: ShieldCheck },
  { section: 'changes', label: 'Changes', icon: GitCompareArrows },
]

function compactPath(projectPath: string): string {
  const segments = projectPath.split(/[\\/]/).filter(Boolean)
  return segments.length > 3 ? `…/${segments.slice(-3).join('/')}` : projectPath
}

export function WorkspaceShellView({ children }: { children?: ReactNode }) {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const indexing = useProjectStore((s) => s.indexing)
  const fetchIndex = useProjectStore((s) => s.fetchIndex)
  const reindex = useProjectStore((s) => s.reindex)
  const section = useUiStore((s) => s.section)
  const setSection = useUiStore((s) => s.setSection)
  const setView = useUiStore((s) => s.setView)
  const setSelectedScreenId = useUiStore((s) => s.setSelectedScreenId)
  const flowSummaries = useFlowStore((s) => s.summaries)
  const loadFlowSummaries = useFlowStore((s) => s.loadSummaries)
  const activeFlow = useFlowStore((s) => s.activeFlow)
  const recentProjects = useWorkspaceStore((s) => s.recentProjects)
  const refreshRecents = useWorkspaceStore((s) => s.refresh)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandFocused, setCommandFocused] = useState(false)
  const [appRunning, setAppRunning] = useState(false)
  const [startingApp, setStartingApp] = useState(false)
  const commandInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshRecents()
  }, [refreshRecents])

  useEffect(() => {
    if (activeProject) void fetchIndex()
  }, [activeProject, fetchIndex])

  useEffect(() => {
    if (activeProject) void loadFlowSummaries(activeProject.id)
  }, [activeProject, loadFlowSummaries])

  useEffect(() => {
    if (!activeProject) return
    return window.frameui.project.onFileChanged(() => void reindex())
  }, [activeProject, reindex])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'p' || event.key === 'k')) {
        event.preventDefault()
        commandInput.current?.focus()
      }
      if (event.key === 'Escape') {
        setCommandQuery('')
        commandInput.current?.blur()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => window.frameui.preview.onStatus(({ status }) => setAppRunning(status === 'running')), [])

  useEffect(() => window.frameui.project.onIndexProgress(({ step }) => useProjectStore.getState().recordProgressStep(step)), [])

  function enterProject(project: RecentProject) {
    useProjectStore.getState().setActiveProject(project)
    setSection('features')
    useUiStore.getState().setView('workspace')
    setCommandQuery('')
  }

  async function openFolder(relinkId?: string) {
    const result = await window.frameui.project.openDialog(relinkId)
    if (!result.cancelled) enterProject(result.project)
    await refreshRecents()
  }

  async function openRecent(project: RecentProject) {
    if (project.missing) {
      await openFolder(project.id)
      return
    }
    const result = await window.frameui.project.openPath(project.path)
    if (result.ok) enterProject(result.project)
    await refreshRecents()
  }

  function goToSection(nextSection: ShellSection) {
    setSection(nextSection)
    if (children) setView('workspace')
  }

  function openScreenFromSearch(screenId: string) {
    setSelectedScreenId(screenId)
    goToSection('screens')
    setCommandQuery('')
  }

  async function runApplication() {
    setStartingApp(true)
    try {
      const result = await window.frameui.preview.start()
      if (result.ok) setAppRunning(true)
    } finally {
      setStartingApp(false)
    }
  }

  const commandResults = useMemo(() => {
    const query = commandQuery.trim().toLowerCase()
    if (!query) return []
    const sections = NAV_ITEMS.filter((item) => item.section && !item.disabled && (activeProject || item.section === 'overview'))
      .filter((item) => item.label.toLowerCase().includes(query))
      .map((item) => ({ label: `Go to ${item.label}`, detail: 'Command', action: () => goToSection(item.section!) }))
    const projects = recentProjects
      .filter((project) => project.name.toLowerCase().includes(query) || project.path.toLowerCase().includes(query))
      .map((project) => ({ label: project.name, detail: compactPath(project.path), action: () => void openRecent(project) }))
    const model = activeIndex?.projectModel
    const screens = (model?.pages ?? []).filter((screen) => [screen.name, screen.route ?? '', screen.source.filePath, ...screen.textContent].some((value) => value.toLowerCase().includes(query))).map((screen) => ({ label: screen.name, detail: `Screen · ${screen.route ?? screen.source.filePath}`, action: () => openScreenFromSearch(screen.id) }))
    const components = (model?.components ?? []).filter((component) => component.name.toLowerCase().includes(query) || component.source.filePath.toLowerCase().includes(query)).map((component) => ({ label: component.name, detail: `Component · ${component.source.filePath}`, action: () => { goToSection('components'); setCommandQuery('') } }))
    const tokens = activeIndex ? activeIndex.projectModel.tokens.filter((token) => token.name.toLowerCase().includes(query) || token.value.toLowerCase().includes(query)).map((token) => ({ label: token.name, detail: `Token · ${token.value}`, action: () => { goToSection('design-system'); setCommandQuery('') } })) : []
    return [...sections, ...screens, ...components, ...tokens, ...projects].slice(0, 10)
    // openRecent intentionally resolves against current store state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, activeIndex, commandQuery, recentProjects, children, setSection, setView, setSelectedScreenId])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
      <header className="app-drag-region relative flex h-12 shrink-0 items-center border-b border-border bg-bg-raised px-3.5">
        <div className="flex min-w-[240px] items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white shadow-[0_0_0_1px_rgb(255_255_255/0.14)_inset]">
            <FrameMark className="h-3.5 w-3.5" />
          </div>
          <span className="text-[13px] font-semibold text-text">FrameUI</span>
          <ChevronRightIcon className="h-3 w-3 text-text-3" />
          <span className="max-w-40 truncate font-mono text-[11.5px] text-text-2">{activeProject?.name ?? 'No project open'}</span>
          {activeProject && <><ChevronRightIcon className="h-3 w-3 text-text-3" /><span className="text-[11px] text-text-3">{NAV_ITEMS.find((item) => item.section === section)?.label ?? 'Workspace'}</span></>}
        </div>

        <div className="app-no-drag absolute left-1/2 w-[min(520px,42vw)] -translate-x-1/2">
          <div className={`relative flex h-8 items-center gap-2 rounded-md border bg-panel px-2.5 ${commandFocused ? 'border-accent/60 shadow-[0_0_0_2px_rgb(124_106_242/0.12)]' : 'border-border'}`}>
            <Search size={13} className="shrink-0 text-text-3" />
            <input ref={commandInput} value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} onFocus={() => setCommandFocused(true)} onBlur={() => window.setTimeout(() => setCommandFocused(false), 120)} placeholder="Search projects or commands" className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-3" />
            <span className="flex items-center gap-0.5 rounded border border-border px-1 py-0.5 font-mono text-[9px] text-text-3"><Command size={9} />P</span>
          </div>
          {commandFocused && commandQuery && (
            <div className="absolute left-0 right-0 top-9 z-50 overflow-hidden rounded-md border border-border-strong bg-panel shadow-2xl">
              {commandResults.length ? commandResults.map((result) => (
                <button key={`${result.detail}:${result.label}`} type="button" onMouseDown={(event) => event.preventDefault()} onClick={result.action} className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-0 hover:bg-white/[0.04]">
                  <span className="text-[12px] text-text">{result.label}</span><span className="max-w-56 truncate font-mono text-[10px] text-text-3">{result.detail}</span>
                </button>
              )) : <div className="px-3 py-3 text-[11.5px] text-text-3">No matching projects or commands.</div>}
            </div>
          )}
        </div>

        <div className="app-no-drag ml-auto flex items-center gap-1">
          {activeProject && <>
            <button type="button" onClick={() => void runApplication()} disabled={startingApp || appRunning} className="flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[10.5px] text-text-2 hover:bg-white/5 hover:text-text disabled:opacity-60"><Play size={12} className={appRunning ? 'fill-green-400 text-green-400' : ''} />{appRunning ? 'Running' : startingApp ? 'Starting…' : 'Run App'}</button>
            <button type="button" onClick={() => void reindex()} disabled={indexing} className="flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[10.5px] text-text-2 hover:bg-white/5 hover:text-text disabled:opacity-60"><RefreshCw size={12} className={indexing ? 'animate-spin' : ''} />Sync</button>
            <button type="button" title={activeFlow ? 'Export current journey' : 'Open a journey before exporting'} disabled={!activeFlow} onClick={() => setView('export')} className="flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[10.5px] text-text-2 hover:bg-white/5 hover:text-text disabled:opacity-30"><Download size={12} />Export</button>
            <span className="mx-1 h-4 w-px bg-border" />
          </>}
          <button type="button" title="Help" className="flex h-8 w-8 items-center justify-center rounded text-text-3 hover:bg-white/5 hover:text-text-2"><HelpCircle size={16} /></button>
          <button type="button" title="Settings" disabled={!activeProject} onClick={() => goToSection('settings')} className="flex h-8 w-8 items-center justify-center rounded text-text-3 hover:bg-white/5 hover:text-text-2 disabled:opacity-30"><SettingsIcon size={16} /></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ActivityRail activeProject={!!activeProject} section={section} onSelect={goToSection} />
        {children && activeProject ? (
          <div className="flex min-w-0 flex-1">{children}</div>
        ) : !activeProject ? (
          <StartWorkspace recentProjects={recentProjects} onOpenFolder={openFolder} onOpenRecent={openRecent} />
        ) : (
          <div className="flex min-h-0 flex-1">
            {section === 'features' && <FeaturesSection />}
            {section === 'overview' && <ProjectSidebar project={activeProject} recentProjects={recentProjects} indexing={indexing} onOpenFolder={openFolder} onOpenRecent={openRecent} />}
            {section === 'overview' && <OverviewSection />}
            {section === 'screens' && <ScreensSection />}
            {section === 'flows' && <FlowsSection flowSummaries={flowSummaries} />}
            {section === 'components' && <ComponentsSection />}
            {section === 'design-system' && <DesignSystemSection />}
            {section === 'captures' && <CapturesSection />}
            {section === 'review' && <ReviewSection />}
            {section === 'changes' && <ChangesSection />}
            {section === 'settings' && <SettingsSection />}
          </div>
        )}
      </div>

      <StatusBar indexing={indexing} activeProject={activeProject} activeIndex={activeIndex} />
    </div>
  )
}

function ActivityRail({ activeProject, section, onSelect }: { activeProject: boolean; section: ShellSection; onSelect: (section: ShellSection) => void }) {
  return (
    <nav aria-label="Workspace" className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-border bg-bg-raised py-2">
      <div className="flex flex-col items-center gap-0.5">
        {NAV_ITEMS.map(({ section: itemSection, label, icon: Icon, disabled }) => {
          const unavailable = disabled || (!activeProject && itemSection !== 'overview')
          return <button key={label} type="button" title={unavailable && !disabled ? `${label} — open a project first` : label} disabled={unavailable} onClick={() => itemSection && onSelect(itemSection)} className={`relative flex h-10 w-10 items-center justify-center rounded ${itemSection === section && (!activeProject ? itemSection === 'overview' : true) ? 'bg-accent/12 text-accent-2 before:absolute before:-left-1 before:h-5 before:w-0.5 before:rounded-r before:bg-accent-2' : 'text-text-3 hover:bg-white/5 hover:text-text-2 disabled:cursor-default disabled:opacity-25'}`}><Icon size={18} strokeWidth={1.65} /></button>
        })}
      </div>
      <button type="button" title={activeProject ? 'Settings' : 'Settings — open a project first'} disabled={!activeProject} onClick={() => onSelect('settings')} className={`flex h-10 w-10 items-center justify-center rounded text-text-3 hover:bg-white/5 hover:text-text-2 disabled:opacity-25 ${section === 'settings' && activeProject ? 'bg-accent/12 text-accent-2' : ''}`}><SettingsIcon size={18} strokeWidth={1.65} /></button>
    </nav>
  )
}

function StartWorkspace({ recentProjects, onOpenFolder, onOpenRecent }: { recentProjects: RecentProject[]; onOpenFolder: (relinkId?: string) => Promise<void>; onOpenRecent: (project: RecentProject) => Promise<void> }) {
  return (
    <div className="flex min-w-0 flex-1">
      <ProjectsSidebar recentProjects={recentProjects} onOpenFolder={onOpenFolder} onOpenRecent={onOpenRecent} />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="flex h-9 shrink-0 items-end border-b border-border bg-bg-raised px-1.5"><div className="flex h-8 items-center gap-2 border-x border-t border-border bg-bg px-3 text-[11.5px] text-text"><FileStack size={13} className="text-accent-2" />Start</div></div>
        <div className="flex-1 overflow-y-auto px-12 py-10">
          <div className="max-w-[860px]">
            <h1 className="text-[28px] font-semibold tracking-[-0.45px] text-text">Start</h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-2">Open a local project and FrameUI will inspect its pages, components, styles and design structure.</p>
            <button type="button" onClick={() => void onOpenFolder()} className="mt-5 inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-accent-2"><FolderOpen size={15} />Open project</button>

            <section className="mt-10">
              <div className="mb-2 border-b border-border pb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Recent projects</div>
              {recentProjects.length === 0 ? <div className="py-5 text-[12.5px] text-text-3">No local workspaces opened yet.</div> : recentProjects.map((project) => <RecentWorkspaceRow key={project.id} project={project} onOpen={() => void onOpenRecent(project)} />)}
            </section>

            <section className="mt-9">
              <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Getting started</div>
              <div className="grid max-w-xl grid-cols-2 gap-x-10 gap-y-2 text-[12.5px] text-text-2">{['Open repository', 'Scan interface', 'Review pages and components', 'Build design workspace'].map((item, index) => <div key={item} className="flex items-center gap-2"><span className="font-mono text-[10px] text-text-3">0{index + 1}</span>{item}</div>)}</div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

function ProjectsSidebar({ recentProjects, onOpenFolder, onOpenRecent }: { recentProjects: RecentProject[]; onOpenFolder: (relinkId?: string) => Promise<void>; onOpenRecent: (project: RecentProject) => Promise<void> }) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-bg-raised">
      <div className="flex h-10 items-center px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Projects</div>
      <button type="button" onClick={() => void onOpenFolder()} className="mx-2 flex h-8 items-center gap-2 rounded px-2 text-left text-[12px] text-text-2 hover:bg-white/5 hover:text-text"><Plus size={14} />Open project</button>
      <div className="mb-1 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">Recent</div>
      <div className="overflow-y-auto px-1.5">{recentProjects.map((project) => <SidebarProjectRow key={project.id} project={project} onOpen={() => void onOpenRecent(project)} />)}</div>
    </aside>
  )
}

function ProjectSidebar({ project, recentProjects, indexing, onOpenFolder, onOpenRecent }: { project: RecentProject; recentProjects: RecentProject[]; indexing: boolean; onOpenFolder: (relinkId?: string) => Promise<void>; onOpenRecent: (project: RecentProject) => Promise<void> }) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-bg-raised">
      <div className="flex h-10 items-center px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Project</div>
      <div className="mx-1.5 border-y border-border bg-white/[0.025] px-2.5 py-2.5">
        <div className="flex items-center gap-2 text-[12.5px] font-medium text-text"><FolderOpen size={14} className="text-accent-2" />{project.name}</div>
        <div className="mt-1 truncate font-mono text-[10px] text-text-3" title={project.path}>{compactPath(project.path)}</div>
        {indexing && <div className="mt-2 flex items-center gap-2 text-[10.5px] text-accent-2"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-2" />Scanning project…</div>}
      </div>
      <button type="button" onClick={() => void onOpenFolder()} className="mx-2 mt-2 flex h-8 items-center gap-2 rounded px-2 text-left text-[12px] text-text-2 hover:bg-white/5 hover:text-text"><Plus size={14} />Open another project</button>
      <div className="mb-1 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">Recent</div>
      <div className="overflow-y-auto px-1.5">{recentProjects.filter((item) => item.id !== project.id).map((item) => <SidebarProjectRow key={item.id} project={item} onOpen={() => void onOpenRecent(item)} />)}</div>
    </aside>
  )
}

function SidebarProjectRow({ project, onOpen }: { project: RecentProject; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="group flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-white/[0.04]">{project.missing ? <CircleAlert size={13} className="mt-0.5 shrink-0 text-danger" /> : <FolderOpen size={13} className="mt-0.5 shrink-0 text-text-3" />}<span className="min-w-0 flex-1"><span className="block truncate text-[12px] text-text-2 group-hover:text-text">{project.name}</span><span className={`mt-0.5 block truncate font-mono text-[9.5px] ${project.missing ? 'text-danger/75' : 'text-text-3'}`}>{project.missing ? 'Missing folder · Locate' : compactPath(project.path)}</span></span></button>
}

function RecentWorkspaceRow({ project, onOpen }: { project: RecentProject; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="group grid w-full grid-cols-[minmax(140px,1fr)_140px_minmax(180px,1.5fr)_90px] items-center gap-4 border-b border-border px-1 py-2.5 text-left hover:bg-white/[0.025]"><span className="flex min-w-0 items-center gap-2 truncate text-[12.5px] font-medium text-text"><FolderOpen size={13} className="shrink-0 text-text-3" />{project.name}</span><span className="text-[11px] text-text-3">{project.missing ? <span className="text-danger">Missing folder</span> : 'Local project'}</span><span className="truncate font-mono text-[10.5px] text-text-3" title={project.path}>{compactPath(project.path)}</span><span className={`text-right text-[11px] ${project.missing ? 'font-semibold text-accent-2' : 'text-text-3'}`}>{project.missing ? 'Locate' : formatRelativeTime(project.lastOpenedAt)}</span></button>
}

function StatusBar({ indexing, activeProject, activeIndex }: { indexing: boolean; activeProject: RecentProject | null; activeIndex: ReturnType<typeof useProjectStore.getState>['activeIndex'] }) {
  const [version, setVersion] = useState('0.1.0')
  const setSection = useUiStore((s) => s.setSection)
  const setView = useUiStore((s) => s.setView)
  useEffect(() => { void window.frameui.app.getVersion().then(setVersion) }, [])
  function openSection(section: 'review' | 'changes') { setSection(section); setView('workspace') }
  return <footer className="flex h-[26px] shrink-0 items-center gap-4 border-t border-border bg-bg-raised px-3 font-mono text-[10px] text-text-3"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" />Local workspace</span><span>{activeProject?.name ?? 'No project'}</span><span>{indexing ? 'Analysing…' : activeIndex ? 'Project ready' : 'Scanner idle'}</span>{activeIndex && <><span>Render {activeIndex.projectModel.statistics.renderIssues ? `${activeIndex.projectModel.statistics.renderIssues} issues` : 'ready'}</span><button type="button" onClick={() => openSection('review')} className="hover:text-text">Warnings {activeIndex.projectModel.statistics.issues}</button><button type="button" onClick={() => openSection('changes')} className="hover:text-text">Changes 0</button><span>Console</span></>}<span className="ml-auto">FrameUI v{version}</span></footer>
}
