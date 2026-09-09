import path from 'node:path'
import { hasDependency } from '../shared/packageJson'
import { resolveGenericBundler } from '../shared/genericBundler'
import { findMarkupPages } from '../markup/findMarkupPages'
import { findMarkupComponents } from '../markup/findMarkupComponents'
import { findComponents as findReactComponents } from '../react/findComponents'
import type { DetectedComponent } from '@shared/types/projectIndex'
import type { SourceAdapter } from '../types'

/** Astro — bundler is always reported as 'astro' (it wraps Vite
 * internally, but that's an implementation detail, not what a user
 * configured), and components come from the generic markup scanner plus,
 * when the project also depends on `react` (islands), React's real
 * ts-morph-based component finder — both contribute, not either/or. */
export const astroAdapter: SourceAdapter = {
  id: 'astro',

  detect(ctx) {
    if (!ctx.pkg || !hasDependency(ctx.pkg, 'astro')) return null
    // Same reasoning as svelteAdapter/vueAdapter — require a real `.astro`
    // file, not just the dependency, before committing to this framework.
    if (!ctx.candidateFiles.some((file) => file.endsWith('.astro'))) return null
    const generic = resolveGenericBundler(ctx.rootPath, ctx.pkg, false)
    return { framework: 'astro', phpFramework: null, bundler: 'astro', routerStyle: 'filesystem', routesDir: null, devCommand: generic.devCommand }
  },

  findPages(ctx) {
    return findMarkupPages(ctx.rootPath, 'astro', ctx.ignoreRules)
  },

  findComponents(ctx, _match, pages) {
    const pageAbsolutePaths = new Set(pages.map((page) => path.join(ctx.rootPath, page.filePath)))
    const reactComponents = hasDependency(ctx.pkg!, 'react') ? findReactComponents(ctx.rootPath, ctx.candidateFiles, pageAbsolutePaths) : []
    const markupComponents = findMarkupComponents(ctx.rootPath, ctx.candidateFiles, pageAbsolutePaths)
    const byFileAndName = new Map<string, DetectedComponent>([...reactComponents, ...markupComponents].map((component) => [`${component.filePath}:${component.name}`, component]))
    return [...byFileAndName.values()]
  },
}
