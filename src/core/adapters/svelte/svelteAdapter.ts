import path from 'node:path'
import { hasDependency } from '../shared/packageJson'
import { resolveGenericBundler } from '../shared/genericBundler'
import { findMarkupPages } from '../markup/findMarkupPages'
import { findMarkupComponents } from '../markup/findMarkupComponents'
import type { SourceAdapter } from '../types'

/** Svelte / SvelteKit — page/component discovery is still the generic
 * markup scanner today; a real `.svelte` parser is Phase 2 follow-up work. */
export const svelteAdapter: SourceAdapter = {
  id: 'svelte',

  detect(ctx) {
    if (!ctx.pkg || !(hasDependency(ctx.pkg, 'svelte') || hasDependency(ctx.pkg, '@sveltejs/kit'))) return null
    // A `svelte` dependency alone isn't proof this project *is* a Svelte
    // app — a tool can depend on `svelte`/`svelte/compiler` purely to parse
    // *other* projects' `.svelte` files (this repo is exactly that case).
    // Requiring at least one real `.svelte` file rules that out.
    if (!ctx.candidateFiles.some((file) => file.endsWith('.svelte'))) return null
    const generic = resolveGenericBundler(ctx.rootPath, ctx.pkg, false)
    return { framework: 'svelte', phpFramework: null, bundler: generic.bundler, routerStyle: 'filesystem', routesDir: null, devCommand: generic.devCommand }
  },

  findPages(ctx) {
    return findMarkupPages(ctx.rootPath, 'svelte', ctx.ignoreRules)
  },

  findComponents(ctx, _match, pages) {
    const pageAbsolutePaths = new Set(pages.map((page) => path.join(ctx.rootPath, page.filePath)))
    return findMarkupComponents(ctx.rootPath, ctx.candidateFiles, pageAbsolutePaths)
  },
}
