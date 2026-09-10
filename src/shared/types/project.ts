export interface RecentProject {
  id: string
  name: string
  path: string
  /** First registration time. Optional for records migrated from the
   * original recent-only project file. */
  addedAt?: string
  lastOpenedAt: string // ISO timestamp
  missing?: boolean
}

export type ProjectRepositoryStatus = 'ready' | 'not-indexed' | 'missing'

export interface ProjectLibraryEntry extends RecentProject {
  framework: string | null
  language: string | null
  pageCount: number | null
  componentCount: number | null
  repositoryStatus: ProjectRepositoryStatus
  branch: string | null
  indexedAt: string | null
  recent: boolean
}

export interface ProjectRecentEntry {
  projectId: string
  openedAt: string
}

export type OpenProjectResult = { cancelled: true } | { cancelled: false; project: RecentProject }

export type OpenRecentResult = { ok: true; project: RecentProject } | { ok: false; reason: 'missing' }
