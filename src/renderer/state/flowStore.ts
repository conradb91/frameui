import { create } from 'zustand'
import type { Flow, FlowSummary, FlowScreenNode, FlowEdge } from '@shared/types/flow'

interface FlowState {
  summaries: FlowSummary[]
  activeFlow: Flow | null
  loadingSummaries: boolean
  saving: boolean
  saveTimer: ReturnType<typeof setTimeout> | null

  loadSummaries: (projectId: string) => Promise<void>
  createFlow: (projectId: string, name: string) => Promise<Flow>
  openFlow: (projectId: string, flowId: string) => Promise<void>
  closeFlow: () => void

  setNodes: (nodes: FlowScreenNode[]) => void
  setEdges: (edges: FlowEdge[]) => void
  renameFlow: (name: string) => void

  scheduleSave: () => void
}

const SAVE_DEBOUNCE_MS = 600

export const useFlowStore = create<FlowState>((set, get) => ({
  summaries: [],
  activeFlow: null,
  loadingSummaries: false,
  saving: false,
  saveTimer: null,

  loadSummaries: async (projectId) => {
    set({ loadingSummaries: true })
    const summaries = await window.frameui.workspace.listFlows(projectId)
    set({ summaries, loadingSummaries: false })
  },

  createFlow: async (projectId, name) => {
    const flow = await window.frameui.workspace.createFlow(projectId, name)
    set((s) => ({ summaries: [{ id: flow.id, projectId, name: flow.name, screenCount: 0, updatedAt: flow.updatedAt }, ...s.summaries] }))
    return flow
  },

  openFlow: async (projectId, flowId) => {
    const flow = await window.frameui.workspace.getFlow(projectId, flowId)
    set({ activeFlow: flow })
  },

  closeFlow: () => {
    const timer = get().saveTimer
    if (timer) clearTimeout(timer)
    set({ activeFlow: null, saveTimer: null })
  },

  setNodes: (nodes) => {
    const flow = get().activeFlow
    if (!flow) return
    set({ activeFlow: { ...flow, nodes } })
    get().scheduleSave()
  },

  setEdges: (edges) => {
    const flow = get().activeFlow
    if (!flow) return
    set({ activeFlow: { ...flow, edges } })
    get().scheduleSave()
  },

  renameFlow: (name) => {
    const flow = get().activeFlow
    if (!flow) return
    set({ activeFlow: { ...flow, name } })
    get().scheduleSave()
  },

  scheduleSave: () => {
    const existing = get().saveTimer
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      const flow = get().activeFlow
      if (!flow) return
      set({ saving: true })
      const saved = await window.frameui.workspace.saveFlow(flow)
      set({ activeFlow: saved, saving: false, saveTimer: null })
    }, SAVE_DEBOUNCE_MS)
    set({ saveTimer: timer })
  },
}))
