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

/** Same one-file-per-project shape, for Features (spec Phase 6) — the
 * primary unit of user-authored design work. */
export function getFeaturesFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'features')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** Same one-file-per-project shape, for Concept Components (spec Phase
 * 14) — filtered by featureId at read time rather than split per-feature,
 * consistent with this app's "one JSON file per project per entity kind"
 * data volume assumption. */
export function getConceptComponentsFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'concept-components')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** Same one-file-per-project shape, for runtime DOM captures (spec §3). */
export function getCapturesFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'captures')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** One directory per project for capture screenshots — binary PNGs don't
 * belong embedded in getCapturesFile's JSON array, which would balloon it
 * on every capture. */
export function getCaptureScreenshotsDir(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'capture-screenshots', projectId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Same one-file-per-project shape, for Feature Pages (spec Phase 16). */
export function getFeaturePagesFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'feature-pages')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** Same one-file-per-project shape, for Design State metadata (spec Phase
 * 17) — the state's own design tree lives separately, see
 * `getDesignTreesFile`. */
export function getDesignStatesFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'design-states')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** One generic tree-draft table shared by every "named variant of a page's
 * design" concept (a `DesignState`'s own tree, and each `Alternative`'s
 * independent tree) — avoids a third near-duplicate of `screenDraftStore`'s
 * shape for what is, structurally, the exact same "id -> DesignNode tree"
 * relationship. */
export function getDesignTreesFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'design-trees')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** Same one-file-per-project shape, for Alternatives (spec Phase 19). */
export function getAlternativesFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'alternatives')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** Same one-file-per-project shape, for Journeys (spec Phase 21) —
 * replaces the old project-level `Flow` as the user-facing Feature
 * experience; Flow's persistence stays in place for legacy/project-level
 * drafts created before Journeys existed. */
export function getJourneysFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'journeys')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** Same one-file-per-project shape, for Share Preview configs (spec Phase
 * 25) — the packaged bundle itself lives under `getSharePackageDir`. */
export function getSharePreviewsFile(userDataPath: string, projectId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'share-previews')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${projectId}.json`)
}

/** One directory per share preview for its packaged, review-safe bundle
 * (HTML/JSON/assets) — binary/large content doesn't belong embedded in
 * getSharePreviewsFile's JSON array. */
export function getSharePackageDir(userDataPath: string, projectId: string, sharePreviewId: string): string {
  const dir = path.join(getWorkspaceRoot(userDataPath), 'share-packages', projectId, sharePreviewId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
