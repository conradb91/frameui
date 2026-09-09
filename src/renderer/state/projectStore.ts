import { create } from 'zustand'
import type { RecentProject } from '@shared/types/project'
import type { ProjectIndex, IndexProgressStep } from '@shared/types/projectIndex'

interface ProjectState {
  activeProject: RecentProject | null
  activeIndex: ProjectIndex | null
  indexing: boolean
  /** Real stages of the in-flight `indexProject` call, in completion order —
   * driven by `project:onIndexProgress`, not a fake timer. Reset at the
   * start of each fetch/reindex. */
  indexProgress: IndexProgressStep[]
  setActiveProject: (project: RecentProject) => void
  fetchIndex: () => Promise<void>
  reindex: () => Promise<void>
  closeProject: () => Promise<void>
  recordProgressStep: (step: IndexProgressStep) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProject: null,
  activeIndex: null,
  indexing: false,
  indexProgress: [],
  setActiveProject: (project) => set({ activeProject: project, activeIndex: null }),
  fetchIndex: async () => {
    if (!get().activeProject) return
    set({ indexing: true, indexProgress: [] })
    try {
      const activeIndex = await window.frameui.project.getIndex()
      set({ activeIndex })
    } finally {
      set({ indexing: false })
    }
  },
  reindex: async () => {
    if (!get().activeProject) return
    set({ indexing: true, indexProgress: [] })
    try {
      const activeIndex = await window.frameui.project.reindex()
      set({ activeIndex })
    } finally {
      set({ indexing: false })
    }
  },
  closeProject: async () => {
    await window.frameui.project.close()
    set({ activeProject: null, activeIndex: null })
  },
  recordProgressStep: (step) => set((state) => (state.indexProgress.includes(step) ? state : { indexProgress: [...state.indexProgress, step] })),
}))
