import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DetectedPage, Framework } from '@shared/types/projectIndex'
import type { IgnoreRules } from '@core/indexer/ignore'

export const MARKUP_EXTENSIONS = ['.html', '.htm', '.php', '.phtml', '.twig', '.ejs', '.hbs', '.handlebars', '.mustache', '.njk', '.nunjucks', '.pug', '.jade', '.vue', '.svelte', '.astro', '.erb', '.liquid', '.eta', '.tpl', '.latte']
const EXTENSIONS = new Set(MARKUP_EXTENSIONS)
const NON_PAGE_DIRS = new Set(['components', 'component', 'partials', 'partial', 'includes', 'include', 'layouts', 'layout', 'fragments', 'fragment', 'vendor'])
const NON_PAGE_NAMES = /^(?:_.*|\+layout|\+error|layout|base|document|error|404|500)$/i
const MAX_PAGES = 2000

function withoutTemplateExtension(fileName: string): string {
  return fileName
    .replace(/\.blade\.php$/i, '')
    .replace(/\.(?:html?|php|phtml|twig|ejs|hbs|handlebars|mustache|njk|nunjucks|pug|jade|vue|svelte|astro|erb|liquid|eta|tpl|latte)$/i, '')
    .replace(/^\+page$/, 'index')
}

function titleCase(value: string): string {
  return value
    .replace(/^_+/, '')
    .replace(/\[\.\.\.([^\]]+)\]/g, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function routeFor(relativeWithinRoot: string): string {
  const parts = relativeWithinRoot.split('/')
  const base = withoutTemplateExtension(parts.pop() ?? '')
  if (base.toLowerCase() !== 'index') parts.push(base)
  const route = parts
    .filter(Boolean)
    .map((segment) => segment.replace(/^\[\.\.\.([^\]]+)\]$/, '*$1').replace(/^\[([^\]]+)\]$/, ':$1'))
    .join('/')
  return `/${route}`.replace(/\/$/, '') || '/'
}

function rootsFor(rootPath: string, framework: Framework): string[] {
  const candidates: string[] = []
  if (framework === 'php') candidates.push('resources/views', 'app/Views', 'application/views', 'views', 'templates', 'public', '.')
  if (framework === 'astro') candidates.push('src/pages')
  if (framework === 'svelte') candidates.push('src/routes', 'src/pages', 'routes', 'pages')
  if (framework === 'vue') candidates.push('src/pages', 'pages', 'src/views', 'views')
  if (framework === 'node') candidates.push('views', 'src/views', 'pages', 'src/pages', 'templates')
  if (framework === 'static') candidates.push('pages', 'public', '.')
  const existing = [...new Set(candidates.map((candidate) => path.resolve(rootPath, candidate)))].filter(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory(),
  )
  // A small PHP site or an Express app may keep index.php/index.ejs at the
  // project root instead of a views directory.
  if (existing.length > 0) return existing
  if (framework === 'vue' || framework === 'svelte') {
    const sourceRoot = path.resolve(rootPath, 'src')
    return fs.existsSync(sourceRoot) ? [sourceRoot] : [path.resolve(rootPath)]
  }
  return framework === 'php' || framework === 'node' ? [path.resolve(rootPath)] : existing
}

export function findMarkupPages(rootPath: string, framework: Framework, ignoreRules: IgnoreRules): DetectedPage[] {
  const pages: DetectedPage[] = []
  const seen = new Set<string>()

  function visit(dir: string, pagesRoot: string) {
    if (pages.length >= MAX_PAGES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (pages.length >= MAX_PAGES) break
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (ignoreRules.shouldSkipDir(entry.name) || NON_PAGE_DIRS.has(entry.name.toLowerCase()) || (framework === 'php' && /^(controllers?|models?|config|database|migrations?|tests?|system|libraries|helpers|commands|filters)$/i.test(entry.name))) continue
        visit(fullPath, pagesRoot)
        continue
      }
      if (!entry.isFile() || ignoreRules.shouldSkipFile(entry.name)) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!EXTENSIONS.has(ext)) continue
      if (framework === 'php' && /\.(php|phtml)$/i.test(entry.name)) {
        try { if (!/<(?:html|body|div|main|section|h[1-6]|p|form|table|ul|a|button|header|article|nav|span)\b/i.test(fs.readFileSync(fullPath, 'utf8'))) continue } catch { continue }
      }
      const base = withoutTemplateExtension(entry.name)
      if (NON_PAGE_NAMES.test(base) || (framework === 'php' && base.toLowerCase() === 'app')) continue
      const filePath = path.relative(rootPath, fullPath).split(path.sep).join('/')
      if (seen.has(filePath)) continue
      seen.add(filePath)
      const relativeWithinRoot = path.relative(pagesRoot, fullPath).split(path.sep).join('/')
      const route = routeFor(relativeWithinRoot)
      const parentName = path.basename(path.dirname(relativeWithinRoot))
      pages.push({
        id: crypto.randomUUID(),
        name: titleCase(base.toLowerCase() === 'index' && parentName !== '.' ? parentName : base) || 'Home',
        filePath,
        route,
      })
    }
  }

  for (const pagesRoot of rootsFor(rootPath, framework)) visit(pagesRoot, pagesRoot)
  return pages
}
