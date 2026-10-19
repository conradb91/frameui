import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'

/**
 * Stage 9 sub-slice 3 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §23) — decides
 * which already-compiled `StructuredNode`s should become `RasterFallback`
 * for explicitly unsupported media based on a per-pixel diff mask (original screenshot vs. real HTML/CSS
 * render), not by tag. Sub-slices 1-2 already handle the tag-identifiable
 * cases (canvas, iframe/frame) at compile time; this catches whatever
 * renders wrong for reasons that AREN'T tag-identifiable (unusual masks,
 * complex effects, third-party widgets not already canvas/iframe-based).
 *
 * `DiffMask` is an interface, not a concrete pngjs type, so this module
 * stays dependency-free and trivially testable with a fake mask — the real
 * caller (`renderAndCompareStructuredCapture.ts`) adapts a pixelmatch
 * `diffMask: true` buffer's alpha channel into this shape.
 */
export interface DiffMask {
  width: number
  height: number
  /** Whether pixel (x, y) differs between the original screenshot and the
   * re-render. Out-of-bounds coordinates should return `false`. */
  hasDiff(x: number, y: number): boolean
}

export interface RasterFallbackCandidate {
  nodeId: string
  /** Frame-absolute pixel rect (summed from the root down), not
   * parent-relative like `StructuredNode.bounds` itself. */
  rect: { x: number; y: number; width: number; height: number }
  /** Fraction (0-1) of this rect's pixels that differ. */
  diffRatio: number
}

const DEFAULT_DIFF_RATIO_THRESHOLD = 0.15
/** ~20x20px — skips tiny elements where pixel noise (anti-aliasing,
 * sub-pixel rounding) can dominate the ratio without a real content
 * mismatch. */
const DEFAULT_MIN_AREA = 400

/**
 * Only ever a **leaf** node (`children.length === 0`) — the smallest
 * meaningful unit, sidesteps "which ancestor level is actually the
 * problem" entirely, and structurally guarantees spec §22's "never
 * flatten the whole page" (a leaf can never be the frame root). `Text`
 * nodes are never candidates (spec §24 wants a stricter, separate policy
 * for text — not attempted here). Nodes already `RasterFallback` are
 * skipped — already handled.
 *
 * Absolute rects are computed by summing `bounds.x/y` from the frame root
 * down. Valid right after a fresh capture — `bounds` are real captured
 * `getBoundingClientRect`-derived positions at that point, regardless of
 * the parent's `layout.mode` (only user EDITING can make a stack/grid
 * child's `bounds` drift from its real rendered position, since flex/grid
 * layout ignores stored x/y — see Stage 6's drag restriction). This
 * function only ever runs at capture time, never after editing, so that
 * drift never applies here.
 */
export function selectRasterFallbackCandidates(
  frame: StructuredFrame,
  mask: DiffMask,
  options?: { diffRatioThreshold?: number; minArea?: number },
): RasterFallbackCandidate[] {
  const diffRatioThreshold = options?.diffRatioThreshold ?? DEFAULT_DIFF_RATIO_THRESHOLD
  const minArea = options?.minArea ?? DEFAULT_MIN_AREA
  const candidates: RasterFallbackCandidate[] = []

  function walk(nodes: StructuredNode[], originX: number, originY: number): void {
    for (const node of nodes) {
      const x = originX + node.bounds.x
      const y = originY + node.bounds.y
      const { width, height } = node.bounds
      if (
        node.children.length === 0 &&
        !['frameui-root','html','body'].includes(node.source.tag) &&
        !node.componentBinding &&
        !node.source.control &&
        ['canvas','iframe','frame','video','object','embed'].includes(node.source.tag) &&
        node.type !== 'Text' &&
        node.type !== 'RasterFallback' &&
        width * height >= minArea
      ) {
        const diffRatio = diffRatioInRect(mask, x, y, width, height)
        if (diffRatio > diffRatioThreshold) candidates.push({ nodeId: node.id, rect: { x, y, width, height }, diffRatio })
      }
      walk(node.children, x, y)
    }
  }
  walk(frame.children, 0, 0)
  return candidates
}

function diffRatioInRect(mask: DiffMask, x: number, y: number, width: number, height: number): number {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(mask.width, Math.ceil(x + width))
  const y1 = Math.min(mask.height, Math.ceil(y + height))
  if (x1 <= x0 || y1 <= y0) return 0
  let diff = 0
  const total = (x1 - x0) * (y1 - y0)
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (mask.hasDiff(px, py)) diff++
    }
  }
  return diff / total
}
