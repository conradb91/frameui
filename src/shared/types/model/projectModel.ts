import type { SourceReference } from './sourceReference'
import type { PageStructureItem } from '../pageStructure'
import type { DesignSystemModel } from '../designSystem'

/**
 * The auto-derived, read-only "Project Model" (Design Model spec §0,
 * Layer A) — everything FrameUI can determine about what the codebase
 * itself contains, recomputed on every scan/reindex. This supersedes the
 * old `ProjectDesignModel`/`DesignScreen`/`DesignRoute`/`DesignInteraction`/
 * `ProductArea`/`DesignDiagnostic` shapes.
 *
 * User-authored work (Features, Journeys, Annotations, Versions) is a
 * separate, persisted layer — see `featureModel.ts` — deliberately kept out
 * of this file so a Feature never becomes "a giant FrameUI design file."
 */

export type Viewport = 'desktop' | 'tablet' | 'mobile'

/** A page's normalized route, e.g. "/invoice/:id/edit" — dynamic segments
 * already collapsed to ":param" form by the owning adapter. One pattern per
 * page for now; merging multiple observed URLs into one pattern (spec §4)
 * is later, runtime-observation-dependent work. */
export interface RoutePattern {
  id: string
  path: string
  pageId: string
  source: SourceReference
}

export type PageStateKind = 'default' | 'captured'

export interface PageState {
  id: string
  pageId: string
  name: string
  kind: PageStateKind
}

export type PageAnalysisStatus = 'ready' | 'empty' | 'unreadable'

export interface Page {
  id: string
  applicationId?: string
  name: string
  /** Denormalized display copy of the matching `RoutePattern.path`, or null
   * when this page has no resolvable route. */
  route: string | null
  routeId: string | null
  area: string
  source: SourceReference
  structure: PageStructureItem[]
  elementCount: number
  componentNames: string[]
  textContent: string[]
  supportedViewports: Viewport[]
  states: PageState[]
  analysisStatus: PageAnalysisStatus
}

export interface Area {
  id: string
  name: string
  pageIds: string[]
}

export type ComponentExportKind = 'default' | 'named' | 'template'

export interface Component {
  id: string
  applicationId?: string
  name: string
  exportKind: ComponentExportKind
  source: SourceReference
}

export type TokenCategory = 'color' | 'spacing' | 'radius' | 'breakpoint' | 'typography' | 'effect'
export type TokenConfidence = 'full' | 'unresolved'
export type TokenSource = 'tailwind-v3' | 'tailwind-v4' | 'css-custom-properties' | 'stylesheets' | 'none'

export interface Token {
  id: string
  category: TokenCategory
  name: string
  value: string
  confidence: TokenConfidence
}

/** A named, reusable rule composed of token references (e.g. "Heading/H1" =
 * {fontSize: token X, color: token Y}). Type-only for now — no adapter yet
 * extracts typography/box styles into named rules; kept here so future
 * phases don't need another schema rewrite. */
export interface Style {
  source?: SourceReference
  id: string
  name: string
  tokenIds: string[]
}

/** Type-only for now, same reasoning as `Style` — no asset-detecting
 * adapter exists yet. */
export interface Asset {
  id: string
  name: string
  kind: 'image' | 'icon' | 'font' | 'other'
  source: SourceReference
}

export type InteractionTrigger = 'link' | 'form' | 'programmatic'

export interface Interaction {
  id: string
  sourcePageId: string
  destinationPageId: string | null
  destinationRoute: string
  label: string
  trigger: InteractionTrigger
  source: SourceReference
  resolved: boolean
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error'
export type DiagnosticKind = 'unresolved-navigation' | 'empty-page' | 'unreadable-page'

export interface Diagnostic {
  id: string
  severity: DiagnosticSeverity
  kind: DiagnosticKind
  title: string
  detail: string
  pageId: string
  source: SourceReference
}

export interface ProjectModel {
  version: 1
  projectId: string
  generatedAt: string
  pages: Page[]
  routes: RoutePattern[]
  areas: Area[]
  components: Component[]
  tokens: Token[]
  tokenSource: TokenSource
  styles: Style[]
  assets: Asset[]
  assetRoots?: string[]
  sourceRelationships?: { sourceFile: string; targetFile: string; kind: 'component' | 'layout' }[]
  interactions: Interaction[]
  diagnostics: Diagnostic[]
  /** Phase 30-33 source-derived product UI intelligence. Optional keeps
   * persisted/pre-upgrade indexes readable until their next reindex. */
  designSystem?: DesignSystemModel
  statistics: {
    pages: number
    components: number
    tokens: number
    layouts: number
    navigationGroups: number
    connections: number
    unresolvedRoutes: number
    issues: number
    renderIssues: number
  }
}
