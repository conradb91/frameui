import type { ProjectModel } from './model/projectModel'

/** Legacy coarse support is retained for persisted V1 indexes. New code
 * should use `capabilityLevel` and the individual capability flags. */
export type SupportLevel = 'supported' | 'partial' | 'inspect-only'
export type ProjectCapabilityLevel = 'full' | 'partial' | 'runtime-only' | 'source-only' | 'limited'
export type Framework = 'react' | 'vue' | 'svelte' | 'astro' | 'angular' | 'dotnet' | 'node' | 'php' | 'static' | 'unknown' | (string & {})
export type Language = 'typescript' | 'javascript' | 'php' | 'csharp' | 'html' | 'mixed' | 'unknown'
export type Bundler = 'vite' | 'next' | 'astro' | 'node' | 'unknown'
export type RouterStyle = 'next-app' | 'next-pages' | 'filesystem' | 'templates' | 'static' | 'conventional' | 'codeigniter' | 'unknown' | (string & {})
/** V2 spec §4: which PHP framework, when `framework === 'php'`. Kept
 * separate from `Bundler` (a JS-bundler concept) rather than overloading it. */
export type PhpFramework = 'codeigniter' | 'laravel' | null

export interface DetectedPage {
  id: string
  /** Human-friendly label derived from the route/file (e.g. "Dashboard Home"). */
  name: string
  /** Relative to the project root. */
  filePath: string
  /** Best-effort route string, e.g. "/settings/[id]"; null when not derivable. */
  route: string | null
}

export interface DetectedComponent {
  id: string
  name: string
  /** Relative to the project root. */
  filePath: string
  exportKind: 'default' | 'named' | 'template'
}

export interface DevCommand {
  command: string
  args: string[]
  /** Repository-relative application cwd for monorepos. User-entered
   * commands omit this and run at the repository root. */
  workingDirectory?: string
}

export interface ProjectCapabilities {
  sourceStructure: boolean
  runtimePreview: boolean
  componentSourceMapping: 'available' | 'partial' | 'unavailable'
  routeMapping: 'available' | 'partial' | 'unavailable'
  layoutInspection: boolean
  sourcePreview: boolean
  isolatedComponentPreviews: boolean
}

export interface ProjectApplication {
  technologies?: DetectedTechnology[]
  adapterIds?: string[]
  routerStyle?: RouterStyle
  phpFramework?: PhpFramework
  id: string
  name: string
  /** Relative to the repository root; `.` identifies the root app. */
  rootPath: string
  kind: 'application' | 'ui-package' | 'token-package'
  framework: Framework
  bundler: Bundler
  devCommand: DevCommand | null
  url: string | null
  sourceRoots: string[]
  sharedPackageIds: string[]
  capabilities: ProjectCapabilities
}

export interface IndexedFile {
  path: string
  mtimeMs: number
  size: number
  /** Content hashes are kept for configuration and ambiguous timestamp
   * changes; ordinary source files use cheap mtime/size validation. */
  hash?: string
}

export interface DependencyGraph {
  /** File -> stable Project Model object ids declared by that file. */
  fileObjects: Record<string, string[]>
  /** Relative source file -> relative source files it imports/references. */
  dependencies: Record<string, string[]>
  /** Reverse edges, persisted so impact lookup never scans every import. */
  dependents: Record<string, string[]>
  /** Project Model object id -> source files that use it. */
  objectConsumers: Record<string, string[]>
}

export type FileChangeKind = 'created' | 'modified' | 'deleted' | 'renamed'

export interface FileChange {
  path: string
  kind: FileChangeKind
  previousPath?: string
}

export interface IndexUpdateSummary {
  mode: 'cache-hit' | 'initial' | 'incremental' | 'rebuild'
  changedFiles: number
  updatedComponents: number
  affectedPages: number
  affectedFeatureIds: string[]
  invalidatedObjectIds: string[]
  durationMs: number
}

export interface ProjectIndex {
  projectId: string
  rootPath: string
  supportLevel: SupportLevel
  capabilityLevel?: ProjectCapabilityLevel
  capabilities?: ProjectCapabilities
  framework: Framework
  /** All contributing adapters and detected technologies, including mixed stacks. */
  technologies?: DetectedTechnology[]
  adapterIds?: string[]
  phpFramework: PhpFramework
  language: Language
  bundler: Bundler
  routerStyle: RouterStyle
  devCommand: DevCommand | null
  /** Framework-neutral Design Model (spec §0, Layer A) consumed by every
   * workspace section and IPC handler — the sole place pages, components,
   * tokens and their relationships are exposed past this module. */
  projectModel: ProjectModel
  applications?: ProjectApplication[]
  activeApplicationId?: string | null
  /** Application whose scoped objects currently populate projectModel. */
  indexedApplicationId?: string | null
  dependencyGraph?: DependencyGraph
  files?: Record<string, IndexedFile>
  cacheVersion?: number
  parserVersion?: string
  configurationFingerprint?: string
  lastUpdate?: IndexUpdateSummary
  scannedFileCount: number
  scanDurationMs: number
  scannedAt: string // ISO timestamp
}

export interface DetectedTechnology {
  id: string
  kind: 'framework' | 'runtime' | 'language' | 'build-tool' | 'styling' | 'ui-library'
  evidence: string[]
}

export interface FileChangeNotice {
  projectId: string
  changedPaths: string[]
  changes?: FileChange[]
  status?: 'updating' | 'up-to-date' | 'warning'
  summary?: IndexUpdateSummary
}

/** Real, sequential stage completions emitted by `indexProject` as it runs —
 * not fake timers. Steps fire in this order, though a caller only cares that
 * later steps imply earlier ones are done. */
export type IndexProgressStep = 'validating-cache' | 'detecting' | 'pages' | 'components' | 'tokens' | 'dependencies' | 'model' | 'persisting' | 'done'

export interface IndexProgressUpdate {
  step: IndexProgressStep
}
