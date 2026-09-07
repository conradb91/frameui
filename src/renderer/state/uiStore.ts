import { create } from 'zustand'

export type TopLevelView =
  | 'open-project'
  | 'project-summary'
  | 'flow-workspace'
  | 'screen-designer'
  | 'preview'
  | 'export'

interface UiState {
  view: TopLevelView
  setView: (view: TopLevelView) => void
}

// A desktop app with no deep-linking need: top-level navigation is just
// view-state, not a router (see plan's tech-stack rationale).
export const useUiStore = create<UiState>((set) => ({
  view: 'open-project',
  setView: (view) => set({ view }),
}))
