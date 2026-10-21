import type { StructuredFrame } from './structuredDesign'
import type { TextStyleRun } from './richText'

/** Persisted design objects, independent of the capture DOM and SVG renderer. */
export type VisualKind =
  | 'Frame'
  | 'Group'
  | 'Section'
  | 'Text'
  | 'Rectangle'
  | 'Ellipse'
  | 'Line'
  | 'Polygon'
  | 'Vector'
  | 'Image'
  | 'Icon'
  | 'Component'
  | 'Instance'
  | 'Button'
  | 'Input'
  | 'Select'
  | 'Checkbox'
  | 'Radio'
  | 'Toggle'
  | 'Card'
  | 'Table'
  | 'Navigation'
  | 'Modal'
  | 'Badge'
  | 'Avatar'
export interface VisualObject {
  /** User-created overlay on a captured structured page. */
  designOnly?: boolean
  id: string
  kind: VisualKind
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
  fillOpacity: number
  strokeOpacity: number
  radius: [number, number, number, number]
  hidden: boolean
  locked: boolean
  clip: boolean
  interaction?: {
    targetPageId: string
    transition: 'Instant' | 'Dissolve' | 'Slide'
    trigger: 'Click' | 'Hover'
  }
  imageFit?: 'cover' | 'contain' | 'fill'
  arrow?: boolean
  text?: string
  /** Optional range formatting. Absent keeps older saved designs valid. */
  textRuns?: TextStyleRun[]
  src?: string
  path?: string
  viewBox?: string
  fontFamily: string
  fontSize: number
  fontWeight: string
  lineHeight: number
  letterSpacing: number
  textAlign: string
  textDecoration?: string
  shadow?: string
  blur?: number
  gradient?: string
  layout: {
    direction: string
    alignment: string
    distribution: string
    gap: number
    padding: number
    wrap: boolean
    constraints: string
    minWidth?: number
    maxWidth?: number
    grid?: string
  }
  source?: {
    file?: string
    component?: string
    route?: string
    selector?: string
    destination?: string
  }
  componentId?: string
  overrides?: string[]
  variants?: {
    id: string
    name: string
    properties: Record<string, string>
    objects: VisualObject[]
  }[]
  variant?: Record<string, string>
  bindings?: Record<string, string>
  children: VisualObject[]
}
export interface VisualPage {
  /** Editable canvas-only explanation for an imported prototype journey. */
  flowIntroductionFor?: string
  canonicalStateId?:string
  flowInstanceFor?:string
  artifactSource?: { path: string; steps: import('../artifactDiscovery').ReplayStep[] }
  sourceDesign?: { pageId: string; state: string; states: string[]; status: 'ready' | 'partial' | 'unsupported'; generatedData: boolean }
  id: string
  name: string
  folder: string
  pinned: boolean
  captureWarnings?: string[]
  authProfile?: string
  state: string
  route?: string
  sourceHash?: string
  capturedAt?: string
  width: number
  height: number
  /** User-controlled position of this page on the shared design canvas. */
  canvasX?: number
  canvasY?: number
  /** Optional editor-only layout grid, persisted with the design file. */
  layoutGrid?: {
    visible: boolean
    type: 'columns' | 'grid'
    size: number
    columns: number
    gutter: number
    margin: number
    color: string
    opacity: number
  }
  fonts?: { family: string; weight: string; style: string; unicodeRange?: string; stretch?: string; data: string }[]
  objects: VisualObject[]
  /** The FrameUI Design Model rendering of this exact same capture, used
   * live in the canvas (`DesignIde.tsx`) when present instead of `objects`/
   * `VisualSvg`. `objects` stays populated regardless — SVG export, the
   * Layers panel, and rendering any page without `structured` (documents
   * saved before the capture-engine rebuild, or a capture that failed and
   * fell back) all still read it. */
  structured?: StructuredFrame
  thumbnail?: string
  /** A true full-page reference screenshot (beyond the viewport), captured
   * after scroll-to-settle. Reference/comparison data only — not consumed
   * by the canvas. */
  fullPageScreenshot?: string
  /** Small full-page bitmap for canvas overview; native layers remain the editable source. */
  canvasPreview?: string
  edited?: boolean
  importedObjects?: VisualObject[]
  captureStatus?:
    | 'Up to date'
    | 'Modified'
    | 'Source changed'
    | 'Capture issue'
    | 'Conflict'
  conflicts?: {
    id: string
    objectId: string
    name: string
    property: string
    local: unknown
    incoming: unknown
  }[]
}
export interface DesignVariable {
  id: string
  collection: string
  name: string
  type: 'Colour' | 'Number' | 'String' | 'Boolean'
  value: string
}
export interface PageRegistryEntry extends CaptureRoute {
  captureError?: string
  captureErrorProfile?: string
  authProfile: string
  area: string
  status: 'Discovered' | 'Needs Sample Data' | 'Captured' | 'Failed'
}
export interface VisualDocument {
  prototype?: import('./prototype').PrototypeData
  sourceComponents?: { id: string; name: string; file: string }[]
  pageRegistry?: PageRegistryEntry[]
  version: 1
  id: string
  name: string
  projectId?: string
  appUrl?: string
  libraryId?: string
  pages: VisualPage[]
  components: VisualObject[]
  variables: DesignVariable[]
  updatedAt: string
}
export interface ApplicationCandidate {
  url: string
  title: string
  matches: boolean
}
export interface CaptureRoute {
  needsSample?: boolean
  url: string
  pattern: string
  name: string
  source?: string
  hash?: string
  /** How this route was discovered — a route found by both static source
   * analysis and the runtime crawl is high confidence; source-only may be
   * unused/hidden/dev-only; runtime-only may be dynamically generated or
   * missed by static analysis. */
  sources?: ('source' | 'runtime' | 'manual')[]
}
export interface CaptureProgress {
  artifactImportId?: string
  thumbnail?: string
  route?: string
  width?: number
  completed: number
  total: number
  name: string
  status: 'Processing' | 'Complete' | 'Failed'
  error?: string
}
/** Sub-page stages of a single `design:captureCurrentState` call — real
 * checkpoints inside that handler (and the renderer's own post-processing
 * step after it resolves), not a fabricated timer. Each value is sent the
 * moment that stage actually begins. */
export type CaptureStage = 'layout' | 'screenshot' | 'assets' | 'building'
