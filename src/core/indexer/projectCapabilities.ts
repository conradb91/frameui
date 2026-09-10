import fs from 'node:fs'
import crypto from 'node:crypto'
import { MARKUP_EXTENSIONS } from '@core/adapters/markup/findMarkupPages'
import { detectTechnologies } from '@core/adapters/detectTechnologies'
import path from 'node:path'
import type { Bundler, Framework, ProjectApplication, ProjectCapabilities, ProjectCapabilityLevel, ProjectIndex } from '@shared/types/projectIndex'
import { createIgnoreRules } from './ignore'
import { walkFiles } from './walkFiles'
import { readPackageJson } from '@core/adapters/shared/packageJson'
import { readComposerJson } from '@core/adapters/shared/composerJson'
import { detectProject, sourceAdapterExtensions } from '@core/adapters/registry'

export function capabilitiesFor(index: Pick<ProjectIndex, 'framework' | 'routerStyle' | 'devCommand'>): { level: ProjectCapabilityLevel; capabilities: ProjectCapabilities } {
  const source = index.framework !== 'unknown'
  const runtime = index.devCommand !== null
  const routes = index.routerStyle === 'unknown' ? 'unavailable' : ['aspnet', 'angular', 'templates'].includes(index.routerStyle) ? 'partial' : 'available'
  const mapping = source ? (['node', 'php', 'dotnet', 'angular'].includes(index.framework) ? 'partial' : 'available') : 'unavailable'
  const capabilities: ProjectCapabilities = {
    sourceStructure: source,
    runtimePreview: runtime,
    componentSourceMapping: mapping,
    routeMapping: routes,
    layoutInspection: source || runtime,
    sourcePreview: source,
    isolatedComponentPreviews: source && !['node', 'php', 'static', 'dotnet', 'angular'].includes(index.framework),
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

export function discoverApplicationRoots(rootPath: string): string[] {
  const found = new Set<string>()
  const ignore = createIgnoreRules()
  function visit(dir: string, depth: number) {
    if (depth > 4) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some((entry) => entry.isFile() && (entry.name === 'package.json' || entry.name === 'composer.json' || entry.name.endsWith('.csproj')))) found.add(dir)
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
const DISCOVERY_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.scss', '.vue', '.svelte', '.astro', ...MARKUP_EXTENSIONS, ...sourceAdapterExtensions()]

export function discoverApplications(rootPath: string, repositoryFiles?: string[]): ProjectApplication[] {
  const result: ProjectApplication[] = []
  const directories = discoverApplicationRoots(rootPath)
  for (const dir of directories) {
    const pkg = readPackageJson(dir)
    const isWorkspaceContainer = dir === rootPath && !!pkg?.raw.workspaces && !['src', 'pages', 'app', 'views'].some((candidate) => fs.existsSync(path.join(dir, candidate)))
    if (isWorkspaceContainer) continue
    const composer = readComposerJson(dir)
    const ignoreRules = createIgnoreRules()
    const allFiles = repositoryFiles
      ? repositoryFiles.filter((file) => file === dir || file.startsWith(`${dir}${path.sep}`))
      : walkFiles(dir, [...DISCOVERY_EXTENSIONS, ...sourceAdapterExtensions()], ignoreRules).files
    const files = allFiles.filter((file) => !directories.some((nested) => nested !== dir && nested.startsWith(dir + path.sep) && file.startsWith(nested + path.sep)))
    const ctx = { rootPath: dir, pkg, composer, candidateFiles: files, ignoreRules }
    const { adapter, match, matches } = detectProject(ctx)
    const pages = adapter.findPages(ctx, match)
    const components = adapter.findComponents(ctx, match, pages)
    const rawName = typeof pkg?.raw.name === 'string' ? pkg.raw.name : path.basename(dir)
    const uiPackage = components.length > 0 && pages.length === 0 && !match.devCommand
    const tokenPackage = /tokens?|theme/i.test(rawName) && files.some((file) => /\.s?css$/.test(file))
    if (match.framework === 'unknown' && !match.devCommand && !uiPackage && !tokenPackage) continue
    const capability = capabilitiesFor(match)
    const relative = path.relative(rootPath, dir).split(path.sep).join('/') || '.'
    const baseId = `app:${relative.toLowerCase().replace(/[^a-z0-9]+/g, '.')}`
    const applicationId = result.some(item => item.id === baseId) ? `app:application.${crypto.createHash('sha256').update(relative).digest('hex').slice(0, 16)}` : baseId
    result.push({
      id: applicationId,
      name: title(rawName),
      rootPath: relative,
      kind: tokenPackage ? 'token-package' : uiPackage ? 'ui-package' : 'application',
      framework: match.framework,
      technologies: detectTechnologies(ctx, matches.map((item) => item.match.phpFramework ?? item.match.framework)),
      adapterIds: matches.map((item) => item.adapter.id),
      routerStyle: match.routerStyle,
      phpFramework: match.phpFramework,
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
  return /\.(?:csproj|sln|razor|cshtml|cs)$/i.test(name) || /^angular\.json$/i.test(name)
    || /^(?:package|composer)\.json$/.test(name)
    || /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(name)
    || /(?:vite|next|astro|svelte|tailwind|webpack|turbo|nx|tsconfig|routes?|router|frameui)\.(?:config\.)?(?:js|cjs|mjs|ts|json|php|ya?ml)$/i.test(name)
}

export function frameworkFromExtension(filePath: string): Framework | null {
  if (/\.(?:cshtml|razor)$/.test(filePath)) return 'dotnet'
  if (/\.vue$/.test(filePath)) return 'vue'
  if (/\.svelte$/.test(filePath)) return 'svelte'
  if (/\.astro$/.test(filePath)) return 'astro'
  if (/\.php$/.test(filePath)) return 'php'
  if (/\.html?$/.test(filePath)) return 'static'
  return null
}

export function bundlerLabel(value: Bundler): string { return value === 'unknown' ? 'Custom' : value }

export function applicationMetadata(application: ProjectApplication): Pick<ProjectIndex, 'framework' | 'phpFramework' | 'bundler' | 'routerStyle' | 'devCommand' | 'technologies' | 'adapterIds' | 'capabilities' | 'capabilityLevel' | 'language'> {
  const ids = new Set(application.technologies?.map((item) => item.id))
  const server = ids.has('php') ? 'php' : ids.has('csharp') ? 'csharp' : null
  const script = ids.has('typescript') ? 'typescript' : ids.has('javascript') ? 'javascript' : null
  const routerStyle = application.routerStyle ?? 'unknown'
  return { framework: application.framework, phpFramework: application.phpFramework ?? null, bundler: application.bundler,
    routerStyle, devCommand: application.devCommand, technologies: application.technologies, adapterIds: application.adapterIds,
    capabilities: application.capabilities, capabilityLevel: capabilitiesFor({ ...application, routerStyle }).level,
    language: server && script ? 'mixed' : server ?? script ?? (ids.has('html') ? 'html' : 'unknown') }
}

/** The default design surface is a frontend, while explicit saved selections remain authoritative. */
export function preferredApplication(applications: ProjectApplication[]): ProjectApplication | undefined {
  const rank = (application: ProjectApplication) => application.kind !== 'application' ? 10 : ['react','vue','svelte','astro','angular','next','nuxt','sveltekit'].includes(application.framework) ? 0 : ['php','dotnet'].includes(application.framework) ? 1 : application.framework === 'static' ? 2 : 3
  return [...applications].sort((a,b) => rank(a) - rank(b) || a.rootPath.length - b.rootPath.length)[0]
}
