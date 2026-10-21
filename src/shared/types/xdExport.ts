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
  scrollGroups?:number
  prototype?:{exact:number;simulated:number;unsupported:number;ready:false;status:'unsupported-interactions'|'partial-discovery'|'application-validation-required';details:{id:string;source:string;destination?:string;trigger:string;status:'exact'|'simulated'|'unsupported';reason:string}[];flows:{id:string;name:string;start?:string;artboards:string[]}[]}
  warnings: string[]
}
export interface XdExportResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  error?: string
  report?: XdExportReport
}
