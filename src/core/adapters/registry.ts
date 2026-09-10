import path from 'node:path'
import { astroAdapter } from './astro/astroAdapter'
import { svelteAdapter } from './svelte/svelteAdapter'
import { vueAdapter } from './vue/vueAdapter'
import { reactAdapter } from './react/reactAdapter'
import { angularAdapter } from './angular/angularAdapter'
import { dotnetAdapter } from './dotnet/dotnetAdapter'
import { phpAdapter } from './php/phpAdapter'
import { nodeAdapter } from './node/nodeAdapter'
import { staticAdapter } from './static/staticAdapter'
import { unknownAdapter } from './unknownAdapter'
import type { AdapterContext, AdapterMatch, SourceAdapter } from './types'
import type { DetectedPage } from '@shared/types/projectIndex'
import { registerStructureReader, registerSourceExtensions } from './structureReaders'

const adapters: SourceAdapter[] = []

/** Register trusted application code, never execute plugins from an imported repository. */
export function registerSourceAdapter(adapter: SourceAdapter): () => void {
  if (adapters.some((item) => item.id === adapter.id)) throw new Error(`Duplicate source adapter: ${adapter.id}`)
  adapters.push(adapter)
  const removeExtensions = registerSourceExtensions(adapter.id, adapter.extensions ?? [])
  const removeReader = adapter.readStructure ? registerStructureReader(adapter.id, adapter.readStructure) : () => {}
  return () => { const index = adapters.indexOf(adapter); if (index !== -1) adapters.splice(index, 1); removeReader(); removeExtensions() }
}

for (const adapter of [astroAdapter, svelteAdapter, vueAdapter, angularAdapter, reactAdapter, dotnetAdapter, phpAdapter, nodeAdapter, staticAdapter]) registerSourceAdapter(adapter)

export function sourceAdapterExtensions(): string[] { return [...new Set(adapters.flatMap((adapter) => adapter.extensions ?? []))] }
export function sourceAdapterIds(): string[] { return adapters.map((adapter) => adapter.id) }

export function detectProjects(ctx: AdapterContext): { adapter: SourceAdapter; match: AdapterMatch }[] {
  const matches = adapters.flatMap((adapter) => {
    const match = adapter.detect(ctx)
    return match ? [{ adapter, match }] : []
  })
  return matches.length ? matches : [{ adapter: unknownAdapter, match: unknownAdapter.detect(ctx)! }]
}

/** Compatibility entry point: metadata has a primary stack; discovery composes every
 * matching importer into the same model. Specific importers own their files before
 * fallback template importers. There is no framework switch in the model or canvas. */
export function detectProject(ctx: AdapterContext): { adapter: SourceAdapter; match: AdapterMatch; matches: ReturnType<typeof detectProjects> } {
  const matches = detectProjects(ctx).sort((a, b) => Number(!!a.adapter.fallback) - Number(!!b.adapter.fallback))
  const primary = matches[0]
  const owns = (adapter: SourceAdapter, file: string) => adapter.ownsFile?.(file) ?? true
  const claimed = new Set<string>()
  const pagesByAdapter = new Map<string, DetectedPage[]>()
  const composite: SourceAdapter = {
    id: matches.map((item) => item.adapter.id).join('+'),
    assetRoots: [...new Set(matches.flatMap((item) => item.adapter.assetRoots ?? ['public']))],
    detect: () => primary.match,
    findPages(context) {
      claimed.clear()
      pagesByAdapter.clear()
      const result: DetectedPage[] = []
      const allowed = new Set(context.candidateFiles)
      for (const { adapter, match } of matches) {
        const pages = adapter.findPages(context, match).filter((page) => allowed.has(path.resolve(context.rootPath, page.filePath)) && owns(adapter, page.filePath) && !claimed.has(page.filePath) && !(adapter.fallback && matches.some((item) => !item.adapter.fallback && item.adapter.ownsFile?.(page.filePath))))
        pagesByAdapter.set(adapter.id, pages)
        result.push(...pages)
        for (const page of pages) claimed.add(page.filePath)
      }
      return result
    },
    findComponents(context, _match, pages) {
      const seen = new Set<string>()
      return matches.flatMap(({ adapter, match }) => adapter.findComponents(context, match, pagesByAdapter.get(adapter.id) ?? pages).filter((component) => {
        const key = `${component.filePath}:${component.name}`
        if (!owns(adapter, component.filePath) || seen.has(key) || (adapter.fallback && claimed.has(component.filePath))) return false
        seen.add(key)
        return true
      }))
    },
  }
  return { adapter: composite, match: primary.match, matches }
}

/** Source readers can carry route and component metadata in the same file.
 * Re-import those changes so cache updates use their adapter, not JSX heuristics. */
export function adapterNeedsReimport(adapterIds: string[], filePath: string): boolean {
  return adapters.some((adapter) => adapterIds.includes(adapter.id) && !!adapter.readStructure && (adapter.ownsFile?.(filePath) ?? true))
}
