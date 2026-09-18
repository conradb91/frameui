/** Framework-independent, source-derived design input. Never contains executable code. */
export interface DesignIRNode {
  id: string
  tag: string
  name: string
  source: { file: string; line?: number; component?: string }
  attributes: Record<string, string>
  text?: string
  children: DesignIRNode[]
  unsupported?: string
}
export interface DesignIR {
  version: 1
  pageId: string
  name: string
  route: string
  nodes: DesignIRNode[]
  styles: string
  dependencies: string[]
  hash: string
  states: string[]
  state: string
  generatedData: boolean
  dataSchemas: { name: string; source: string; fields: { name: string; type: string }[] }[]
  warnings: string[]
  status: 'ready' | 'partial' | 'unsupported'
}
