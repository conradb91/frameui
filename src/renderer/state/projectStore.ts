import { create } from 'zustand'
import type { RecentProject } from '@shared/types/project'
import type { ProjectIndex, IndexProgressStep, FileChangeNotice } from '@shared/types/projectIndex'

interface ProjectState {
  activeProject: RecentProject | null
  activeIndex: ProjectIndex | null
  indexing: boolean
  /** Real stages of the in-flight `indexProject` call, in completion order —
   * driven by `project:onIndexProgress`, not a fake timer. Reset at the
   * start of each fetch/reindex. */
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

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProject: null,
  activeIndex: null,
  indexing: false,
  indexProgress: [],
  sourceStatus: 'idle',
  sourceNotice: null,
  setActiveProject: (project) => set({ activeProject: project, activeIndex: null }),
  fetchIndex: async () => {
    if (!get().activeProject) return
    set({ indexing: true, indexProgress: [] })
    try {
      const activeIndex = await window.frameui.project.getIndex()
      set({ activeIndex, sourceStatus: activeIndex ? 'up-to-date' : 'idle' })
    } finally {
      set({ indexing: false })
    }
  },
  reindex: async () => {
    if (!get().activeProject) return
    set({ indexing: true, indexProgress: [] })
    try {
      const activeIndex = await window.frameui.project.reindex()
      set({ activeIndex, sourceStatus: activeIndex ? 'up-to-date' : 'idle' })
    } finally {
      set({ indexing: false })
    }
  },
  closeProject: async () => {
    await window.frameui.project.close()
    set({ activeProject: null, activeIndex: null, sourceStatus: 'idle', sourceNotice: null })
  },
  recordProgressStep: (step) => set((state) => (state.indexProgress.includes(step) ? state : { indexProgress: [...state.indexProgress, step] })),
  handleFileChange: async (notice) => {
    set({ sourceStatus: notice.status ?? 'updating', sourceNotice: notice })
    if (notice.status === 'up-to-date') {
      const activeIndex = await window.frameui.project.getIndex()
      set({ activeIndex, sourceStatus: 'up-to-date', sourceNotice: notice })
    }
  },
  selectApplication: async (applicationId) => {
    const activeIndex = await window.frameui.project.selectApplication(applicationId)
    set({ activeIndex })
  },
}))
