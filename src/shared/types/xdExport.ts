import type { VisualDocument } from './visualDesign'
export interface XdExportRequest {
  jobId: string
  document: VisualDocument
  scope: 'all' | 'selected' | 'current'
  pageId?: string
  pageIds?: string[]
  includePrototype: boolean
}
export interface XdExportReport {
  format: 'xd'
  structuralValidation: 'passed'
  applicationValidation: 'unverified'
  artboards: number
  layers: number
  editableText: number
  editableVectors: number
  images: number
  components: number
  linkedInstances: number
  clippingMasks: number
  nativeEffects: number
  warnings: string[]
}
export interface XdExportResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  error?: string
  report?: XdExportReport
}
