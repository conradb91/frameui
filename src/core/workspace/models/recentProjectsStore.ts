import fs from 'node:fs'
import crypto from 'node:crypto'
import type { RecentProject } from '@shared/types/project'
import { getRecentProjectsFile } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

const MAX_RECENT = 20

function readAll(userDataPath: string): RecentProject[] {
  return readJsonFile<RecentProject[]>(getRecentProjectsFile(userDataPath), [])
}

/**
 * Missing-folder state is computed live against disk rather than trusted
 * from storage — a folder can disappear or come back between launches.
 */
export function listRecentProjects(userDataPath: string): RecentProject[] {
  return readAll(userDataPath)
    .map((p) => ({ ...p, missing: !fs.existsSync(p.path) }))
    .sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
}

/**
 * Records that `folderPath` was opened just now. Matches an existing entry
 * by path (not id) so re-opening the same folder updates it in place rather
 * than duplicating it. `relinkId` lets a specific existing entry (e.g. one
 * marked missing) take over `folderPath` instead of creating a new row.
 */
export function recordProjectOpened(
  userDataPath: string,
  folderPath: string,
  name: string,
  relinkId?: string,
): RecentProject {
  const file = getRecentProjectsFile(userDataPath)
  const existing = readAll(userDataPath)

  const matchByPath = existing.find((p) => p.path === folderPath)
  const matchById = relinkId ? existing.find((p) => p.id === relinkId) : undefined
  const id = matchByPath?.id ?? matchById?.id ?? crypto.randomUUID()

  const record: RecentProject = {
    id,
    name,
    path: folderPath,
    lastOpenedAt: new Date().toISOString(),
  }

  const withoutThis = existing.filter((p) => p.id !== id)
  const updated = [record, ...withoutThis].slice(0, MAX_RECENT)
  writeJsonFileAtomic(file, updated)
  return record
}
