export interface ScreenNodeSource {
  type: 'blank' | 'existing-page'
  /** Set when type === 'existing-page' — relative to the project root. */
  pageFilePath?: string
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
  name: string
  screenCount: number
  updatedAt: string
}

export function toFlowSummary(flow: Flow): FlowSummary {
  return { id: flow.id, projectId: flow.projectId, name: flow.name, screenCount: flow.nodes.length, updatedAt: flow.updatedAt }
}
