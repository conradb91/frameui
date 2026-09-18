import type { PageRegistryEntry, VisualPage } from '@shared/types/visualDesign'

/** Route patterns are stored internally in whichever dynamic-segment style
 * the owning adapter uses — `:id` (already normalized), `{id}` (PHP/Laravel
 * style), or `[id]`/`[...id]` (Next.js/file-router style). This is a
 * display-only normalization to `:id` — it never touches the stored
 * pattern/route string. */
export function formatRoute(pattern: string): string {
  return pattern
    .replace(/\{(\w+)\}/g, ':$1')
    .replace(/\[\.\.\.(\w+)\]/g, ':$1')
    .replace(/\[(\w+)\]/g, ':$1')
}

const dropSuffixes = /\s+(Page|Component|View|Screen)$/i

function titleCaseWords(input: string): string {
  return input
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/** Turns raw, sometimes-concatenated adapter names ("BillingAdmin") into a
 * cleaner display name ("Billing"), using the page's own area/section to
 * decide what's a redundant suffix rather than guessing at word meaning. */
export function humanizeName(name: string, area?: string): string {
  let result = titleCaseWords(name).replace(dropSuffixes, '')
  if (area) {
    const areaWords = titleCaseWords(area)
    if (result.length > areaWords.length && result.toLowerCase().endsWith(areaWords.toLowerCase())) {
      result = result.slice(0, result.length - areaWords.length).trim()
    }
  }
  return result || titleCaseWords(name)
}

export type PageStatus = 'Ready' | 'Partial' | 'Failed' | 'Needs login' | 'Not captured' | 'Updated'

export function pageStatus(entry: Pick<PageRegistryEntry, 'status' | 'authProfile'>, matches: VisualPage[]): PageStatus {
  if (entry.status === 'Failed') return 'Failed'
  if (!matches.length) return entry.authProfile && entry.authProfile !== 'standard' ? 'Needs login' : 'Not captured'
  if (matches.some((p) => p.captureStatus === 'Source changed' || p.captureStatus === 'Conflict')) return 'Updated'
  if (matches.some((p) => p.sourceDesign?.status === 'partial')) return 'Partial'
  if (matches.some((p) => p.captureStatus === 'Capture issue')) return 'Failed'
  return 'Ready'
}

/** How many discovered pages have at least one captured/rendered variant. */
export function capturedCount(registry: PageRegistryEntry[], pages: VisualPage[]): number {
  const routes = new Set(pages.map((p) => p.route).filter(Boolean))
  return registry.filter((entry) => routes.has(entry.pattern)).length
}

/** Groups items by an arbitrary "area" label, preserving first-seen order
 * both across groups and within a group. */
export function groupByArea<T>(items: T[], areaOf: (item: T) => string): { area: string; items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const area = areaOf(item) || 'Other'
    if (!groups.has(area)) groups.set(area, [])
    groups.get(area)!.push(item)
  }
  return [...groups.entries()].map(([area, items]) => ({ area, items }))
}
