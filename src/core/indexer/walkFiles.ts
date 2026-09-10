import fs from 'node:fs'
import path from 'node:path'
import type { IgnoreRules } from './ignore'

export interface WalkResult {
  files: string[] // absolute paths
  scannedFileCount: number
}

export interface WalkedFile {
  absolutePath: string
  relativePath: string
  mtimeMs: number
  size: number
}

/**
 * Recursively lists files under `rootDir` whose extension is in
 * `extensions`, respecting `ignoreRules`. Depth-first, synchronous — fine
 * for the project sizes this targets (spec's perf budget is a later
 * hardening-phase concern, not a Phase 2 one).
 */
export function walkFiles(rootDir: string, extensions: string[], ignoreRules: IgnoreRules): WalkResult {
  const files: string[] = []
  let scannedFileCount = 0
  const extSet = new Set(extensions)

  function visit(dir: string) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoreRules.shouldSkipDir(entry.name)) continue
        visit(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        if (ignoreRules.shouldSkipFile(entry.name)) continue
        scannedFileCount++
        const ext = path.extname(entry.name)
        if (extSet.has(ext)) {
          files.push(path.join(dir, entry.name))
        }
      }
    }
  }

  visit(rootDir)
  return { files, scannedFileCount }
}

/** Metadata-only walk used to validate a persistent index. It never reads
 * source contents, which keeps reopening proportional to directory/stat IO
 * rather than parser cost. */
export function walkFileMetadata(rootDir: string, extensions: string[], ignoreRules: IgnoreRules): { files: WalkedFile[]; scannedFileCount: number } {
  const files: WalkedFile[] = []
  let scannedFileCount = 0
  const extSet = new Set(extensions)
  function visit(dir: string) {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!ignoreRules.shouldSkipDir(entry.name)) visit(absolutePath)
        continue
      }
      if (!entry.isFile() || ignoreRules.shouldSkipFile(entry.name)) continue
      scannedFileCount++
      if (!extSet.has(path.extname(entry.name)) && !['package.json', 'composer.json', 'pnpm-workspace.yaml', 'frameui.config.json'].includes(entry.name)) continue
      try {
        const stat = fs.statSync(absolutePath)
        files.push({ absolutePath, relativePath: path.relative(rootDir, absolutePath).split(path.sep).join('/'), mtimeMs: stat.mtimeMs, size: stat.size })
      } catch { /* file disappeared during the walk */ }
    }
  }
  visit(rootDir)
  return { files, scannedFileCount }
}
