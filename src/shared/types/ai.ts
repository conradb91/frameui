export type ClaudeEffort='default'|'low'|'medium'|'high'|'xhigh'|'max'
import type { VisualDocument } from './visualDesign'
export interface ClaudeStatus {
  connected: boolean
  authentication: 'api-key' | 'cli' | 'claude-code' | null
  model: string
  effort?: ClaudeEffort
  models: { id: string; name: string; description?: string; effortLevels?: Exclude<ClaudeEffort,'default'>[] }[]
  workspace?: string
  claudeCodeAvailable: boolean
  cliAvailable: boolean
  browserLoginAvailable: boolean
}
export interface AiRequest {
  design?: import('../aiDesign').AiDesignSettings
  draftId?: string
  target?: import('./prototype').PrototypeTarget
  revisionPageId?: string
  document: VisualDocument
  pageId: string
  selection: string[]
  prompt: string
  mode: 'design' | 'code'
  structure?: 'preserve' | 'explore'
  style: 'project' | 'reference'
  history?: { role: 'user' | 'assistant'; content: string; reference?: string }[]
  reference?: string
}
export interface AiFileChange { path: string; before: string | null; after: string; reason: string }
export interface AiActivity { runId: string; message: string; kind?: 'text' | 'status' }
export interface AiResult {
  designReview?: import('../../core/ai/designContext').DesignReview
  draft?: import('./prototype').PrototypeDraft
  runId: string
  document: VisualDocument
  message: string
  changes: AiFileChange[]
  commands: { id: string; name: string; command: string; args: string[]; cwd: string }[]
  runtimeValidationRequested?: boolean
  runtimeValidation?: {url:string;pageId:string}
  comparison?: { matchPercent: number; description: string }
}
export interface AiApi {
  status(): Promise<ClaudeStatus>
  connect(method: 'api-key' | 'cli' | 'cli-login' | 'claude-code' | 'claude-code-login', workspace?:string): Promise<ClaudeStatus>
  disconnect(): Promise<ClaudeStatus>
  setEffort(effort:ClaudeEffort): Promise<ClaudeStatus>
  setModel(model: string): Promise<ClaudeStatus>
  run(input: AiRequest): Promise<AiResult>
  cancel(): Promise<void>
  stopProject(): Promise<void>
  validateRuntime(runId:string): Promise<{image:string;matchPercent:number;description:string}>
  apply(runId: string): Promise<{ checkpoint: string }>
  undo(checkpoint: string): Promise<void>
  runCommand(runId: string, commandId: string): Promise<{ output: string; exitCode: number | null }>
  onActivity(callback: (activity: AiActivity) => void): () => void
}
