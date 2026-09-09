import path from 'node:path'
import { hasDependency } from '../shared/packageJson'
import { resolveGenericBundler } from '../shared/genericBundler'
import { findMarkupPages } from '../markup/findMarkupPages'
import { findMarkupComponents } from '../markup/findMarkupComponents'
import type { SourceAdapter } from '../types'

/** Vue (or Nuxt) — page/component discovery is still the generic markup
 * scanner today; a real `.vue` SFC parser is Phase 2 follow-up work. */
export const vueAdapter: SourceAdapter = {
  id: 'vue',

  detect(ctx) {
    if (!ctx.pkg || !hasDependency(ctx.pkg, 'vue')) return null
    // Same reasoning as svelteAdapter: a `vue` dependency alone doesn't
    // prove this project *is* a Vue app (a tool could depend on it purely
    // to parse other projects' `.vue` files) — require a real `.vue` file.
    if (!ctx.candidateFiles.some((file) => file.endsWith('.vue'))) return null
    const generic = resolveGenericBundler(ctx.rootPath, ctx.pkg, false)
    return { framework: 'vue', phpFramework: null, bundler: generic.bundler, routerStyle: 'templates', routesDir: null, devCommand: generic.devCommand }
  },

  findPages(ctx) {
    return findMarkupPages(ctx.rootPath, 'vue', ctx.ignoreRules)
  },

  findComponents(ctx, _match, pages) {
    const pageAbsolutePaths = new Set(pages.map((page) => path.join(ctx.rootPath, page.filePath)))
    return findMarkupComponents(ctx.rootPath, ctx.candidateFiles, pageAbsolutePaths)
  },
}
