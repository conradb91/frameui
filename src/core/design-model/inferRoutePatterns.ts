import type { CapturedPage } from '@shared/types/runtimeCapture'
import type { RoutePattern } from '@shared/types/model/projectModel'
import { extractPathname, matchRoutePattern, segmentsOf } from './matchRoutePattern'

/**
 * Phase 4 slice 2 — the runtime counterpart to `matchRoutePattern.ts`. Where
 * that module recognizes URLs against route shapes the source already told
 * us about, this module *learns* a route shape from runtime navigation
 * alone, per spec §4 ("FrameUI can also learn [route patterns] from runtime
 * navigation"): when several captures share the same segment count and
 * differ at exactly one segment index, that's almost certainly a dynamic
 * route the static adapters didn't (or couldn't) surface.
 *
 * Deliberately scoped to the common single-varying-segment case — multi-
 * parameter inference (e.g. `/orders/:id/items/:itemId`) is a real, separate,
 * harder follow-up. Inferred patterns are a capture-analysis-only, on-the-fly
 * concept: never persisted, never fed back into `ProjectModel.routes`.
 *
 * Browser-safe: no Node APIs, runs in the renderer (same convention as
 * `matchRoutePattern.ts` and `tree.ts` in this directory).
 */

export interface InferredRoutePattern {
  /** Synthesized, not sourced from static analysis — e.g. "/products/:param1". */
  pattern: string
  /** ids of the `CapturedPage` records that share this inferred pattern. */
  captureIds: string[]
}

export function inferRoutePatterns(captures: CapturedPage[], knownRoutes: RoutePattern[]): InferredRoutePattern[] {
  const candidates = captures
    .filter((capture) => !matchRoutePattern(capture.url, knownRoutes))
    .map((capture) => ({ capture, segments: segmentsOf(extractPathname(capture.url)) }))

  const byLength = new Map<number, { capture: CapturedPage; segments: string[] }[]>()
  for (const candidate of candidates) {
    const bucket = byLength.get(candidate.segments.length)
    if (bucket) bucket.push(candidate)
    else byLength.set(candidate.segments.length, [candidate])
  }

  const inferred: InferredRoutePattern[] = []

  for (const group of byLength.values()) {
    if (group.length < 2) continue

    const length = group[0].segments.length
    const varyingIndexes: number[] = []
    for (let i = 0; i < length; i++) {
      const values = new Set(group.map((entry) => entry.segments[i]))
      if (values.size > 1) varyingIndexes.push(i)
    }

    if (varyingIndexes.length !== 1) continue

    const [paramIndex] = varyingIndexes
    const patternSegments = [...group[0].segments]
    patternSegments[paramIndex] = ':param1'

    inferred.push({
      pattern: `/${patternSegments.join('/')}`,
      captureIds: group.map((entry) => entry.capture.id),
    })
  }

  return inferred
}
