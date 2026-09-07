import { create } from 'zustand'
import type { Flow, FlowScreenNode } from '@shared/types/flow'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import { createDefaultTree } from '@core/design-model/defaultTree'

interface PreviewState {
  flow: Flow | null
  currentNodeId: string | null
  currentTree: DesignNode | null
  history: string[] // visited node ids, for Back
  breakpoint: Breakpoint
  loading: boolean

  start: (flow: Flow, projectId: string) => Promise<void>
  goTo: (nodeId: string, projectId: string) => Promise<void>
  back: (projectId: string) => Promise<void>
  setBreakpoint: (bp: Breakpoint) => void
  stop: () => void
}

async function loadTree(projectId: string, screenId: string): Promise<DesignNode> {
  const draft = await window.frameui.workspace.getScreenDraft(projectId, screenId)
  return draft?.tree ?? createDefaultTree(screenId)
}

/** Picks a sensible start node: the one no edge points at, falling back to
 * the first node — flows don't require an explicit "start" marker in V1. */
function pickStartNode(flow: Flow): FlowScreenNode | null {
  const targeted = new Set(flow.edges.map((e) => e.targetNodeId))
  return flow.nodes.find((n) => !targeted.has(n.id)) ?? flow.nodes[0] ?? null
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  flow: null,
  currentNodeId: null,
  currentTree: null,
  history: [],
  breakpoint: 'desktop',
  loading: false,

  start: async (flow, projectId) => {
    set({ flow, loading: true, history: [], breakpoint: 'desktop' })
    const startNode = pickStartNode(flow)
    if (!startNode) {
      set({ loading: false, currentNodeId: null, currentTree: null })
      return
    }
    const tree = await loadTree(projectId, startNode.id)
    set({ currentNodeId: startNode.id, currentTree: tree, loading: false })
  },

  goTo: async (nodeId, projectId) => {
    const { currentNodeId, history } = get()
    set({ loading: true })
    const tree = await loadTree(projectId, nodeId)
    set({
      currentNodeId: nodeId,
      currentTree: tree,
      history: currentNodeId ? [...history, currentNodeId] : history,
      loading: false,
    })
  },

  back: async (projectId) => {
    const { history } = get()
    if (history.length === 0) return
    const prevId = history[history.length - 1]
    set({ loading: true })
    const tree = await loadTree(projectId, prevId)
    set({ currentNodeId: prevId, currentTree: tree, history: history.slice(0, -1), loading: false })
  },

  setBreakpoint: (breakpoint) => set({ breakpoint }),

  stop: () => set({ flow: null, currentNodeId: null, currentTree: null, history: [], loading: false }),
}))
