import path from 'node:path'
import fs from 'node:fs'

/**
 * All FrameUI workspace data (recent projects, flows, screen drafts,
 * autosave) lives under Electron's userData dir — outside any opened
 * project's own folder, so opening a repo never writes hidden files into it
 * (spec DRF-02).
 */
export function getWorkspaceRoot(userDataPath: string): string {
  const root = path.join(userDataPath, 'workspace')
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function getRecentProjectsFile(userDataPath: string): string {
  return path.join(getWorkspaceRoot(userDataPath), 'recent-projects.json')
}

/** All flows for one project live in a single file, keyed by projectId —
 * simple enough for V1's data volume, atomic per project. */
export function getFlowsFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'flows')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** Same one-file-per-project shape as flows, for screen drafts. */
export function getScreenDraftsFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'drafts')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}
