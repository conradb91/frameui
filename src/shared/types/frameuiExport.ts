export type FrameUiExportTarget = 'figma' | 'adobe-xd'
export type FrameUiExportScope = 'selection' | 'artboard' | 'design' | 'all-designs'

export interface FrameUiPackageFile {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
}

export interface FrameUiExportOptions {
  scope: FrameUiExportScope
  includeComponents: boolean
  includeTokens: boolean
  includePrototype: boolean
  includeHiddenLayers: boolean
  includeAnnotations: boolean
  rasterizeUnsupported: 'ask' | 'always' | 'never'
  outlineMissingFonts: boolean
}

export type FrameUiNodeType =
  | 'PAGE'
  | 'FRAME'
  | 'GROUP'
  | 'TEXT'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'LINE'
  | 'VECTOR'
  | 'IMAGE'
  | 'COMPONENT'
  | 'COMPONENT_INSTANCE'
  | 'ICON'
  | 'BOOLEAN'
  | 'MASK'
  | 'SECTION'

export interface FrameUiExportNode {
  id: string
  type: FrameUiNodeType
  name: string
  parentId: string | null
  childIds: string[]
  children: FrameUiExportNode[]
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  zIndex: number
  clipContent: boolean
  layout: {
    mode: 'FREE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID'
    wrap: boolean
    gap: number
    padding: { top: number; right: number; bottom: number; left: number }
    align: string
    justify: string
    constraints: string
    minWidth?: number
    maxWidth?: number
    minHeight?: number
    maxHeight?: number
  }
  fills: FrameUiPaint[]
  strokes: FrameUiPaint[]
  strokeWidth: number
  radius: [number, number, number, number]
  effects: FrameUiEffect[]
  text?: {
    characters: string
    fontFamily: string
    fontStyle: string
    fontWeight: string
    fontSize: number
    lineHeight: number
    letterSpacing: number
    alignment: string
    decoration?: string
    case?: string
    paragraphSpacing?: number
    runs?: import('./richText').TextStyleRun[]
  }
  vector?: { path?: string; viewBox?: string; svg?: string }
  image?: { assetId: string; fit: 'COVER' | 'CONTAIN' | 'FILL' }
  component?: {
    componentId: string
    variant?: Record<string, string>
    overrides?: string[]
    variants?: { id: string; name: string; properties: Record<string, string>; children: FrameUiExportNode[] }[]
  }
  tokenBindings?: Record<string, string>
  source?: { component?: string; selector?: string }
}

export type FrameUiPaint =
  | { type: 'SOLID'; color: string; opacity: number }
  | { type: 'GRADIENT'; value: string; opacity: number }

export interface FrameUiEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR' | 'UNSUPPORTED'
  value: string
  radius?: number
}

export interface FrameUiExportPage {
  id: string
  name: string
  folder: string
  width: number
  height: number
  state: string
  route?: string
  root: FrameUiExportNode
}

export interface FrameUiExportAsset {
  id: string
  name: string
  kind: 'IMAGE' | 'VECTOR'
  mimeType: string
  path: string
  width?: number
  height?: number
}

export interface FrameUiExportFont {
  family: string
  style: string
  weight: string
  status: 'CHECK_ON_IMPORT'
}

export interface FrameUiExportToken {
  id: string
  collection: string
  name: string
  type: 'COLOR' | 'NUMBER' | 'STRING' | 'BOOLEAN'
  value: string | number | boolean
}

export interface FrameUiExportWarning {
  code: string
  message: string
  nodeId?: string
  severity: 'warning' | 'error'
}

export interface FrameUiExportManifest {
  formatVersion: '1.0.0'
  frameuiVersion: string
  frameuiDocumentId: string
  projectName: string
  exportedAt: string
  documentName: string
  documentWidthUnit: 'px'
  colourSpace: 'sRGB'
  pageCount: number
  artboardCount: number
  componentCount: number
  assetCount: number
  tokenCount: number
  targetApplication: 'Figma' | 'Adobe XD'
  targetVersion: 'current'
  scope: FrameUiExportScope
  warnings: number
}

export interface FrameUiPackageBuild {
  files: FrameUiPackageFile[]
  manifest: FrameUiExportManifest
  warnings: FrameUiExportWarning[]
  stats: { designs: number; artboards: number; components: number; assets: number; variables: number }
}
