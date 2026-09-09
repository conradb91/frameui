import type { ProjectModel } from './model/projectModel'

export type SupportLevel = 'supported' | 'partial' | 'inspect-only'
export type Framework = 'react' | 'vue' | 'svelte' | 'astro' | 'node' | 'php' | 'static' | 'unknown'
export type Language = 'typescript' | 'javascript' | 'php' | 'html' | 'mixed' | 'unknown'
export type Bundler = 'vite' | 'next' | 'astro' | 'node' | 'unknown'
export type RouterStyle = 'next-app' | 'next-pages' | 'filesystem' | 'templates' | 'static' | 'conventional' | 'codeigniter' | 'unknown'
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
}

export interface ProjectIndex {
  projectId: string
  rootPath: string
  supportLevel: SupportLevel
  framework: Framework
  phpFramework: PhpFramework
  language: Language
  bundler: Bundler
  routerStyle: RouterStyle
  devCommand: DevCommand | null
  /** Framework-neutral Design Model (spec §0, Layer A) consumed by every
   * workspace section and IPC handler — the sole place pages, components,
   * tokens and their relationships are exposed past this module. */
  projectModel: ProjectModel
  scannedFileCount: number
  scanDurationMs: number
  scannedAt: string // ISO timestamp
}

export interface FileChangeNotice {
  projectId: string
  changedPaths: string[]
}

/** Real, sequential stage completions emitted by `indexProject` as it runs —
 * not fake timers. Steps fire in this order, though a caller only cares that
 * later steps imply earlier ones are done. */
export type IndexProgressStep = 'detecting' | 'pages' | 'components' | 'tokens' | 'model' | 'done'

export interface IndexProgressUpdate {
  step: IndexProgressStep
}
