import type { DesignNode } from './designNode'

export interface ScreenDraft {
  /** Matches the owning flow's screen-node id. */
  id: string
  projectId: string
  flowId: string
  tree: DesignNode
  updatedAt: string
}
