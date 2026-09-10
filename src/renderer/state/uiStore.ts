import { create } from 'zustand'

/**
 * `workspace` is the persistent IDE shell (top bar + icon rail + contextual
 * sidebar + workspace + inspector + status bar) — the landing experience
 * once a project is open. The specialized full-screen tools (flow canvas,
 * screen designer, preview, export) are reached from it and take over the
 * whole window, same as before.
 */
export type TopLevelView =
  | 'open-project'
  | 'workspace'
  | 'feature-workspace'
  | 'flow-workspace'
  | 'screen-designer'
  | 'preview'
  | 'export'
  | 'capture-session'
  /** Phase 24 — interactive Journey prototype, LIVE/DESIGN/PREVIEW's third
   * mode. Distinct from the legacy `preview` (which runs the real dev
   * server via `usePreviewStore`, unrelated to Feature design work). */
  | 'feature-preview'
  /** Phase 25 — the read-only recipient experience for a packaged Share
   * Preview, no editor chrome. */
  | 'share-preview'

export type ShellSection = 'start' | 'canvas' | 'features' | 'overview' | 'screens' | 'flows' | 'components' | 'design-system' | 'captures' | 'review' | 'changes' | 'settings'

interface UiState {
  view: TopLevelView
  setView: (view: TopLevelView) => void
  section: ShellSection
  setSection: (section: ShellSection) => void
  sectionHistory: ShellSection[]
  sectionFuture: ShellSection[]
  goBack: () => void
  goForward: () => void
  selectedScreenId: string | null
  setSelectedScreenId: (screenId: string | null) => void
  /** The Feature currently open in the Feature Workspace (spec Phase 6/7) —
   * set right before `setView('feature-workspace')`, cleared on exit. */
  activeFeatureId: string | null
  setActiveFeatureId: (featureId: string | null) => void
  /** The Journey being run in `feature-preview` (spec Phase 24). */
  activeJourneyId: string | null
  setActiveJourneyId: (journeyId: string | null) => void
  /** The Share Preview being viewed in `share-preview` (spec Phase 25). */
  activeSharePreviewId: string | null
  setActiveSharePreviewId: (sharePreviewId: string | null) => void
}

// A desktop app with no deep-linking need: top-level navigation is just
// view-state, not a router (see plan's tech-stack rationale).
export const useUiStore = create<UiState>((set) => ({
  view: 'open-project',
  setView: (view) => set({ view }),
  // The visual canvas is the primary product workspace. Features and the
  // repository browsers remain first-class supporting workflows.
  section: 'start',
  sectionHistory: [],
  sectionFuture: [],
  setSection: (section) => set((state) => state.section === section ? state : { section, sectionHistory: [...state.sectionHistory, state.section].slice(-50), sectionFuture: [] }),
  goBack: () => set((state) => {
    const previous = state.sectionHistory.at(-1)
    return previous ? { section: previous, sectionHistory: state.sectionHistory.slice(0, -1), sectionFuture: [state.section, ...state.sectionFuture].slice(0, 50) } : state
  }),
  goForward: () => set((state) => {
    const next = state.sectionFuture[0]
    return next ? { section: next, sectionHistory: [...state.sectionHistory, state.section].slice(-50), sectionFuture: state.sectionFuture.slice(1) } : state
  }),
  selectedScreenId: null,
  setSelectedScreenId: (selectedScreenId) => set({ selectedScreenId }),
  activeFeatureId: null,
  setActiveFeatureId: (activeFeatureId) => set({ activeFeatureId }),
  activeJourneyId: null,
  setActiveJourneyId: (activeJourneyId) => set({ activeJourneyId }),
  activeSharePreviewId: null,
  setActiveSharePreviewId: (activeSharePreviewId) => set({ activeSharePreviewId }),
}))
