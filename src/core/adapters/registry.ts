import { astroAdapter } from './astro/astroAdapter'
import { svelteAdapter } from './svelte/svelteAdapter'
import { vueAdapter } from './vue/vueAdapter'
import { reactAdapter } from './react/reactAdapter'
import { phpAdapter } from './php/phpAdapter'
import { nodeAdapter } from './node/nodeAdapter'
import { staticAdapter } from './static/staticAdapter'
import { unknownAdapter } from './unknownAdapter'
import type { AdapterContext, AdapterMatch, SourceAdapter } from './types'

/** Priority order mirrors the original detection cascade exactly: Astro
 * before Svelte/Vue/React so an Astro project using React islands still
 * matches Astro; React before PHP/Node/Static so a project with both a
 * `react` dependency and PHP views (rare, but possible during a migration)
 * still matches React first. `unknownAdapter` always matches last. */
const ADAPTERS: SourceAdapter[] = [astroAdapter, svelteAdapter, vueAdapter, reactAdapter, phpAdapter, nodeAdapter, staticAdapter, unknownAdapter]

export function detectProject(ctx: AdapterContext): { adapter: SourceAdapter; match: AdapterMatch } {
  for (const adapter of ADAPTERS) {
    const match = adapter.detect(ctx)
    if (match) return { adapter, match }
  }
  // unreachable — unknownAdapter.detect() always returns a match — but
  // keeps this function's return type non-nullable without a non-null
  // assertion at the call site.
  return { adapter: unknownAdapter, match: unknownAdapter.detect(ctx)! }
}
