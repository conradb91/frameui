import { useEffect, useState } from 'react'
import type { RecentProject } from '@shared/types/project'
import { FrameMark, FolderIcon, SearchIcon, ChevronRightIcon, AlertCircleIcon } from '../../components/icons/icons'
import { useWorkspaceStore } from '../../state/workspaceStore'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { formatRelativeTime } from '../../lib/formatRelativeTime'

export function OpenProjectView() {
  const refresh = useWorkspaceStore((s) => s.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <TopBar />
      <div className="flex flex-1">
        <LeftPane />
        <RightPane />
      </div>
    </div>
  )
}

function TopBar() {
  const activeProject = useProjectStore((s) => s.activeProject)
  return (
    <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-raised px-5">
      <div className="flex items-center gap-2">
        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-gradient-to-br from-[#9385FF] to-[#6C58E8] text-white shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset]">
          <FrameMark className="h-[13px] w-[13px]" />
        </div>
        <span className="text-[13.5px] font-semibold text-text">FrameUI</span>
        <span className="ml-0.5 rounded border border-border px-1.5 py-px font-mono text-[10.5px] text-text-3">v0.1.0-poc</span>
      </div>
      <div className="flex items-center gap-3.5">
        {activeProject && (
          <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 font-mono text-[11px] text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {activeProject.name} active
          </span>
        )}
        <span className="text-xs text-text-2">No account required</span>
      </div>
    </div>
  )
}

function LeftPane() {
  const recentProjects = useWorkspaceStore((s) => s.recentProjects)
  const refresh = useWorkspaceStore((s) => s.refresh)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setView = useUiStore((s) => s.setView)
  const [busy, setBusy] = useState(false)

  function enterProject(project: RecentProject) {
    setActiveProject(project)
    setView('workspace')
  }

  async function handleOpenDialog() {
    setBusy(true)
    try {
      const result = await window.frameui.project.openDialog()
      if (!result.cancelled) {
        enterProject(result.project)
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleOpenRecent(project: RecentProject) {
    if (project.missing) {
      setBusy(true)
      try {
        const result = await window.frameui.project.openDialog(project.id)
        if (!result.cancelled) {
          enterProject(result.project)
        }
        await refresh()
      } finally {
        setBusy(false)
      }
      return
    }
    setBusy(true)
    try {
      const result = await window.frameui.project.openPath(project.path)
      if (result.ok) {
        enterProject(result.project)
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-[760px] shrink-0 flex-col px-[88px] pb-10 pt-[76px] pr-[72px]">
      <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#9385FF] to-[#6C58E8] text-white shadow-[0_10px_30px_-8px_rgb(124_106_242/0.55),0_0_0_1px_rgb(255_255_255/0.12)_inset]">
        <FrameMark className="h-6 w-6" />
      </div>

      <h1 className="mb-3 text-[32px] font-bold leading-tight tracking-[-0.5px] text-white">
        Open a project to get started
      </h1>
      <p className="mb-8 max-w-[480px] text-[14.5px] leading-relaxed text-text-2">
        FrameUI reads your local repository and turns its real components and styles into a visual design workspace.
        Nothing leaves your computer.
      </p>

      <div className="mb-11 flex items-center gap-3">
        <button
          type="button"
          onClick={handleOpenDialog}
          disabled={busy}
          className="flex items-center gap-2 rounded-[9px] border border-accent bg-gradient-to-b from-[#8676F4] to-[#7461EE] px-[22px] py-[13px] text-sm font-semibold text-white shadow-[0_0_0_1px_rgb(124_106_242/0.5),0_8px_24px_-4px_rgb(124_106_242/0.5)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          <FolderIcon className="h-[17px] w-[17px]" />
          Open Project Folder
        </button>
        <button
          type="button"
          disabled
          title="Not part of this build"
          className="flex items-center gap-2 rounded-[9px] border border-border bg-panel-2 px-[18px] py-[13px] text-[13.5px] font-semibold text-text-2 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <SearchIcon className="h-[15px] w-[15px]" />
          Browse Examples
        </button>
      </div>

      <div className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-text-3">Recent Projects</div>

      {recentProjects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-text-3">
          No projects opened yet — use Open Project Folder above.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-panel">
          {recentProjects.map((project, i) => (
            <RecentProjectRow
              key={project.id}
              project={project}
              isLast={i === recentProjects.length - 1}
              onOpen={() => void handleOpenRecent(project)}
              disabled={busy}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RecentProjectRow({
  project,
  isLast,
  onOpen,
  disabled,
}: {
  project: RecentProject
  isLast: boolean
  onOpen: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left hover:bg-white/[0.03] disabled:cursor-wait ${
        isLast ? '' : 'border-b border-border'
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border ${
          project.missing ? 'border-danger/25 bg-danger/[0.08]' : 'border-border bg-panel-2'
        }`}
      >
        {project.missing ? (
          <AlertCircleIcon className="h-[17px] w-[17px] text-danger" />
        ) : (
          <FolderIcon className="h-[17px] w-[17px] text-white/55" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-white/90">{project.name}</div>
        <div className={`mt-0.5 truncate font-mono text-[11.5px] ${project.missing ? 'text-danger/70' : 'text-text-3'}`}>
          {project.missing ? `${project.path} — folder not found` : project.path}
        </div>
      </div>
      {project.missing ? (
        <span className="shrink-0 text-xs font-semibold text-accent-2">Relink&nbsp;Folder</span>
      ) : (
        <>
          <span className="shrink-0 text-xs text-text-3">{formatRelativeTime(project.lastOpenedAt)}</span>
          <ChevronRightIcon className="h-[15px] w-[15px] shrink-0 text-white/30" />
        </>
      )}
    </button>
  )
}

function RightPane() {
  return (
    <div className="relative flex-1 overflow-hidden border-l border-border bg-[radial-gradient(ellipse_620px_460px_at_78%_30%,rgb(124_106_242/0.16),transparent_60%)]">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.055) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      />
      <div className="absolute bottom-14 left-[90px] right-[70px]">
        <div className="mb-1.5 text-[13px] font-semibold text-white/85">Built from your actual codebase</div>
        <div className="max-w-[420px] text-[12.5px] leading-relaxed text-text-3">
          FrameUI detects React + TypeScript, Vite / Next.js, Tailwind tokens, and every reusable component already in
          the repo.
        </div>
        <div className="mt-3.5 flex gap-2">
          {['React', 'TypeScript', 'Tailwind', 'Next.js'].map((tag) => (
            <span key={tag} className="rounded-full border border-border bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-text-2">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
