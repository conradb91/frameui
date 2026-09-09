import { create } from 'zustand'
import type { Journey, JourneyConnection, JourneyStep } from '@shared/types/model/featureModel'

interface JourneyState {
  summaries: Journey[]
  activeJourney: Journey | null
  loadingSummaries: boolean
  saving: boolean
  saveTimer: ReturnType<typeof setTimeout> | null
  projectId: string | null
  selectedStepId: string | null
  selectedConnectionId: string | null

  loadJourneys: (projectId: string, featureId: string) => Promise<void>
  createJourney: (projectId: string, featureId: string, name: string, description?: string) => Promise<Journey>
  openJourney: (projectId: string, journeyId: string) => Promise<void>
  closeJourney: () => void
  setSteps: (steps: JourneyStep[]) => void
  setConnections: (connections: JourneyConnection[]) => void
  renameJourney: (name: string) => void
  selectStep: (id: string | null) => void
  selectConnection: (id: string | null) => void
  scheduleSave: () => void
}

const SAVE_DEBOUNCE_MS = 600

export const useJourneyStore = create<JourneyState>((set, get) => ({
  summaries: [],
  activeJourney: null,
  loadingSummaries: false,
  saving: false,
  saveTimer: null,
  projectId: null,
  selectedStepId: null,
  selectedConnectionId: null,

  loadJourneys: async (projectId, featureId) => {
    set({ loadingSummaries: true })
    try {
      const summaries = await window.frameui.workspace.listJourneys(projectId, featureId)
      set({ summaries, projectId })
    } finally {
      set({ loadingSummaries: false })
    }
  },

  createJourney: async (projectId, featureId, name, description = '') => {
    const journey = await window.frameui.workspace.createJourney(projectId, featureId, name, description)
    set((state) => ({ summaries: [journey, ...state.summaries], activeJourney: journey, projectId }))
    return journey
  },

  openJourney: async (projectId, journeyId) => {
    const timer = get().saveTimer
    if (timer) clearTimeout(timer)
    const activeJourney = await window.frameui.workspace.getJourney(projectId, journeyId)
    set({ activeJourney, projectId, saveTimer: null, selectedStepId: null, selectedConnectionId: null })
  },

  closeJourney: () => {
    const timer = get().saveTimer
    if (timer) clearTimeout(timer)
    set({ activeJourney: null, saveTimer: null, selectedStepId: null, selectedConnectionId: null })
  },

  setSteps: (steps) => {
    const journey = get().activeJourney
    if (!journey) return
    set({ activeJourney: { ...journey, steps } })
    get().scheduleSave()
  },

  setConnections: (connections) => {
    const journey = get().activeJourney
    if (!journey) return
    set({ activeJourney: { ...journey, connections } })
    get().scheduleSave()
  },

  renameJourney: (name) => {
    const journey = get().activeJourney
    if (!journey) return
    set({ activeJourney: { ...journey, name } })
    get().scheduleSave()
  },

  selectStep: (selectedStepId) => set({ selectedStepId, selectedConnectionId: null }),
  selectConnection: (selectedConnectionId) => set({ selectedConnectionId, selectedStepId: null }),

  scheduleSave: () => {
    const existing = get().saveTimer
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      const { activeJourney, projectId } = get()
      if (!activeJourney || !projectId) return
      set({ saving: true })
      try {
        const saved = await window.frameui.workspace.saveJourney(projectId, activeJourney)
        set((state) => ({
          activeJourney: saved,
          summaries: state.summaries.map((journey) => (journey.id === saved.id ? saved : journey)),
        }))
      } finally {
        set({ saving: false, saveTimer: null })
      }
    }, SAVE_DEBOUNCE_MS)
    set({ saveTimer: timer })
  },
}))
