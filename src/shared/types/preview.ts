export interface PreviewOutputLine {
  line: string
  stream: 'stdout' | 'stderr'
}

export interface PreviewStatusUpdate {
  status: 'idle' | 'running' | 'stopped' | 'error'
  detail?: string
}

export interface PreviewUrlDetected {
  url: string
}
