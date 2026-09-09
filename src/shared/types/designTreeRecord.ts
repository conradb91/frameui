import type { DesignNode } from './designNode'

/** One generic "id -> design tree" record shared by `DesignState` and
 * `Alternative` (spec Phase 17/19) — both are structurally the same
 * relationship `ScreenDraft` already models for a Flow's screen node,
 * generalized by owner id instead of introducing near-duplicate tables. */
export interface DesignTreeRecord {
  /** A `DesignState.id` or `Alternative.id` — whichever owns this tree. */
  ownerId: string
  projectId: string
  tree: DesignNode
  updatedAt: string
}
