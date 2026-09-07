import type { StyleTokens } from './styleTokens'

export type SupportLevel = 'supported' | 'partial' | 'inspect-only'
export type Framework = 'react' | 'unknown'
export type Language = 'typescript' | 'javascript' | 'mixed' | 'unknown'
export type Bundler = 'vite' | 'next' | 'unknown'
export type RouterStyle = 'next-app' | 'next-pages' | 'conventional' | 'unknown'

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
  exportKind: 'default' | 'named'
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
  language: Language
  bundler: Bundler
  routerStyle: RouterStyle
  devCommand: DevCommand | null
  pages: DetectedPage[]
  components: DetectedComponent[]
  styleTokens: StyleTokens
  scannedFileCount: number
  scanDurationMs: number
  scannedAt: string // ISO timestamp
}

export interface FileChangeNotice {
  projectId: string
  changedPaths: string[]
}
