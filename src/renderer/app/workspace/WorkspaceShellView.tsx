import { PreparationDialog } from '../../components/project/PreparationDialog'
import { subscribeLocalApplication, useLocalApplicationStore } from '../../state/localApplicationStore'
import { ProjectProgressModal } from '../../components/project/ProjectProgressModal'
import { AppearancePicker } from '../../components/shell/Appearance'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CircleAlert,
  Command,
  Component as ComponentIcon,
  FileStack,
  Layers3,
  Map,
  Palette,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  PenTool,
  Home,
  X,
} from 'lucide-react'
import type { RecentProject } from '@shared/types/project'
import { useProjectStore } from '../../state/projectStore'
import { useWorkspaceStore } from '../../state/workspaceStore'
import { useUiStore, type ShellSection } from '../../state/uiStore'
import { useFlowStore } from '../../state/flowStore'
import { FrameMark, ChevronRightIcon } from '../../components/icons/icons'
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
import { useFeatureStore } from '../../state/featureStore'
import { flushPendingDesignSaves, useDesignStore } from '../../state/designStore'
import { VisualCanvasSection } from './sections/VisualCanvasSection'
import { ProjectHome } from './ProjectHome'
import { LocalEnvironmentSection } from './sections/LocalEnvironmentSection'
import { StartWorkspace } from './StartWorkspace'
import { DesignFilesSidebar } from '../../components/project/DesignFilesSidebar'
import { useDesignFilesStore } from '../../state/designFilesStore'

interface NavItem {
  section: ShellSection | null
  label: string
  icon: typeof Layers3
  disabled?: boolean
}

// The canvas is the product center: repository pages/components feed it,
// while Features and Journeys remain the workflow layer around the work.
const NAV_ITEMS: NavItem[] = [
  { section: 'start', label: 'Projects', icon: Home },
  { section: 'project-home', label: 'Project Home', icon: Home },
  { section: 'canvas', label: 'Canvas', icon: PenTool },
  { section: 'features', label: 'Features', icon: Sparkles },
  { section: 'overview', label: 'Application', icon: Layers3 },
  { section: 'screens', label: 'Pages', icon: FileStack },
  { section: 'components', label: 'Components', icon: ComponentIcon },
  { section: 'design-system', label: 'Design System', icon: Palette },
  { section: 'flows', label: 'Journeys', icon: Map },
  { section: 'review', label: 'Review', icon: ShieldCheck },
  { section: 'changes', label: 'Problems', icon: CircleAlert },
]

function compactPath(projectPath: string): string {
  const segments = projectPath.split(/[\\/]/).filter(Boolean)
  return segments.length > 3 ? `…/${segments.slice(-3).join('/')}` : projectPath
}

export function WorkspaceShellView({ children }: { children?: ReactNode }) {
  const localPhase = useLocalApplicationStore(s => s.phase)
  useEffect(() => subscribeLocalApplication(), [])
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const fetchIndex = useProjectStore((s) => s.fetchIndex)
  const handleFileChange = useProjectStore((s) => s.handleFileChange)
  const section = useUiStore((s) => s.section)
  const setSection = useUiStore((s) => s.setSection)
  const setView = useUiStore((s) => s.setView)
  const setSelectedScreenId = useUiStore((s) => s.setSelectedScreenId)
  const goBack = useUiStore((s) => s.goBack)
  const goForward = useUiStore((s) => s.goForward)
  const canGoBack = useUiStore((s) => s.sectionHistory.length > 0)
  const canGoForward = useUiStore((s) => s.sectionFuture.length > 0)
  const flowSummaries = useFlowStore((s) => s.summaries)
  const loadFlowSummaries = useFlowStore((s) => s.loadSummaries)
  const features = useFeatureStore((s) => s.features)
  const loadFeatures = useFeatureStore((s) => s.loadFeatures)
  const recentProjects = useWorkspaceStore((s) => s.recentProjects)
  const refreshRecents = useWorkspaceStore((s) => s.refresh)
  const designFiles = useDesignFilesStore((s) => s.files)
  const activeDesignFileId = useDesignFilesStore((s) => s.activeFileId)
  const activeDesignFile = designFiles.find((file) => file.id === activeDesignFileId)
  const editor = section === 'canvas' || !!children
  const library = !activeProject || section === 'start'
  const [openingProject, setOpeningProject] = useState(false)
  const openingRef = useRef(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandFocused, setCommandFocused] = useState(false)
  const [, setAppRunning] = useState(false)
  const [appError, setAppError] = useState<string | null>(null)
  const commandInput = useRef<HTMLInputElement>(null)
  const restoredProject = useRef<string | null>(null)

  useEffect(() => {
    const failed = (event: Event) => setAppError(`Changes could not be saved: ${(event as CustomEvent<string>).detail}`)
    window.addEventListener('frameui:save-error', failed)
    return () => window.removeEventListener('frameui:save-error', failed)
  }, [])

  useEffect(() => {
    void refreshRecents()
  }, [refreshRecents])

  useEffect(() => window.frameui.project.onIndexProgress(({ step }) => useProjectStore.getState().recordProgressStep(step)), [])

  useEffect(() => {
    if (activeProject) void useLocalApplicationStore.getState().inspect(activeProject.id, true)
    else useLocalApplicationStore.getState().reset()
  }, [activeProject])

  useEffect(() => {
    if (activeProject) void fetchIndex()
  }, [activeProject, fetchIndex])

  useEffect(() => {
    if (activeProject) { void loadFlowSummaries(activeProject.id); void loadFeatures(activeProject.id) }
  }, [activeProject, loadFlowSummaries, loadFeatures])

  useEffect(() => {
    if (!activeProject || restoredProject.current === activeProject.id) return
    restoredProject.current = activeProject.id
    useDesignFilesStore.getState().initialise(activeProject.id)
    localStorage.setItem('frameui:last-project:v1', activeProject.path)
  }, [activeProject, setSection])

  useEffect(() => {
    if (activeProject) {
      const previous = localStorage.getItem(`frameui:session:${activeProject.id}`)
      let value: Record<string, unknown> = {}
      try { value = previous ? JSON.parse(previous) as Record<string, unknown> : {} } catch { /* replace corrupt UI state */ }
      localStorage.setItem('frameui:last-session:v1', JSON.stringify({ path: activeProject.path, section }))
      localStorage.setItem(`frameui:session:${activeProject.id}`, JSON.stringify({ ...value, section, applicationId: activeIndex?.activeApplicationId ?? null }))
    }
  }, [activeIndex?.activeApplicationId, activeProject, section])

  useEffect(() => {
    if (!activeProject) return
    return window.frameui.project.onFileChanged((notice) => void handleFileChange(notice))
  }, [activeProject, handleFileChange])

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

  useEffect(() => window.frameui.preview.onStatus(({ status, detail }) => {
    setAppRunning(status === 'running')
    if (status === 'error') setAppError(detail ?? 'The application could not be started.')
    else if (status === 'running') setAppError(null)
  }), [])

  function enterProject(project: RecentProject) {
    useUiStore.setState({ sectionHistory: [], sectionFuture: [], activeFeatureId: null, activeJourneyId: null, activeSharePreviewId: null, selectedScreenId: null })
    useDesignStore.getState().closeScreen()
    useDesignFilesStore.getState().initialise(project.id)
    useProjectStore.getState().setActiveProject(project)
    setSection('environment')
    useUiStore.getState().setView('workspace')
    setCommandQuery('')
  }

  async function openProjectAction(action: () => Promise<void>) {
    if (openingRef.current || useProjectStore.getState().indexing) return
    openingRef.current = true
    setOpeningProject(true)
    setOpenError(null)
    try {
      await flushPendingDesignSaves()
      await action()
      await refreshRecents()
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error))
    } finally {
      openingRef.current = false
      setOpeningProject(false)
    }
  }

  async function openFolder(relinkId?: string) {
    await openProjectAction(async () => {
      const result = await window.frameui.project.openDialog(relinkId)
      if (!result.cancelled) {
        enterProject(result.project)
        await useProjectStore.getState().fetchIndex()
      }
    })
  }

  async function openRecent(project: RecentProject) {
    if (project.missing) { await openFolder(project.id); return }
    await openProjectAction(async () => {
      const result = await window.frameui.project.openPath(project.path)
      if (result.ok) {
        enterProject(result.project)
        await useProjectStore.getState().fetchIndex()
      }
      else throw new Error('Project folder not found. Relink the folder to open it.')
    })
  }

  async function closeProject() {
    await flushPendingDesignSaves()
    localStorage.removeItem('frameui:last-session:v1')
    await useProjectStore.getState().closeProject()
    useDesignStore.getState().closeScreen()
    setSection('start')
    setView('workspace')
    await refreshRecents()
  }

  function handleProjectRemoved(projectId: string) {
    localStorage.removeItem(`frameui:session:${projectId}`)
    localStorage.removeItem(`frameui:visual-canvas:${projectId}:v1`)
    if (activeProject?.id === projectId) {
      useProjectStore.setState({ activeProject: null, activeIndex: null, sourceStatus: 'idle', sourceNotice: null })
      useDesignStore.getState().closeScreen()
      setSection('start')
    }
    void refreshRecents()
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

  const commandResults = useMemo(() => {
    const query = commandQuery.trim().toLowerCase()
    const commands = [
      { label: 'Open Project', detail: 'Project command', action: () => { setCommandQuery(''); void openFolder() } },
      { label: 'Open Recent Project', detail: 'Project command', action: () => { goToSection('start'); setCommandQuery('') } },
      { label: 'Show All Projects', detail: 'Project command', action: () => { localStorage.setItem('frameui:project-library:section', 'all'); goToSection('start'); window.dispatchEvent(new CustomEvent('frameui:show-projects', { detail: 'all' })); setCommandQuery('') } },
      { label: 'Return to Start', detail: 'Project command', action: () => { goToSection('start'); setCommandQuery('') } },
      { label: 'Close Project', detail: 'Project command', action: () => { setCommandQuery(''); void closeProject() } },
      { label: 'Reveal Project Folder', detail: 'Project command', action: () => { if (activeProject) void window.frameui.project.reveal(activeProject.id); setCommandQuery('') } },
      { label: 'Refresh Project Index', detail: 'Project command', action: () => { if (activeProject) void useProjectStore.getState().reindex(); setCommandQuery('') } },
      { label: 'Remove Project', detail: 'Remove from FrameUI only', action: () => { if (activeProject && window.confirm(`Remove ${activeProject.name} from FrameUI? The repository will not be deleted.`)) void flushPendingDesignSaves().then(() => window.frameui.project.removeFromFrameUi(activeProject.id)).then(() => handleProjectRemoved(activeProject.id)); setCommandQuery('') } },
      { label: 'New design file', detail: 'Create an empty canvas', action: () => { useDesignFilesStore.getState().createFile(); goToSection('canvas'); setCommandQuery('') } },
      { label: 'New folder', detail: 'Organise design files', action: () => { useDesignFilesStore.getState().createFolder(); setCommandQuery('') } },
      { label: 'Open Canvas', detail: 'Command', action: () => goToSection('canvas') },
      { label: 'Open Features', detail: 'Command', action: () => goToSection('features') },
      { label: 'Open Application', detail: 'Command', action: () => goToSection('overview') },
      { label: 'Open Pages', detail: 'Command', action: () => goToSection('screens') },
      { label: 'Find Component', detail: 'Command', action: () => goToSection('components') },
      { label: 'Open Design System', detail: 'Command', action: () => goToSection('design-system') },
      { label: 'Open Journey', detail: 'Command', action: () => goToSection('flows') },
      { label: 'Open Review', detail: 'Command', action: () => goToSection('review') },
      { label: 'Open Problems', detail: 'Command', action: () => goToSection('changes') },
      { label: 'Open Project Settings', detail: 'Command', action: () => goToSection('settings') },
      { label: 'Rebuild Project Index', detail: 'Recovery command', action: () => { goToSection('settings'); setCommandQuery('') } },
    ]
    if (!query) return (activeProject ? commands : commands.filter((command) => ['Open Project', 'Open Recent Project', 'Show All Projects'].includes(command.label))).slice(0, 8)
    const sections = NAV_ITEMS.filter((item) => item.section && !item.disabled && (activeProject || item.section === 'start'))
      .filter((item) => item.label.toLowerCase().includes(query))
      .map((item) => ({ label: `Go to ${item.label}`, detail: 'Command', action: () => goToSection(item.section!) }))
    const projects = recentProjects
      .filter((project) => project.name.toLowerCase().includes(query) || project.path.toLowerCase().includes(query))
      .map((project) => ({ label: project.name, detail: compactPath(project.path), action: () => void openRecent(project) }))
    const model = activeIndex?.projectModel
    const screens = (model?.pages ?? []).filter((screen) => [screen.name, screen.route ?? '', screen.source.filePath, ...screen.textContent].some((value) => value.toLowerCase().includes(query))).map((screen) => ({ label: screen.name, detail: `Screen · ${screen.route ?? screen.source.filePath}`, action: () => openScreenFromSearch(screen.id) }))
    const components = (model?.components ?? []).filter((component) => component.name.toLowerCase().includes(query) || component.source.filePath.toLowerCase().includes(query)).map((component) => ({ label: component.name, detail: `Component · ${component.source.filePath}`, action: () => { goToSection('components'); setCommandQuery('') } }))
    const tokens = activeIndex ? activeIndex.projectModel.tokens.filter((token) => token.name.toLowerCase().includes(query) || token.value.toLowerCase().includes(query)).map((token) => ({ label: token.name, detail: `Token · ${token.value}`, action: () => { goToSection('design-system'); setCommandQuery('') } })) : []
    const featureResults = features.filter((feature) => `${feature.name} ${feature.description}`.toLowerCase().includes(query)).map((feature) => ({ label: feature.name, detail: 'Feature', action: () => { useUiStore.getState().setActiveFeatureId(feature.id); setView('feature-workspace'); setCommandQuery('') } }))
    const matchingCommands = commands.filter((item) => (activeProject || ['Open Project', 'Open Recent Project', 'Show All Projects'].includes(item.label)) && item.label.toLowerCase().includes(query))
    return [...matchingCommands, ...featureResults, ...sections, ...screens, ...components, ...tokens, ...projects].slice(0, 12)
    // openRecent intentionally resolves against current store state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, activeIndex, commandQuery, recentProjects, features, children, setSection, setView, setSelectedScreenId])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-bg">
      <PreparationDialog/>
      <ProjectProgressModal opening={openingProject} error={openError} onDismiss={() => setOpenError(null)} />
      <header className="app-drag-region relative flex h-10 shrink-0 items-center border-b border-border bg-bg-raised px-3.5">
        <div className="app-no-drag flex min-w-0 items-center gap-1.5">
          <button title="Back" disabled={!canGoBack} onClick={() => { goBack(); if (children) setView('workspace') }} className="flex h-7 w-7 items-center justify-center rounded text-text-3 hover:bg-hover hover:text-text disabled:opacity-25"><ArrowLeft size={14} /></button>
          <button title="Forward" disabled={!canGoForward} onClick={() => { goForward(); if (children) setView('workspace') }} className="flex h-7 w-7 items-center justify-center rounded text-text-3 hover:bg-hover hover:text-text disabled:opacity-25"><ArrowRight size={14} /></button>
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-on-accent shadow-none">
            <FrameMark className="h-3.5 w-3.5" />
          </div>
          <button onClick={() => goToSection('start')} className="text-[12px] text-text-2 hover:text-text">Projects</button>
          {!library && activeProject && <><ChevronRightIcon className="h-3 w-3 text-text-3"/><button onClick={() => goToSection('project-home')} className="max-w-40 truncate text-[12px] text-text-2 hover:text-text">{activeProject.name}</button></>}
          {!library && editor && <><ChevronRightIcon className="h-3 w-3 text-text-3"/><span className="max-w-44 truncate text-[12px] text-text">{activeDesignFile?.name ?? 'Design workspace'}</span></>}

        </div>

        <div className={`app-no-drag relative ml-auto mr-3 ${editor ? 'w-[220px]' : 'w-[min(380px,32vw)]'}`}>
          <div className={`relative flex h-8 items-center gap-2 rounded-md border bg-panel px-2.5 ${commandFocused ? 'border-accent' : 'border-border'}`}>
            <Search size={13} className="shrink-0 text-text-3" />
            <input ref={commandInput} value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} onFocus={() => setCommandFocused(true)} onBlur={() => window.setTimeout(() => setCommandFocused(false), 120)} placeholder={editor ? 'Quick open…' : 'Quick open or run a command'} className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-3" />
            <span className="flex items-center gap-0.5 rounded border border-border px-1 py-0.5 font-mono text-[12px] text-text-3"><Command size={9} />K</span>
          </div>
          {commandFocused && (
            <div className="absolute left-0 right-0 top-9 z-50 overflow-hidden rounded-md border border-border-strong bg-panel shadow-sm">
              {commandResults.length ? commandResults.map((result) => (
                <button key={`${result.detail}:${result.label}`} type="button" onMouseDown={(event) => event.preventDefault()} onClick={result.action} className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left last:border-0 hover:bg-hover">
                  <span className="text-[12px] text-text">{result.label}</span><span className="max-w-56 truncate font-mono text-[12px] text-text-3">{result.detail}</span>
                </button>
              )) : <div className="px-3 py-3 text-[12px] text-text-3">No matching projects or commands.</div>}
            </div>
          )}
        </div>

        <div className="app-no-drag ml-auto flex items-center gap-1">
          {activeProject && <>
            <button type="button" title="Close project and return to Start" onClick={() => void closeProject()} className="flex h-7 w-7 items-center justify-center rounded-[5px] text-text-3 hover:bg-hover hover:text-text"><X size={12}/></button>
            <span className="mx-1 h-4 w-px bg-border" />
          </>}
          <button type="button" title="Application settings" aria-label="Application settings" onClick={() => setSettingsOpen(true)} className="flex h-7 w-7 items-center justify-center rounded text-text-3 hover:bg-panel-2"><SettingsIcon size={15}/></button>
        </div>
        {activeProject && <button className="app-no-drag ml-auto shrink-0 rounded px-2 py-1 text-xs text-text-2 hover:bg-hover" onClick={() => goToSection('environment')}>Local app · {localPhase}</button>}
      </header>

      {appError && <div className="absolute right-4 top-14 z-[80] flex max-w-[520px] items-center gap-3 rounded-md border border-danger/40 bg-panel px-3 py-2 text-[12px] text-danger shadow-sm"><span>{appError}</span><button type="button" onClick={() => setAppError(null)} className="text-danger hover:text-text">Dismiss</button></div>}

      {settingsOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim" onKeyDown={(e) => { if (e.key === 'Escape') setSettingsOpen(false); if (e.key === 'Tab') { const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button, input:checked')); const first = controls[0]; const last = controls.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() } } }}><section role="dialog" aria-modal="true" aria-label="Application settings" className="w-[540px] rounded-lg border border-border-strong bg-panel p-4 shadow-sm"><div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-semibold">Application settings</h2><button autoFocus aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={16}/></button></div><AppearancePicker/><p className="my-4 text-xs text-text-3">Appearance and workspace layouts are saved on this computer.</p></section></div>}
      <div className="flex min-h-0 flex-1">
        {children && activeProject ? (
          <div className="flex min-w-0 flex-1">{children}</div>
        ) : !activeProject || section === 'start' ? (
          <StartWorkspace recentProjects={recentProjects} activeProject={activeProject} onOpenFolder={openFolder} onOpenProject={openRecent} onProjectRemoved={handleProjectRemoved} onLibraryChanged={() => void refreshRecents()} />
        ) : (
          <>{section !== 'canvas' && <DesignFilesSidebar section={section} onSection={goToSection}/>}<div className="flex min-h-0 min-w-0 flex-1">
            {section === 'project-home' && <ProjectHome />}
            {section === 'environment' && <LocalEnvironmentSection key={activeProject.id}/>}
            {section === 'canvas' && <VisualCanvasSection key={`${activeProject.id}:${activeDesignFile?.id}`}  designFileId={activeDesignFile?.id} designFileName={activeDesignFile?.name} sourceLinked={activeDesignFile?.kind !== 'design'} />}
            {section === 'features' && <FeaturesSection />}
                        {section === 'overview' && <OverviewSection />}
            {section === 'screens' && <ScreensSection />}
            {section === 'flows' && <FlowsSection flowSummaries={flowSummaries} />}
            {section === 'components' && <ComponentsSection />}
            {section === 'design-system' && <DesignSystemSection />}
            {section === 'captures' && <CapturesSection />}
            {section === 'review' && <ReviewSection />}
            {section === 'changes' && <ChangesSection />}
            {section === 'settings' && <SettingsSection />}
          </div></>
        )}
      </div>
    </div>
  )
}
