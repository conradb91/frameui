import { pendingWorkspaceSaves, reportSaveError } from './pendingSaves'
import { create } from 'zustand'
import type { Flow, FlowSummary, FlowScreenNode, FlowEdge } from '@shared/types/flow'

interface FlowState {
  summaries: FlowSummary[]
  activeFlow: Flow | null
  loadingSummaries: boolean
  saving: boolean
  saveTimer: ReturnType<typeof setTimeout> | null

  loadSummaries: (projectId: string) => Promise<void>
  createFlow: (projectId: string, name: string, featureId?: string | null) => Promise<Flow>
  openFlow: (projectId: string, flowId: string) => Promise<void>
  closeFlow: () => void

  setNodes: (nodes: FlowScreenNode[]) => void
  setEdges: (edges: FlowEdge[]) => void
  renameFlow: (name: string) => void

  scheduleSave: () => void
}

let loadGeneration = 0
let summaryGeneration = 0
const SAVE_DEBOUNCE_MS = 600

export const useFlowStore = create<FlowState>((set, get) => ({
  summaries: [],
  activeFlow: null,
  loadingSummaries: false,
  saving: false,
  saveTimer: null,

  loadSummaries: async (projectId) => {
    const generation = ++summaryGeneration
    set({ loadingSummaries: true })
    try {
      const summaries = await window.frameui.workspace.listFlows(projectId)
      if (generation === summaryGeneration) set({ summaries })
    } catch (error) { reportSaveError(error) } finally {
      if (generation === summaryGeneration) set({ loadingSummaries: false })
    }
  },

  createFlow: async (projectId, name, featureId = null) => {
    const flow = await window.frameui.workspace.createFlow(projectId, name, undefined, featureId)
    set((s) => ({ summaries: [{ id: flow.id, projectId, featureId: flow.featureId, name: flow.name, screenCount: 0, updatedAt: flow.updatedAt }, ...s.summaries] }))
    return flow
  },

  openFlow: async (projectId, flowId) => {
    const generation = ++loadGeneration
    await pendingWorkspaceSaves.flush()
    const flow = await window.frameui.workspace.getFlow(projectId, flowId)
    if (generation === loadGeneration) set({ activeFlow: flow, saving: false })
  },

  closeFlow: () => {
    loadGeneration++
    void pendingWorkspaceSaves.flush().catch(reportSaveError)
    set({ activeFlow: null, saving: false, saveTimer: null })
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
    const flow = get().activeFlow
    if (!flow) return
    set({ saving: true })
    pendingWorkspaceSaves.schedule(`${flow.projectId}:flow:${flow.id}`, async () => {
      const saved = await window.frameui.workspace.saveFlow(flow)
      set((state) => ({
        ...(state.activeFlow === flow ? { activeFlow: saved, saving: false } : {}),
        summaries: state.summaries.map((item) => item.id === saved.id ? { ...item, name: saved.name, screenCount: saved.nodes.length, updatedAt: saved.updatedAt } : item),
      }))
    }, SAVE_DEBOUNCE_MS)
  },
}))
