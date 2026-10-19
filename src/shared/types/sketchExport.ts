import type { VisualDocument } from './visualDesign'
export interface SketchExportRequest {
  jobId: string
  document: VisualDocument
  documents?: VisualDocument[]
  scope: 'artboard' | 'flow' | 'project'
  pageId?: string
  flowId?: string
  includePrototype: boolean
}
export interface SketchExportWarning {
  code: string
  message: string
  artboard?: string
  layerId?: string
  layerName?: string
}
export interface SketchExportReport {
  format: 'sketch'
  schemaVersion: number
  structuralValidation: 'passed'
  xdValidation: 'unverified'
  artboards: number
  layers: number
  editableText: number
  editableVectors: number
  images: number
  groups: number
  components: number
  fallbackEffects: number
  unconvertedInteractions: number
  unsupportedFeatures: number
  missingAssets: number
  failedElements: number
  fontCheck: 'local' | 'unverified'
  missingFonts: string[]
  fontsToCheck: string[]
  warnings: SketchExportWarning[]
  idMap: Record<string, string>
}
export interface SketchExportResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  error?: string
  report?: SketchExportReport
}
