export interface DatabaseSource { engine?: 'postgres' | 'mariadb' | 'sqlite'; path: string; kind: 'file' | 'migrations'; signature: string; count?: number }
export interface HostingStep { id: string; label: string; detail: string; status: string; required: boolean; version?: string; engines?: string[]; detectedEngine?: string; command?: string }
export interface HostingSnapshot {
  projectId: string
  name: string
  framework: string
  localUrl: string
  prepared?: boolean
  running: boolean
  ready: boolean
  remoteDatabase?: boolean
  database?: string
  managedDatabase?: boolean
  reviewId: string
  blocking: boolean
  savedDatabase?: HostingOptions['database']
  savedSource?: DatabaseSource
  sourceChanged?: boolean
  sources?: DatabaseSource[]
  setup?: { status: string; currentStep?: string; failure?: { step: string; message: string }; completedSteps?: string[] }
  steps: HostingStep[]
}
export interface HostingOptions {
  reviewId: string
  approveChanges: boolean
  database: 'skip' | 'existing' | 'sqlite' | 'postgres' | 'mariadb'
  databaseSource?: DatabaseSource
  startWhenReady: boolean
}
export interface HostingEvent { projectId: string; channel: string; detail: string; stage?: string; status?: string }
export interface HostingEnvironment { file: string | null; variables: { key: string; value: string; secret: boolean; configured: boolean }[] }
export interface HostingCreatePlan { token: string; name: string; framework: string; location: string; detail: string; blocked: boolean }
export interface HostingHealth { checks: { id: string; label: string; status: string; detail: string }[]; summary: { failed: number; warnings: number; healthy: number; total: number } }
export type HostingAction = 'start' | 'stop' | 'health' | 'logs' | 'migration-status' | 'migrate' | 'restore-database'
