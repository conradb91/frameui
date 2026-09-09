export interface ScreenNodeSource {
  type: 'blank' | 'existing-page'
  /** Set when type === 'existing-page' — relative to the project root. */
  pageFilePath?: string
  /** Feature Phase 8/9 integration: a page a Feature added as "Reference
   * Only" (`Feature.referenceOnlyPageIds`) stays visible in its Journey for
   * context but never gets an editable design draft — see `ScreenNode.tsx`
   * and `FlowWorkspaceView.tsx`'s double-click handling. */
  referenceOnly?: boolean
}

export interface FlowScreenNode {
  id: string
  name: string
  source: ScreenNodeSource
  position: { x: number; y: number }
}

export interface FlowEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  label: string
}

export interface Flow {
  id: string
  projectId: string
  /** Owning Feature (spec Phase 6/7), or null for a legacy/project-level
   * flow created before Features existed. New flows created from inside a
   * Feature workspace always set this. */
  featureId: string | null
  name: string
  description: string
  nodes: FlowScreenNode[]
  edges: FlowEdge[]
  createdAt: string
  updatedAt: string
}

export interface FlowSummary {
  id: string
  projectId: string
  featureId: string | null
  name: string
  screenCount: number
  updatedAt: string
}

export function toFlowSummary(flow: Flow): FlowSummary {
  return { id: flow.id, projectId: flow.projectId, featureId: flow.featureId, name: flow.name, screenCount: flow.nodes.length, updatedAt: flow.updatedAt }
}
