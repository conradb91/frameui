import path from 'node:path'

/**
 * Directory names never descended into, and file patterns never indexed or
 * exposed anywhere in the UI — spec §6.3 (also the security requirement in
 * §23 that .env/secret files are never indexed or exposed).
 */
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
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
  'logs',
  'tmp',
  'temp',
  '.frameui-cache',
  '.vercel',
  '.netlify',
])

const IGNORED_FILE_PATTERNS = [/^\.env(\..+)?$/, /^\.DS_Store$/, /(?:~|\.swp|\.swo|\.tmp|\.temp|\.log)$/i]

export interface IgnoreRules {
  shouldSkipDir(dirName: string): boolean
  shouldSkipFile(fileName: string): boolean
}

// Hidden directories (starting with '.') are skipped by default except a
// small allowlist that legitimately holds source (.storybook is common
// enough to matter for component discovery; add more here if needed).
const ALLOWED_HIDDEN_DIRS = new Set(['.storybook'])

export function createIgnoreRules(userConfiguredIgnores: string[] = []): IgnoreRules {
  const userDirs = new Set(userConfiguredIgnores.map((p) => path.basename(p)))
  return {
    shouldSkipDir(dirName) {
      if (IGNORED_DIR_NAMES.has(dirName) || userDirs.has(dirName)) return true
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
  return segments.some((seg) => IGNORED_DIR_NAMES.has(seg) || (seg.startsWith('.') && !ALLOWED_HIDDEN_DIRS.has(seg)))
}

const RELEVANT_FILE = /(?:\.(?:tsx?|jsx?|vue|svelte|astro|php|html?|css|scss|sass|less|styl|json|ya?ml|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf)|(?:^|\/)(?:routes?|router|tailwind|vite|next|astro|svelte|webpack|turbo|nx)\.[^/]+)$/i

export function isRelevantProjectPath(rootPath: string, fullPath: string): boolean {
  if (pathContainsIgnoredSegment(rootPath, fullPath)) return false
  const relative = path.relative(rootPath, fullPath).split(path.sep).join('/')
  if (!relative) return true
  const name = path.basename(relative)
  if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(name))) return false
  return RELEVANT_FILE.test(relative)
}
