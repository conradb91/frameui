import { useUiStore } from './uiStore'
import { create } from 'zustand'
import type { HostingSnapshot, HostingOptions, HostingAction } from '@shared/types/hosting'
import { preparationFailure, sanitizeDiagnostics } from '@shared/diagnostics'

type Phase = 'Analysing' | 'Preparing' | 'Starting' | 'Ready' | 'Needs attention' | 'Stopped'
interface LocalApplicationState {
  projectId: string | null
  phase: Phase
  snapshot: HostingSnapshot | null
  busy: boolean
  stage: string
  events: string[]
  failure: ReturnType<typeof preparationFailure> | null
  inspect: (id: string, resume?: boolean) => Promise<void>
  prepare: (database?: HostingOptions['database']) => Promise<boolean>
  action: (action: HostingAction, confirmation?: string) => Promise<unknown>
  reset: () => void
}
let generation = 0
export const useLocalApplicationStore = create<LocalApplicationState>((set, get) => ({
  projectId: null, phase: 'Stopped', snapshot: null, busy: false, stage: 'plan', events: [], failure: null,
  reset: () => { generation++; set({ projectId: null, phase: 'Stopped', snapshot: null, busy: false, events: [], failure: null }) },
  inspect: async (id, resume = false) => {
    if (get().busy && get().projectId === id) return
    const request = ++generation
    set({ projectId: id, phase: 'Analysing', busy: true, failure: null, ...(get().projectId !== id ? { snapshot: null, events: [] } : {}) })
    try {
      const snapshot = await window.frameui.hosting.inspect(id)
      if (request === generation) set({ snapshot, phase: snapshot.running ? 'Ready' : 'Stopped' })
    } catch (cause) { if (request === generation) set({ failure: preparationFailure(cause), phase: 'Needs attention' }) }
    finally { if (request === generation) set({ busy: false }) }
    if (resume && request === generation && get().snapshot?.prepared && !get().failure && !get().snapshot?.running) {
      await get().action('start')
      if (request === generation && get().snapshot?.running) useUiStore.getState().setSection('canvas')
    }
  },
  prepare: async (database = 'skip') => {
    const { snapshot, projectId, busy } = get()
    if (!snapshot || !projectId || busy) return false
    const request = generation
    set({ busy: true, phase: 'Preparing', stage: 'copy', failure: null, events: [] })
    try {
      const result = await window.frameui.hosting.prepare(projectId, { reviewId: snapshot.reviewId, approveChanges: true, database, startWhenReady: true })
      if (request !== generation) return false
      set({ snapshot: result, phase: result.running ? 'Ready' : 'Needs attention' })
      return result.running
    } catch (cause) { if (request === generation) set({ failure: preparationFailure(cause), phase: 'Needs attention' }); return false }
    finally { if (request === generation) set({ busy: false }) }
  },
  action: async (action, confirmation) => {
    const { projectId, busy } = get()
    if (!projectId || busy) return
    const request = generation
    const diagnostic = ['logs', 'health', 'migration-status'].includes(action)
    set({ busy: true, ...(diagnostic ? {} : { failure: null }), ...(action === 'start' ? { phase: 'Preparing' as const, stage: 'copy', events: [] } : {}) })
    try {
      const result = await window.frameui.hosting.action(projectId, action, confirmation)
      const snapshot = await window.frameui.hosting.inspect(projectId)
      if (request === generation) set({ snapshot, phase: diagnostic ? get().phase : snapshot.running ? 'Ready' : 'Stopped' })
      return result
    } catch (cause) { if (request === generation) set({ failure: preparationFailure(cause), phase: 'Needs attention' }) }
    finally { if (request === generation) set({ busy: false }) }
  },
}))
/** One subscription owned by the shell; views never maintain their own hosting state. */
export function subscribeLocalApplication() {
  const progress = window.frameui.hosting.onProgress(event => {
    const state = useLocalApplicationStore.getState()
    if (event.projectId !== state.projectId) return
    const aliases: Record<string, string> = { plan: 'copy', composer: 'dependencies', migrations: 'environment', health: 'environment' }
    const stage = event.stage ? aliases[event.stage] ?? event.stage : null
    useLocalApplicationStore.setState({ events: [...state.events.slice(-99), String(sanitizeDiagnostics(event.detail))], ...(stage && ['copy','runtime','dependencies','environment','start','verify'].includes(stage) ? { stage } : {}), ...(stage === 'start' && state.busy ? { phase: 'Preparing' as const, stage: 'copy', events: [] } : {}) })
  })
  const status = window.frameui.preview.onStatus(event => {
    const state = useLocalApplicationStore.getState()
    if (!state.projectId || state.busy) return
    if (event.status === 'stopped' || event.status === 'error') useLocalApplicationStore.setState({ phase: event.status === 'error' ? 'Needs attention' : 'Stopped', snapshot: state.snapshot ? { ...state.snapshot, running: false, ready: false } : null, failure: event.status === 'error' ? preparationFailure(event.detail ?? 'Application stopped unexpectedly') : null })
    if (event.status === 'running') void state.inspect(state.projectId)
  })
  return () => { progress(); status() }
}
