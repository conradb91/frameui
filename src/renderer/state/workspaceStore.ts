import { create } from 'zustand'
import type { RecentProject } from '@shared/types/project'

interface WorkspaceState {
  recentProjects: RecentProject[]
  loading: boolean
  refresh: () => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  recentProjects: [],
  loading: false,
  refresh: async () => {
    set({ loading: true })
    const recentProjects = await window.frameui.workspace.listRecentProjects()
    set({ recentProjects, loading: false })
  },
}))
