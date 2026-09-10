import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ProjectIndex } from '@shared/types/projectIndex'
import type { ProjectLibraryEntry, ProjectRecentEntry, RecentProject } from '@shared/types/project'
import { getProjectIndexFile, getProjectLibraryFile, getProjectRecentHistoryFile, getRecentProjectsFile, getWorkspaceRoot } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'
import { PROJECT_INDEX_CACHE_SCHEMA } from '@core/indexer/projectIndexService'

const MAX_RECENT = 50

function normalizePath(folderPath: string): string {
  try { return fs.realpathSync(folderPath) } catch { return path.resolve(folderPath) }
}

function migrateLegacy(userDataPath: string): RecentProject[] {
  const legacy = readJsonFile<RecentProject[]>(getRecentProjectsFile(userDataPath), [])
  if (!legacy.length) return []
  const projects = legacy.map((project) => ({ ...project, path: normalizePath(project.path), addedAt: project.addedAt ?? project.lastOpenedAt }))
  writeJsonFileAtomic(getProjectLibraryFile(userDataPath), projects)
  writeJsonFileAtomic<ProjectRecentEntry[]>(getProjectRecentHistoryFile(userDataPath), projects.map((project) => ({ projectId: project.id, openedAt: project.lastOpenedAt })))
  return projects
}

function readProjects(userDataPath: string): RecentProject[] {
  const libraryFile = getProjectLibraryFile(userDataPath)
  if (fs.existsSync(libraryFile)) return readJsonFile<RecentProject[]>(libraryFile, [])
  return migrateLegacy(userDataPath)
}

function readHistory(userDataPath: string): ProjectRecentEntry[] {
  const historyFile = getProjectRecentHistoryFile(userDataPath)
  if (fs.existsSync(historyFile)) return readJsonFile<ProjectRecentEntry[]>(historyFile, [])
  const projects = readProjects(userDataPath)
  const history = projects.map((project) => ({ projectId: project.id, openedAt: project.lastOpenedAt }))
  writeJsonFileAtomic(historyFile, history)
  return history
}

function withMissing(project: RecentProject): RecentProject {
  let missing = true
  try { missing = !fs.statSync(project.path).isDirectory() } catch { /* missing/inaccessible */ }
  return { ...project, missing }
}

function readBranch(rootPath: string): string | null {
  try {
    const head = fs.readFileSync(path.join(rootPath, '.git', 'HEAD'), 'utf-8').trim()
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : head.slice(0, 8)
  } catch { return null }
}

export function listAllProjects(userDataPath: string): ProjectLibraryEntry[] {
  const recentIds = new Set(readHistory(userDataPath).map((item) => item.projectId))
  return readProjects(userDataPath).map(withMissing).map((project) => {
    const index = readJsonFile<ProjectIndex | null>(getProjectIndexFile(userDataPath, project.id), null, PROJECT_INDEX_CACHE_SCHEMA)
    return {
      ...project,
      framework: index?.framework ?? null,
      language: index?.language ?? null,
      pageCount: index?.projectModel.pages.length ?? null,
      componentCount: index?.projectModel.components.length ?? null,
      repositoryStatus: project.missing ? 'missing' : index ? 'ready' : 'not-indexed',
      branch: project.missing ? null : readBranch(project.path),
      indexedAt: index?.scannedAt ?? null,
      recent: recentIds.has(project.id),
    }
  })
}

export function listRecentProjects(userDataPath: string): ProjectLibraryEntry[] {
  const projects = new Map(listAllProjects(userDataPath).map((project) => [project.id, project]))
  return readHistory(userDataPath)
    .map((recent) => ({ recent, project: projects.get(recent.projectId) }))
    .filter((item): item is { recent: ProjectRecentEntry; project: ProjectLibraryEntry } => !!item.project)
    .sort((a, b) => new Date(b.recent.openedAt).getTime() - new Date(a.recent.openedAt).getTime())
    .map(({ recent, project }) => ({ ...project, lastOpenedAt: recent.openedAt, recent: true }))
}

export function recordProjectOpened(userDataPath: string, folderPath: string, name: string, relinkId?: string): RecentProject {
  const canonicalPath = normalizePath(folderPath)
  const existing = readProjects(userDataPath)
  const matchByPath = existing.find((project) => normalizePath(project.path) === canonicalPath)
  const matchById = relinkId ? existing.find((project) => project.id === relinkId) : undefined
  const matched = matchById ?? matchByPath
  const id = matched?.id ?? crypto.randomUUID()
  const now = new Date().toISOString()
  const record: RecentProject = { id, name, path: canonicalPath, addedAt: matched?.addedAt ?? now, lastOpenedAt: now }

  const updatedProjects = [record, ...existing.filter((project) => project.id !== id && project.id !== matchByPath?.id)]
  writeJsonFileAtomic(getProjectLibraryFile(userDataPath), updatedProjects)
  const removedIds = new Set([id, ...(matchByPath && matchByPath.id !== id ? [matchByPath.id] : [])])
  const history = [{ projectId: id, openedAt: now }, ...readHistory(userDataPath).filter((item) => !removedIds.has(item.projectId))].slice(0, MAX_RECENT)
  writeJsonFileAtomic(getProjectRecentHistoryFile(userDataPath), history)
  return record
}

export function removeProjectFromRecent(userDataPath: string, projectId: string): void {
  writeJsonFileAtomic(getProjectRecentHistoryFile(userDataPath), readHistory(userDataPath).filter((item) => item.projectId !== projectId))
}

export function clearRecentProjects(userDataPath: string): void {
  writeJsonFileAtomic<ProjectRecentEntry[]>(getProjectRecentHistoryFile(userDataPath), [])
}

function removeMetadata(userDataPath: string, projectId: string): void {
  const workspace = getWorkspaceRoot(userDataPath)
  const fileCollections = ['project-indexes', 'flows', 'drafts', 'features', 'concept-components', 'captures', 'feature-pages', 'design-states', 'design-trees', 'alternatives', 'journeys', 'share-previews', 'feature-work-packages', 'design-system']
  for (const directory of fileCollections) {
    try { fs.rmSync(path.join(workspace, directory, `${projectId}.json`), { force: true }) } catch { /* absent metadata */ }
  }
  for (const directory of ['capture-screenshots', 'share-packages']) {
    try { fs.rmSync(path.join(workspace, directory, projectId), { recursive: true, force: true }) } catch { /* absent metadata */ }
  }
}

export function removeProjectFromFrameUi(userDataPath: string, projectId: string): void {
  writeJsonFileAtomic(getProjectLibraryFile(userDataPath), readProjects(userDataPath).filter((project) => project.id !== projectId))
  removeProjectFromRecent(userDataPath, projectId)
  removeMetadata(userDataPath, projectId)
}

export function getRegisteredProject(userDataPath: string, projectId: string): RecentProject | null {
  return readProjects(userDataPath).find((project) => project.id === projectId) ?? null
}

export function deleteProjectFromDisk(userDataPath: string, projectId: string, confirmationName: string): void {
  const project = getRegisteredProject(userDataPath, projectId)
  if (!project || confirmationName !== project.name) throw new Error('Project name confirmation does not match.')
  const target = path.resolve(project.path)
  const filesystemRoot = path.parse(target).root
  if (target === filesystemRoot || target === path.resolve(os.homedir()) || target.split(path.sep).filter(Boolean).length < 3) throw new Error('Refusing to delete an unsafe project path.')
  if (!fs.statSync(target).isDirectory()) throw new Error('Project path is not a directory.')
  fs.rmSync(target, { recursive: true, force: false })
  removeProjectFromFrameUi(userDataPath, projectId)
}
