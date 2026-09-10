import { pendingWorkspaceSaves } from './pendingSaves'
import { create } from 'zustand'
import type { RecentProject } from '@shared/types/project'
import type { ProjectIndex, IndexProgressStep, FileChangeNotice } from '@shared/types/projectIndex'

interface ProjectState {
  activeProject: RecentProject | null
  activeIndex: ProjectIndex | null
  indexError: string | null
  indexing: boolean
  indexProgress: IndexProgressStep[]
  sourceStatus: 'idle' | 'updating' | 'up-to-date' | 'warning'
  sourceNotice: FileChangeNotice | null
  setActiveProject: (project: RecentProject) => void
  fetchIndex: () => Promise<void>
  reindex: () => Promise<void>
  closeProject: () => Promise<void>
  recordProgressStep: (step: IndexProgressStep) => void
  handleFileChange: (notice: FileChangeNotice) => Promise<void>
  selectApplication: (applicationId: string) => Promise<void>
}

let generation = 0
export const useProjectStore = create<ProjectState>((set, get) => {
  async function load(loadIndex: () => Promise<ProjectIndex | null>) {
    if (!get().activeProject) return
    const request = ++generation
    set({ indexing: true, indexProgress: [], indexError: null })
    try {
      const activeIndex = await loadIndex()
      if (request === generation) set({ activeIndex, sourceStatus: activeIndex ? 'up-to-date' : 'idle' })
    } catch (error) {
      if (request === generation) set({ sourceStatus: 'warning', indexError: error instanceof Error ? error.message : String(error) })
    } finally {
      if (request === generation) set({ indexing: false })
    }
  }
  return {
    activeProject: null, activeIndex: null, indexing: false, indexError: null, indexProgress: [], sourceStatus: 'idle', sourceNotice: null,
    setActiveProject: (project) => {
      generation++
      set({ activeProject: project, activeIndex: null, indexing: false, indexError: null, indexProgress: [], sourceStatus: 'idle', sourceNotice: null })
    },
    fetchIndex: async () => {
      if (get().indexing) return
      await load(() => window.frameui.project.getIndex())
    },
    reindex: () => load(() => window.frameui.project.reindex()),
    closeProject: async () => {
      await pendingWorkspaceSaves.flush()
      await window.frameui.project.close()
      generation++
      set({ activeProject: null, activeIndex: null, indexing: false, indexError: null, indexProgress: [], sourceStatus: 'idle', sourceNotice: null })
    },
    recordProgressStep: (step) => set((state) => state.indexProgress.includes(step) ? state : { indexProgress: [...state.indexProgress, step] }),
    handleFileChange: async (notice) => {
      if (notice.projectId !== get().activeProject?.id) return
      set({ sourceStatus: notice.status ?? 'updating', sourceNotice: notice })
      if (notice.status === 'up-to-date') await load(() => window.frameui.project.getIndex())
    },
    selectApplication: (applicationId) => load(() => window.frameui.project.selectApplication(applicationId)),
  }
})
