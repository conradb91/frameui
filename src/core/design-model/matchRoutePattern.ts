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

  for (const route of routes) {
    const patternSegments = segmentsOf(route.path)
    if (patternSegments.length !== urlSegments.length) continue

    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < patternSegments.length; i++) {
      const patternSegment = patternSegments[i]
      const urlSegment = urlSegments[i]
      const colonMatch = patternSegment.match(COLON_PARAM)
      const braceMatch = patternSegment.match(BRACE_PARAM)
      const paramName = colonMatch?.[1] ?? braceMatch?.[1]
      if (paramName) {
        params[paramName] = urlSegment
      } else if (patternSegment !== urlSegment) {
        matched = false
        break
      }
    }

    if (matched) return { route, params }
  }

  return null
}
