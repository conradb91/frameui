import { create } from 'zustand'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import type { ScreenNodeSource } from '@shared/types/flow'
import type { DesignCommand } from '@core/design-model/commands'
import { applyCommand, invertCommand } from '@core/design-model/commands'
import { createDefaultTree } from '@core/design-model/defaultTree'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'
import { findNode, cloneNodeWithFreshIds } from '@core/design-model/tree'
import { applyDesignOperations, composeDesignOperations, type OperationContext } from '@core/design-model/operations'
import type { DesignOperation, PageRef } from '@shared/types/model/featureModel'

interface HistoryEntry {
  command: DesignCommand
  inverse: DesignCommand
}

const MAX_HISTORY = 100 // spec DRF-03: at least 100 in-session operations
const SAVE_DEBOUNCE_MS = 500

interface DesignState {
  projectId: string | null
  /** Legacy Flow-based screen (Phase 0-15) — set together with `screenId`,
   * mutually exclusive with `designStateId` below. */
  flowId: string | null
  screenId: string | null
  /** Phase 17/19 — a DesignState's own tree, or (when `alternativeId` is
   * also set) one specific Alternative's independent tree. Mutually
   * exclusive with `flowId`/`screenId`: exactly one loading mode is active
   * at a time, decided by which of `loadScreen`/`loadDesignState` was
   * called last. */
  designStateId: string | null
  alternativeId: string | null
  featureId: string | null
  pageRef: PageRef | null
  baselineTree: DesignNode | null
  operations: DesignOperation[]
  tree: DesignNode | null
  selectedId: string | null
  /** Multi-select ids (spec Phase 10/11) — always kept in sync with
   * `selectedId`, which stays the "primary"/last-touched id for the
   * inspector even when several nodes are selected. Empty when nothing is
   * selected; a single-element array mirrors `selectedId` for a plain
   * single-select so canvas/Layers code can just check `selectedIds`. */
  selectedIds: string[]
  /** Holds the real (not yet id-cloned) node so repeated pastes don't
   * collide — fresh ids are assigned per-paste via `cloneNodeWithFreshIds`. */
  clipboard: DesignNode | null
  breakpoint: Breakpoint
  past: HistoryEntry[]
  future: HistoryEntry[]
  saving: boolean
  saveTimer: ReturnType<typeof setTimeout> | null

  loadScreen: (projectId: string, flowId: string, screenId: string, source: ScreenNodeSource) => Promise<void>
  /** Phase 17/19 loading path — loads (or starts a blank tree for) a
   * DesignState's own design, or one specific Alternative's independent
   * copy when `alternativeId` is given. */
  loadDesignState: (projectId: string, designStateId: string, alternativeId?: string | null) => Promise<void>
  closeScreen: () => void
  /** Plain call = single-select (replaces the selection). Pass
   * `{ additive: true }` (shift/cmd/ctrl-click) to toggle `id` into the
   * existing multi-selection instead. */
  select: (id: string | null, options?: { additive?: boolean }) => void
  selectMultiple: (ids: string[]) => void
  copy: (nodeId: string) => void
  paste: (targetParentId: string, index: number) => void
  duplicateSelected: () => void
  setBreakpoint: (breakpoint: Breakpoint) => void
  dispatch: (command: DesignCommand) => void
  undo: () => void
  redo: () => void
}

export const useDesignStore = create<DesignState>((set, get) => ({
  projectId: null,
  flowId: null,
  screenId: null,
  designStateId: null,
  alternativeId: null,
  featureId: null,
  pageRef: null,
  baselineTree: null,
  operations: [],
  tree: null,
  selectedId: null,
  selectedIds: [],
  clipboard: null,
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
      designStateId: null,
      alternativeId: null,
      featureId: null,
      pageRef: null,
      baselineTree: tree,
      operations: [],
      tree,
      selectedId: null,
      selectedIds: [],
      clipboard: null,
      breakpoint: 'desktop',
      past: [],
      future: [],
    })
  },

  loadDesignState: async (projectId, designStateId, alternativeId = null) => {
    const ownerId = alternativeId ?? designStateId
    const [existing, metadata] = await Promise.all([
      window.frameui.workspace.getDesignTree(projectId, ownerId),
      window.frameui.workspace.getDesignState(projectId, designStateId),
    ])
    const baselineTree = existing?.tree ?? createDefaultTree(crypto.randomUUID())
    const operations = metadata ? await window.frameui.workspace.getDesignOperations(projectId, metadata.featureId, ownerId) : []
    const tree = applyDesignOperations(baselineTree, operations)

    set({
      projectId,
      flowId: null,
      screenId: null,
      designStateId,
      alternativeId,
      featureId: metadata?.featureId ?? null,
      pageRef: metadata?.pageRef ?? null,
      baselineTree,
      operations,
      tree,
      selectedId: null,
      selectedIds: [],
      clipboard: null,
      breakpoint: 'desktop',
      past: [],
      future: [],
    })
  },

  closeScreen: () => {
    const timer = get().saveTimer
    if (timer) clearTimeout(timer)
    set({
      projectId: null,
      flowId: null,
      screenId: null,
      designStateId: null,
      alternativeId: null,
      featureId: null,
      pageRef: null,
      baselineTree: null,
      operations: [],
      tree: null,
      selectedId: null,
      selectedIds: [],
      clipboard: null,
      past: [],
      future: [],
      saveTimer: null,
    })
  },

  select: (id, options) => {
    if (id === null) {
      set({ selectedId: null, selectedIds: [] })
      return
    }
    if (!options?.additive) {
      set({ selectedId: id, selectedIds: [id] })
      return
    }
    set((s) => {
      const alreadySelected = s.selectedIds.includes(id)
      const nextIds = alreadySelected ? s.selectedIds.filter((existingId) => existingId !== id) : [...s.selectedIds, id]
      const primary = nextIds.length > 0 ? nextIds[nextIds.length - 1] : null
      return { selectedIds: nextIds, selectedId: primary }
    })
  },

  selectMultiple: (ids) => set({ selectedIds: ids, selectedId: ids.length > 0 ? ids[ids.length - 1] : null }),

  copy: (nodeId) => {
    const { tree } = get()
    if (!tree) return
    const node = findNode(tree, nodeId)
    if (!node) return
    // Store the real node, not a clone — ids are only freshened at paste
    // time (in `paste`), so pasting the same clipboard entry twice never
    // collides on id.
    set({ clipboard: node })
  },

  paste: (targetParentId, index) => {
    const { clipboard } = get()
    if (!clipboard) return
    const node = cloneNodeWithFreshIds(clipboard)
    get().dispatch({ type: 'InsertComponent', parentId: targetParentId, index, node })
    get().select(node.id)
  },

  duplicateSelected: () => {
    const { tree, selectedIds, selectedId } = get()
    if (!tree) return
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []
    const newIds: string[] = []
    for (const id of ids) {
      const node = findNode(tree, id)
      if (!node) continue
      const newNode = cloneNodeWithFreshIds(node)
      newIds.push(newNode.id)
      get().dispatch({ type: 'DuplicateNode', nodeId: id, newNode })
    }
    if (newIds.length > 0) get().selectMultiple(newIds)
  },

  setBreakpoint: (breakpoint) => set({ breakpoint }),

  dispatch: (command) => {
    const { tree, baselineTree, featureId, pageRef, designStateId, alternativeId } = get()
    if (!tree) return
    const inverse = invertCommand(tree, command)
    if (!inverse) return // command targeted a node that no longer exists — no-op
    const nextTree = applyCommand(tree, command)
    if (nextTree === tree) return // blocked (e.g. locked node) — no history entry, no save

    const ownerId = alternativeId ?? designStateId
    const context: OperationContext | null = baselineTree && featureId && pageRef && designStateId && ownerId
      ? { featureId, ownerId, pageRef, designStateId, alternativeId }
      : null
    set((s) => {
      const past = [...s.past, { command, inverse }]
      if (past.length > MAX_HISTORY) past.shift()
      return { tree: nextTree, operations: context && baselineTree ? composeDesignOperations(baselineTree, s.operations, command, context) : s.operations, past, future: [] }
    })
    scheduleSave(get, set)
  },

  undo: () => {
    const { past, tree, baselineTree, featureId, pageRef, designStateId, alternativeId } = get()
    if (past.length === 0 || !tree) return
    const entry = past[past.length - 1]
    const nextTree = applyCommand(tree, entry.inverse)
    const ownerId = alternativeId ?? designStateId
    const context: OperationContext | null = baselineTree && featureId && pageRef && designStateId && ownerId ? { featureId, ownerId, pageRef, designStateId, alternativeId } : null
    set((s) => ({
      tree: nextTree,
      operations: context && baselineTree ? composeDesignOperations(baselineTree, s.operations, entry.inverse, context) : s.operations,
      past: s.past.slice(0, -1),
      future: [...s.future, entry],
    }))
    scheduleSave(get, set)
  },

  redo: () => {
    const { future, tree, baselineTree, featureId, pageRef, designStateId, alternativeId } = get()
    if (future.length === 0 || !tree) return
    const entry = future[future.length - 1]
    const nextTree = applyCommand(tree, entry.command)
    const ownerId = alternativeId ?? designStateId
    const context: OperationContext | null = baselineTree && featureId && pageRef && designStateId && ownerId ? { featureId, ownerId, pageRef, designStateId, alternativeId } : null
    set((s) => ({
      tree: nextTree,
      operations: context && baselineTree ? composeDesignOperations(baselineTree, s.operations, entry.command, context) : s.operations,
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
    const { projectId, flowId, screenId, designStateId, alternativeId, featureId, operations, tree } = get()
    if (!projectId || !tree) return
    set({ saving: true })
    if (designStateId && featureId) {
      await window.frameui.workspace.saveDesignOperations(projectId, featureId, alternativeId ?? designStateId, operations)
    } else if (flowId && screenId) {
      await window.frameui.workspace.saveScreenDraft({
        id: screenId,
        projectId,
        flowId,
        tree,
        updatedAt: new Date().toISOString(),
      })
    } else {
      set({ saving: false, saveTimer: null })
      return
    }
    set({ saving: false, saveTimer: null })
  }, SAVE_DEBOUNCE_MS)
  set({ saveTimer: timer })
}
