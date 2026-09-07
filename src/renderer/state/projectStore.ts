import { create } from 'zustand'
import type { RecentProject } from '@shared/types/project'
import type { ProjectIndex } from '@shared/types/projectIndex'

interface ProjectState {
  activeProject: RecentProject | null
  activeIndex: ProjectIndex | null
  indexing: boolean
  setActiveProject: (project: RecentProject) => void
  fetchIndex: () => Promise<void>
  reindex: () => Promise<void>
  closeProject: () => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProject: null,
  activeIndex: null,
  indexing: false,
  setActiveProject: (project) => set({ activeProject: project, activeIndex: null }),
  fetchIndex: async () => {
    if (!get().activeProject) return
    set({ indexing: true })
    const activeIndex = await window.frameui.project.getIndex()
    set({ activeIndex, indexing: false })
  },
  reindex: async () => {
    if (!get().activeProject) return
    set({ indexing: true })
    const activeIndex = await window.frameui.project.reindex()
    set({ activeIndex, indexing: false })
  },
  closeProject: async () => {
    await window.frameui.project.close()
    set({ activeProject: null, activeIndex: null })
  },
}))
