import type { PackageJsonInfo } from './shared/packageJson'
import type { ComposerJsonInfo } from './shared/composerJson'
import type { IgnoreRules } from '@core/indexer/ignore'
import type { Bundler, DetectedComponent, DetectedPage, DevCommand, Framework, PhpFramework, RouterStyle } from '@shared/types/projectIndex'
import type { PageStructureItem } from '@shared/types/pageStructure'

/**
 * Everything an adapter needs to detect and parse a project — built once
 * per `indexProject` call and passed through unchanged. Adapters read this,
 * new adapters should use this scoped file set for discovery.
 */
export interface AdapterContext {
  rootPath: string
  pkg: PackageJsonInfo | null
  composer: ComposerJsonInfo | null
  candidateFiles: string[]
  ignoreRules: IgnoreRules
}

/** What `detect()` reports once an adapter recognizes the project — the
 * framework-level facts `indexProject` used to compute inline via nested
 * ternaries. */
export interface AdapterMatch {
  framework: Framework
  phpFramework: PhpFramework
  bundler: Bundler
  routerStyle: RouterStyle
  routesDir: string | null
  devCommand: DevCommand | null
}

/** A composable source importer. All contributions feed the same Design Model. */
export interface SourceAdapter {
  /** Stable id for logging/debugging. */
  id: string
  /** File extensions contributed to scanning and cache validation. */
  extensions?: string[]
  /** Project-relative directories served at the application URL root. */
  assetRoots?: string[]
  /** Lower priority generic importers only claim files left by specific adapters. */
  fallback?: boolean
  ownsFile?(filePath: string): boolean
  readStructure?(content: string, filePath: string, knownNames: Set<string>, includeRoot: boolean): PageStructureItem[] | null
  /** Returns match metadata when this adapter recognizes the project, or
   * null when it doesn't apply. */
  detect(ctx: AdapterContext): AdapterMatch | null
  findPages(ctx: AdapterContext, match: AdapterMatch): DetectedPage[]
  /** The adapter's own discovered pages. Importers can exclude them from
   * components or retain reusable routed components where appropriate. */
  findComponents(ctx: AdapterContext, match: AdapterMatch, pages: DetectedPage[]): DetectedComponent[]
}
