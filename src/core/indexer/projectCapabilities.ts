import fs from 'node:fs'
import path from 'node:path'
import type { Bundler, Framework, ProjectApplication, ProjectCapabilities, ProjectCapabilityLevel, ProjectIndex } from '@shared/types/projectIndex'
import { createIgnoreRules } from './ignore'
import { walkFiles } from './walkFiles'
import { readPackageJson } from '@core/adapters/shared/packageJson'
import { readComposerJson } from '@core/adapters/shared/composerJson'
import { detectProject } from '@core/adapters/registry'

export function capabilitiesFor(index: Pick<ProjectIndex, 'framework' | 'routerStyle' | 'devCommand'>): { level: ProjectCapabilityLevel; capabilities: ProjectCapabilities } {
  const source = index.framework !== 'unknown'
  const runtime = index.devCommand !== null
  const routes = index.routerStyle === 'unknown' ? 'unavailable' : 'available'
  const mapping = source ? (index.framework === 'node' || index.framework === 'php' ? 'partial' : 'available') : 'unavailable'
  const capabilities: ProjectCapabilities = {
    sourceStructure: source,
    runtimePreview: runtime,
    componentSourceMapping: mapping,
    routeMapping: routes,
    layoutInspection: source || runtime,
    sourcePreview: source,
    isolatedComponentPreviews: source && !['node', 'php', 'static'].includes(index.framework),
  }
  const level: ProjectCapabilityLevel = source && runtime && mapping === 'available'
    ? 'full'
    : source && runtime
      ? 'partial'
      : runtime
        ? 'runtime-only'
        : source
          ? 'source-only'
          : 'limited'
  return { level, capabilities }
}

function title(value: string): string {
  return value.replace(/^@[^/]+\//, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function packageDirectories(rootPath: string): string[] {
  const found = new Set<string>()
  const ignore = createIgnoreRules()
  function visit(dir: string, depth: number) {
    if (depth > 4) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some((entry) => entry.isFile() && entry.name === 'package.json')) found.add(dir)
    for (const entry of entries) {
      if (!entry.isDirectory() || ignore.shouldSkipDir(entry.name)) continue
      visit(path.join(dir, entry.name), depth + 1)
    }
  }
  visit(rootPath, 0)
  return [...found]
}

/** Detects applications independently of a particular workspace tool. A
 * package becomes a target only when it contains UI source, a runnable
 * script, or recognizable UI dependencies; service-only packages stay out. */
const DISCOVERY_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.scss', '.vue', '.svelte', '.astro', '.php', '.html']

export function discoverApplications(rootPath: string, repositoryFiles?: string[]): ProjectApplication[] {
  const result: ProjectApplication[] = []
  for (const dir of packageDirectories(rootPath)) {
    const pkg = readPackageJson(dir)
    const isWorkspaceContainer = dir === rootPath && !!pkg?.raw.workspaces && !['src', 'pages', 'app', 'views'].some((candidate) => fs.existsSync(path.join(dir, candidate)))
    if (isWorkspaceContainer) continue
    const composer = readComposerJson(dir)
    const ignoreRules = createIgnoreRules()
    const files = repositoryFiles
      ? repositoryFiles.filter((file) => file === dir || file.startsWith(`${dir}${path.sep}`))
      : walkFiles(dir, DISCOVERY_EXTENSIONS, ignoreRules).files
    const ctx = { rootPath: dir, pkg, composer, candidateFiles: files, ignoreRules }
    const { adapter, match } = detectProject(ctx)
    const pages = adapter.findPages(ctx, match)
    const components = adapter.findComponents(ctx, match, pages)
    const rawName = typeof pkg?.raw.name === 'string' ? pkg.raw.name : path.basename(dir)
    const uiPackage = components.length > 0 && pages.length === 0
    const tokenPackage = /tokens?|theme/i.test(rawName) && files.some((file) => /\.s?css$/.test(file))
    if (match.framework === 'unknown' && !match.devCommand && !uiPackage && !tokenPackage) continue
    const capability = capabilitiesFor(match)
    const relative = path.relative(rootPath, dir).split(path.sep).join('/') || '.'
    result.push({
      id: `app:${relative.toLowerCase().replace(/[^a-z0-9]+/g, '.')}`,
      name: title(rawName),
      rootPath: relative,
      kind: tokenPackage ? 'token-package' : uiPackage ? 'ui-package' : 'application',
      framework: match.framework,
      bundler: match.bundler,
      devCommand: match.devCommand ? { ...match.devCommand, workingDirectory: relative } : null,
      url: null,
      sourceRoots: ['src'].filter((candidate) => fs.existsSync(path.join(dir, candidate))),
      sharedPackageIds: [],
      capabilities: capability.capabilities,
    })
  }
  if (result.length === 0) return []
  const shared = result.filter((item) => item.kind !== 'application').map((item) => item.id)
  return result.map((item) => item.kind === 'application' ? { ...item, sharedPackageIds: shared } : item)
}

export function isStyleFile(filePath: string): boolean {
  return /\.(?:css|scss|sass|less|styl)$/.test(filePath)
}

export function isBuildOrRouteConfiguration(filePath: string): boolean {
  const name = path.basename(filePath)
  return /^(?:package|composer)\.json$/.test(name)
    || /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(name)
    || /(?:vite|next|astro|svelte|tailwind|webpack|turbo|nx|tsconfig|routes?|router|frameui)\.(?:config\.)?(?:js|cjs|mjs|ts|json|php|ya?ml)$/i.test(name)
}

export function frameworkFromExtension(filePath: string): Framework | null {
  if (/\.vue$/.test(filePath)) return 'vue'
  if (/\.svelte$/.test(filePath)) return 'svelte'
  if (/\.astro$/.test(filePath)) return 'astro'
  if (/\.php$/.test(filePath)) return 'php'
  if (/\.html?$/.test(filePath)) return 'static'
  return null
}

export function bundlerLabel(value: Bundler): string { return value === 'unknown' ? 'Custom' : value }
