import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DetectedPage, RouterStyle } from '@shared/types/projectIndex'
import type { IgnoreRules } from '@core/indexer/ignore'
import { nameFromSegments, routeFromSegments, prettifySegment } from './routeNaming'

const PAGE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js'])
const NEXT_PAGES_EXCLUDED = new Set(['_app', '_document', '_error', '_middleware', 'middleware'])

function toRootRelative(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).split(path.sep).join('/')
}

function walkNextAppRouter(routesDir: string, rootPath: string, ignoreRules: IgnoreRules): DetectedPage[] {
  const pages: DetectedPage[] = []

  function visit(dir: string, segments: string[]) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoreRules.shouldSkipDir(entry.name)) continue
        visit(path.join(dir, entry.name), [...segments, entry.name])
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name)
        const base = entry.name.slice(0, -ext.length)
        if (base === 'page' && PAGE_EXTENSIONS.has(ext)) {
          const filePath = path.join(dir, entry.name)
          const routeSegments = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')))
          pages.push({
            id: crypto.randomUUID(),
            name: nameFromSegments(segments),
            filePath: toRootRelative(rootPath, filePath),
            route: routeFromSegments(routeSegments),
          })
        }
      }
    }
  }

  visit(routesDir, [])
  return pages
}

function walkNextPagesRouter(routesDir: string, rootPath: string, ignoreRules: IgnoreRules): DetectedPage[] {
  const pages: DetectedPage[] = []

  function visit(dir: string, segments: string[]) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoreRules.shouldSkipDir(entry.name) || entry.name === 'api') continue
        visit(path.join(dir, entry.name), [...segments, entry.name])
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name)
        const base = entry.name.slice(0, -ext.length)
        if (!PAGE_EXTENSIONS.has(ext) || NEXT_PAGES_EXCLUDED.has(base)) continue
        const fileSegments = base === 'index' ? segments : [...segments, base]
        const filePath = path.join(dir, entry.name)
        pages.push({
          id: crypto.randomUUID(),
          name: nameFromSegments(fileSegments),
          filePath: toRootRelative(rootPath, filePath),
          route: routeFromSegments(fileSegments),
        })
      }
    }
  }

  visit(routesDir, [])
  return pages
}

/** Conventional (non-Next) layout — a flat `pages/` (or `src/pages/`) dir,
 * one file per page, common in Vite + React Router setups. Best-effort: no
 * route is derivable without reading the app's router config, so `route`
 * stays null and `name` comes from the filename alone. */
function walkConventionalPagesDir(pagesDir: string, rootPath: string, ignoreRules: IgnoreRules): DetectedPage[] {
  const pages: DetectedPage[] = []

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
        const ext = path.extname(entry.name)
        const base = entry.name.slice(0, -ext.length)
        if (!PAGE_EXTENSIONS.has(ext) || /\.(test|spec|stories)$/.test(base)) continue
        const filePath = path.join(dir, entry.name)
        pages.push({
          id: crypto.randomUUID(),
          name: prettifySegment(base),
          filePath: toRootRelative(rootPath, filePath),
          route: null,
        })
      }
    }
  }

  visit(pagesDir)
  return pages
}

export function findPages(
  rootPath: string,
  routerStyle: RouterStyle,
  routesDir: string | null,
  ignoreRules: IgnoreRules,
): DetectedPage[] {
  if (!routesDir) return []
  if (routerStyle === 'next-app') return walkNextAppRouter(routesDir, rootPath, ignoreRules)
  if (routerStyle === 'next-pages') return walkNextPagesRouter(routesDir, rootPath, ignoreRules)
  return walkConventionalPagesDir(routesDir, rootPath, ignoreRules)
}
