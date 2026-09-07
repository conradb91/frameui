import { create } from 'zustand'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import type { ScreenNodeSource } from '@shared/types/flow'
import type { DesignCommand } from '@core/design-model/commands'
import { applyCommand, invertCommand } from '@core/design-model/commands'
import { createDefaultTree } from '@core/design-model/defaultTree'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'

interface HistoryEntry {
  command: DesignCommand
  inverse: DesignCommand
}

const MAX_HISTORY = 100 // spec DRF-03: at least 100 in-session operations
const SAVE_DEBOUNCE_MS = 500

interface DesignState {
  projectId: string | null
  flowId: string | null
  screenId: string | null
  tree: DesignNode | null
  selectedId: string | null
  breakpoint: Breakpoint
  past: HistoryEntry[]
  future: HistoryEntry[]
  saving: boolean
  saveTimer: ReturnType<typeof setTimeout> | null

  loadScreen: (projectId: string, flowId: string, screenId: string, source: ScreenNodeSource) => Promise<void>
  closeScreen: () => void
  select: (id: string | null) => void
  setBreakpoint: (breakpoint: Breakpoint) => void
  dispatch: (command: DesignCommand) => void
  undo: () => void
  redo: () => void
}

export const useDesignStore = create<DesignState>((set, get) => ({
  projectId: null,
  flowId: null,
  screenId: null,
  tree: null,
  selectedId: null,
  breakpoint: 'desktop',
  past: [],
  future: [],
  saving: false,
  saveTimer: null,

  loadScreen: async (projectId, flowId, screenId, source) => {
    const existing = await window.frameui.workspace.getScreenDraft(projectId, screenId)
    let tree = existing?.tree ?? null

    if (!tree && source.type === 'existing-page' && source.pageFilePath) {
      const structure = await window.frameui.project.getPageStructure(source.pageFilePath)
      tree = buildExistingPageDraftTree(crypto.randomUUID(), structure, source.pageFilePath)
    }
    if (!tree) {
      tree = createDefaultTree(crypto.randomUUID())
    }

    set({
      projectId,
      flowId,
      screenId,
      tree,
      selectedId: null,
      breakpoint: 'desktop',
      past: [],
      future: [],
    })
  },

  closeScreen: () => {
    const timer = get().saveTimer
    if (timer) clearTimeout(timer)
    set({ projectId: null, flowId: null, screenId: null, tree: null, selectedId: null, past: [], future: [], saveTimer: null })
  },

  select: (id) => set({ selectedId: id }),

  setBreakpoint: (breakpoint) => set({ breakpoint }),

  dispatch: (command) => {
    const { tree } = get()
    if (!tree) return
    const inverse = invertCommand(tree, command)
    if (!inverse) return // command targeted a node that no longer exists — no-op
    const nextTree = applyCommand(tree, command)

    set((s) => {
      const past = [...s.past, { command, inverse }]
      if (past.length > MAX_HISTORY) past.shift()
      return { tree: nextTree, past, future: [] }
    })
    scheduleSave(get, set)
  },

  undo: () => {
    const { past, tree } = get()
    if (past.length === 0 || !tree) return
    const entry = past[past.length - 1]
    const nextTree = applyCommand(tree, entry.inverse)
    set((s) => ({
      tree: nextTree,
      past: s.past.slice(0, -1),
      future: [...s.future, entry],
    }))
    scheduleSave(get, set)
  },

  redo: () => {
    const { future, tree } = get()
    if (future.length === 0 || !tree) return
    const entry = future[future.length - 1]
    const nextTree = applyCommand(tree, entry.command)
    set((s) => ({
      tree: nextTree,
      future: s.future.slice(0, -1),
      past: [...s.past, entry],
    }))
    scheduleSave(get, set)
  },
}))

function scheduleSave(get: () => DesignState, set: (partial: Partial<DesignState>) => void) {
  const existing = get().saveTimer
  if (existing) clearTimeout(existing)
  const timer = setTimeout(async () => {
    const { projectId, flowId, screenId, tree } = get()
    if (!projectId || !flowId || !screenId || !tree) return
    set({ saving: true })
    await window.frameui.workspace.saveScreenDraft({
      id: screenId,
      projectId,
      flowId,
      tree,
      updatedAt: new Date().toISOString(),
    })
    set({ saving: false, saveTimer: null })
  }, SAVE_DEBOUNCE_MS)
  set({ saveTimer: timer })
}
