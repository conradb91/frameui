import type { CapturedElement } from './runtimeCapture'
import type { PageStructureItem } from './pageStructure'
import type { SourceReference } from './model/sourceReference'

export type DesignSystemCategory = 'components' | 'colours' | 'typography' | 'spacing' | 'radius' | 'borders' | 'shadows' | 'icons' | 'breakpoints' | 'layouts' | 'forms' | 'navigation' | 'page-patterns' | 'feedback-patterns' | 'other-patterns'
export type ComponentCategory = 'Buttons' | 'Inputs' | 'Selects' | 'Checkboxes' | 'Navigation' | 'Tabs' | 'Cards' | 'Tables' | 'Modals' | 'Drawers' | 'Badges' | 'Alerts' | 'Toasts' | 'Page Headers' | 'Empty States' | 'Loading States' | 'Forms' | 'Project Components'
export type ObservationStatus = 'observed' | 'approved' | 'exception' | 'unknown'
export type PreviewApproach = 'source' | 'context' | 'runtime' | 'unavailable'
export type FixtureOrigin = 'detected' | 'captured' | 'user-defined'

export interface ComponentPropOption { name: string; required: boolean; type: string; values: string[]; defaultValue: string | null }
export interface DetectedComponentFixture { id: string; name: string; origin: FixtureOrigin; props: Record<string, string> }
export interface ComponentUsage { pageId: string; pageName: string; route: string | null; source: SourceReference; count: number }
export interface ComponentIntelligence {
  componentId: string
  category: ComponentCategory
  frameworkOrigin: string
  props: ComponentPropOption[]
  fixtures: DetectedComponentFixture[]
  sourceStructure: PageStructureItem[]
  /** Non-executing, source-derived DOM/CSS document for a sandboxed visual
   * preview. Null when static rendering would be misleading or unsafe. */
  previewDocument: { html: string; css: string } | null
  contextRequirements: string[]
  tokenIds: string[]
  layoutBehaviours: string[]
  responsiveBehaviours: string[]
  usages: ComponentUsage[]
  previewApproach: PreviewApproach
  previewUnavailableReason: string | null
  dependencyPaths: string[]
  dependencyFingerprint: string
  relatedComponentIds: string[]
  searchText: string
}

export interface DesignValueObservation {
  id: string
  category: 'colour' | 'typography' | 'spacing' | 'radius' | 'border' | 'shadow' | 'icon' | 'breakpoint'
  name: string
  value: string
  usageCount: number
  sources: SourceReference[]
  pageIds: string[]
  status: ObservationStatus
}

export interface DesignPattern {
  id: string
  category: 'layout' | 'form' | 'navigation' | 'page' | 'feedback' | 'other'
  name: string
  description: string
  pageIds: string[]
  componentIds: string[]
  evidence: string[]
}

export type ConsistencyFindingKind = 'possible-duplicate-component' | 'near-duplicate-colour' | 'spacing-outlier' | 'radius-outlier' | 'typography-difference' | 'pattern-difference' | 'responsive-difference'
export interface ConsistencyFinding {
  id: string
  kind: ConsistencyFindingKind
  title: string
  description: string
  commonValue: string | null
  observedValue: string | null
  instanceCount: number
  componentIds: string[]
  pageIds: string[]
  sources: SourceReference[]
  evidence: string[]
  evidenceSignature: string
}

export interface DesignSystemModel {
  version: 1
  generatedAt: string
  categories: DesignSystemCategory[]
  components: ComponentIntelligence[]
  observations: DesignValueObservation[]
  patterns: DesignPattern[]
  findings: ConsistencyFinding[]
}

export interface UserComponentFixture extends DetectedComponentFixture { projectId: string; componentId: string; updatedAt: string }
export interface PreviewCacheEntry {
  componentId: string
  fixtureId: string | null
  approach: PreviewApproach
  dependencyFingerprint: string
  structure: PageStructureItem[] | null
  runtimeElement: CapturedElement | null
  runtimeCaptureId: string | null
  failureReason: string | null
  updatedAt: string
}
export interface RuntimeComponentRelationship {
  id: string
  componentId: string
  captureId: string
  pageId: string | null
  routePatternId: string | null
  viewport: { width: number; height: number }
  stateLabel: string
  elementPath: number[]
  sourceReference: SourceReference
  visualSignature: string
}
export interface FindingDecision {
  findingId: string
  evidenceSignature: string
  status: 'intentional' | 'dismissed'
  note: string
  updatedAt: string
}
export interface DesignSystemWorkspaceData {
  schemaVersion: 1
  projectId: string
  fixtures: UserComponentFixture[]
  previewCache: PreviewCacheEntry[]
  runtimeRelationships: RuntimeComponentRelationship[]
  findingDecisions: FindingDecision[]
  approvedObservationIds: string[]
  patternClassifications: Record<string, string>
  updatedAt: string
}
