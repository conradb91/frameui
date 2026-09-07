import fs from 'node:fs'
import path from 'node:path'
import type { IgnoreRules } from './ignore'

export interface WalkResult {
  files: string[] // absolute paths
  scannedFileCount: number
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
