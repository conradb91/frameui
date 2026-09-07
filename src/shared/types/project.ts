export interface RecentProject {
  id: string
  name: string
  path: string
  lastOpenedAt: string // ISO timestamp
  missing?: boolean
}

export type OpenProjectResult = { cancelled: true } | { cancelled: false; project: RecentProject }

export type OpenRecentResult = { ok: true; project: RecentProject } | { ok: false; reason: 'missing' }
