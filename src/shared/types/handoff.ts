import type { DesignNode, Breakpoint, ResponsiveOverride } from './designNode'
import type { Annotation, ConceptComponent, DesignOperation, DesignState, Feature, FeaturePage, Journey, PageRef, Provenance, Version } from './model/featureModel'
import type { Component, Component as ProjectComponent, Page, ProjectModel, Token } from './model/projectModel'

export type HandoffPageKind = 'existing' | 'modified' | 'new' | 'reference'

export interface HandoffState {
  id: string
  name: string
  origin: DesignState['origin']
  viewport: Breakpoint[]
  differences: string[]
  interactions: string[]
  componentIds: string[]
  notes: Annotation[]
}

export interface HandoffPage {
  ref: PageRef
  name: string
  route: string | null
  kind: HandoffPageKind
  sourcePath: string | null
  states: HandoffState[]
  responsive: { nodeId: string; nodeName: string; breakpoint: Exclude<Breakpoint, 'desktop'>; override: ResponsiveOverride }[]
  annotations: Annotation[]
  componentIds: string[]
}

export interface HandoffComponent {
  id: string
  name: string
  kind: 'reused' | 'modified' | 'new'
  sourcePath: string | null
  usageCount: number
  pageNames: string[]
  props: { name: string; type: string; required: boolean; defaultValue: string | null }[]
  variants: string[]
  changes: string[]
  responsive: string[]
}

export interface HandoffInteraction {
  id: string
  journeyName: string
  trigger: string
  element: string
  from: string
  to: string
  label: string
}

export interface HandoffChange {
  id: string
  pageName: string
  element: string
  description: string
  technical: DesignOperation
}

export interface FeatureHandoff {
  feature: Feature
  approvedVersion: Version | null
  summary: {
    pages: number
    changedPages: number
    newPages: number
    referencePages: number
    states: number
    responsiveViews: number
    reusedComponents: number
    modifiedComponents: number
    newComponents: number
    journeySteps: number
    annotations: number
  }
  pages: HandoffPage[]
  components: HandoffComponent[]
  interactions: HandoffInteraction[]
  changes: HandoffChange[]
  notes: Annotation[]
}

export interface HandoffInput {
  feature: Feature
  projectModel: ProjectModel
  featurePages: FeaturePage[]
  states: DesignState[]
  conceptComponents: ConceptComponent[]
  journeys: Journey[]
  annotations: Annotation[]
  versions: Version[]
  operations: DesignOperation[]
  trees: Record<string, DesignNode>
}

export type ExportTextHandling = 'editable' | 'outline-unsafe'
export interface FeatureExportSettings {
  pageRefs: PageRef[]
  stateIds: string[]
  viewports: Breakpoint[]
  componentIds: string[]
  journeyIds: string[]
  includeAnnotations: boolean
  includePageLabels: boolean
  includeMetadata: boolean
  embedImages: boolean
  textHandling: ExportTextHandling
  background: 'design' | 'transparent'
  journeyLayout: 'horizontal' | 'vertical'
}

export interface ExportWarning { code: string; message: string; nodeId?: string }
export interface ExportFile { path: string; content: string; mimeType: 'image/svg+xml' | 'application/json' }
export interface ExportRecord {
  id: string
  featureId: string
  versionId: string | null
  versionName: string
  type: 'page' | 'feature' | 'journey' | 'component'
  fileCount: number
  configuration: FeatureExportSettings
  createdAt: string
  outputPath: string | null
}

/** Format-neutral export scene. SVG and future Figma exporters consume this,
 * keeping format details out of Feature persistence. */
export interface ExportScene {
  id: string
  name: string
  kind: 'page' | 'component'
  pageRef: PageRef | null
  stateId: string | null
  viewport: Breakpoint
  width: number
  tree: DesignNode
  provenance: Provenance
  annotations: Annotation[]
}

export interface DesignExporter<TResult> {
  readonly format: string
  exportScene(scene: ExportScene, settings: FeatureExportSettings): Promise<TResult> | TResult
}

// Re-export-only aliases make exporter consumers independent from where the
// common model currently stores these concepts.
export type ExportProjectComponent = ProjectComponent
export type ExportToken = Token
export type ExportPage = Page
export type ExportComponent = Component
