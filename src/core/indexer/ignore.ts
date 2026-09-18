import path from 'node:path'
import fs from 'node:fs'
import ignore from 'ignore'
import { isAdapterSourceFile } from '@core/adapters/structureReaders'

/**
 * Directory names never descended into, and file patterns never indexed or
 * exposed anywhere in the UI — spec §6.3 (also the security requirement in
 * §23 that .env/secret files are never indexed or exposed).
 */
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  'bin',
  'obj',
  'vendor',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.vite',
  '.cache',
  'coverage',
  'archives',
  'archive',
  'backups',
  'backup',
  'logs',
  'log',
  'cache',
  'caches',
  'writable',
  '__pycache__',
  'venv',
  'site-packages',
  'target',
  'bower_components',
  'coverage-report',
  'test-results',
  'playwright-report',
  'tmp',
  'temp',
  '.frameui-cache',
  '.vercel',
  '.netlify',
])

const IGNORED_FILE_PATTERNS = [/^\.env(\..+)?$/, /^\.DS_Store$/, /(?:~|\.swp|\.swo|\.tmp|\.temp|\.log(?:\.\d+)?|\.cache|\.map|\.pyc|\.bak|\.sqlite(?:3)?|\.db)$/i]

export interface IgnoreRules {
  shouldSkipPath?(fullPath: string, directory?: boolean): boolean
  shouldSkipDir(dirName: string): boolean
  shouldSkipFile(fileName: string): boolean
}

// Hidden directories (starting with '.') are skipped by default except a
// small allowlist that legitimately holds source (.storybook is common
// enough to matter for component discovery; add more here if needed).
const ALLOWED_HIDDEN_DIRS = new Set(['.storybook'])

export function createIgnoreRules(userConfiguredIgnores: string[] = [], rootPath?: string): IgnoreRules {
  const userDirs = new Set(rootPath ? [] : userConfiguredIgnores.map((p) => path.basename(p)))
  const cache = new Map<string, ReturnType<typeof ignore>>()
  const matcher = (dir: string) => {
    if (!cache.has(dir)) {
      const rules = ignore()
      try { rules.add(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')) } catch { /* optional */ }
      if (dir === rootPath) rules.add(userConfiguredIgnores)
      cache.set(dir, rules)
    }
    return cache.get(dir)!
  }
  return {
    shouldSkipPath(fullPath, directory = false) {
      if (!rootPath) return false
      const relative = path.relative(rootPath, fullPath)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
      const parts = relative.split(path.sep)
      // Git cannot re-include a child of an excluded directory.
      for (let depth = 1; depth <= parts.length; depth++) {
        const isDir = depth < parts.length || directory
        let ignored = false
        for (let scope = 0; scope < depth; scope++) {
          const dir = path.join(rootPath, ...parts.slice(0, scope))
          const result = matcher(dir).test(parts.slice(scope, depth).join('/') + (isDir ? '/' : ''))
          if (result.ignored) ignored = true
          if (result.unignored) ignored = false
        }
        if (ignored) return true
      }
      return false
    },
    shouldSkipDir(dirName) {
      if (IGNORED_DIR_NAMES.has(dirName.toLowerCase()) || userDirs.has(dirName)) return true
      if (dirName.startsWith('.') && !ALLOWED_HIDDEN_DIRS.has(dirName)) return true
      return false
    },
    shouldSkipFile(fileName) {
      return IGNORED_FILE_PATTERNS.some((re) => re.test(fileName))
    },
  }
}

/**
 * Path-level check (any path containing an ignored segment anywhere between
 * `rootPath` and the file) — for consumers like chokidar that hand us full
 * paths rather than walking directory-by-directory themselves. Only checks
 * segments below `rootPath` so a project living under a dotfile-named
 * ancestor directory isn't wrongly ignored in its entirety.
 */
export function pathContainsIgnoredSegment(rootPath: string, fullPath: string): boolean {
  const relative = path.relative(rootPath, fullPath)
  const segments = relative.split(path.sep).filter(Boolean)
  return segments.some((seg) => IGNORED_DIR_NAMES.has(seg.toLowerCase()) || (seg.startsWith('.') && !ALLOWED_HIDDEN_DIRS.has(seg)))
}

const RELEVANT_FILE = /(?:\.(?:tsx?|jsx?|vue|svelte|astro|php|cshtml|razor|csproj|cs|html?|css|scss|sass|less|styl|json|ya?ml|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf)|(?:^|\/)(?:routes?|router|tailwind|vite|next|astro|svelte|webpack|turbo|nx)\.[^/]+)$/i

export function isRelevantProjectPath(rootPath: string, fullPath: string): boolean {
  if (pathContainsIgnoredSegment(rootPath, fullPath)) return false
  const relative = path.relative(rootPath, fullPath).split(path.sep).join('/')
  if (!relative) return true
  const name = path.basename(relative)
  if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(name))) return false
  return RELEVANT_FILE.test(relative) || isAdapterSourceFile(relative)
}
