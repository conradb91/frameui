import type { PackageJsonInfo } from './shared/packageJson'
import type { ComposerJsonInfo } from './shared/composerJson'
import type { IgnoreRules } from '@core/indexer/ignore'
import type { Bundler, DetectedComponent, DetectedPage, DevCommand, Framework, PhpFramework, RouterStyle } from '@shared/types/projectIndex'

/**
 * Everything an adapter needs to detect and parse a project — built once
 * per `indexProject` call and passed through unchanged. Adapters read this,
 * they never re-walk the filesystem or re-parse package.json themselves.
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

/**
 * One implementation per framework/ecosystem (Design Model spec §1). The
 * registry (`registry.ts`) tries each adapter's `detect()` in a fixed
 * priority order and uses the first match's `findPages`/`findComponents` —
 * adding a framework means adding one adapter here, not editing
 * `indexProject.ts`. Parsing technique (regex vs. AST) is each adapter's
 * own concern, not part of this contract — swapping an adapter's internals
 * for real AST parsing later (spec §2) never touches the registry.
 */
export interface SourceAdapter {
  /** Stable id for logging/debugging. */
  id: string
  /** Returns match metadata when this adapter recognizes the project, or
   * null when it doesn't apply. */
  detect(ctx: AdapterContext): AdapterMatch | null
  findPages(ctx: AdapterContext, match: AdapterMatch): DetectedPage[]
  /** `pages` is this same call's own `findPages` result — passed in rather
   * than re-derived so a page file is never also counted as a component
   * (matches today's `pageAbsolutePaths` exclusion behavior exactly). */
  findComponents(ctx: AdapterContext, match: AdapterMatch, pages: DetectedPage[]): DetectedComponent[]
}
