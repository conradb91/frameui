import type { RoutePattern } from '@shared/types/model/projectModel'

/**
 * Phase 4 slice 1 — matches a real captured URL against the `RoutePattern`s
 * already discovered by the static adapters (spec §4). Deliberately does
 * NOT "learn" new patterns by generalizing across multiple captures (a
 * separate, later algorithm) — this only recognizes URLs against route
 * shapes the source already told us about.
 *
 * Browser-safe: no Node APIs, runs in the renderer (same convention as
 * `tree.ts` in this directory).
 */

export interface RouteMatch {
  route: RoutePattern
  params: Record<string, string>
}

const COLON_PARAM = /^:(\w+)$/
const BRACE_PARAM = /^\{(\w+)\}$/

export function extractPathname(url: string): string {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url.split('#')[0].split('?')[0]
  }
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
  return pathname
}

export function segmentsOf(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export function matchRoutePattern(url: string, routes: RoutePattern[]): RouteMatch | null {
  const pathname = extractPathname(url)
  const urlSegments = segmentsOf(pathname)

  // Prefer exact/static routes over parameter routes regardless of declaration order.
  const ranked = [...routes].sort((a, b) => {
    const score = (value: string) => segmentsOf(value).reduce((sum, part) => sum + (/^[:{[*]/.test(part) ? 0 : 10), 0)
    return score(b.path) - score(a.path)
  })
  for (const route of ranked) {
    const patternSegments = segmentsOf(route.path)
    const params: Record<string, string> = {}
    let cursor = 0
    let matched = true
    for (const part of patternSegments) {
      const catchAll = /^\[\[\.\.\.(\w+)\]\]$/.exec(part) || /^\[\.\.\.(\w+)\]$/.exec(part) || /^\*(\w*)$/.exec(part)
      if (catchAll) {
        if (cursor >= urlSegments.length && !part.startsWith('[[')) { matched = false; break }
        params[catchAll[1] || 'path'] = urlSegments.slice(cursor).join('/')
        cursor = urlSegments.length
        continue
      }
      const paramName = part.match(COLON_PARAM)?.[1] ?? part.match(BRACE_PARAM)?.[1] ?? /^\[(\w+)\]$/.exec(part)?.[1]
      const value = urlSegments[cursor++]
      if (value === undefined || (!paramName && part !== value)) { matched = false; break }
      if (paramName) params[paramName] = value
    }
    if (matched && cursor === urlSegments.length) return { route, params }
  }
  return null
}
