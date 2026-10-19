export interface ArtifactImportProgress {
  id: string
  stage: 'extract' | 'discover'
  file?: string
  completed: number
  total?: number
  screens?: number
  connections?: number
  detail: string
}
