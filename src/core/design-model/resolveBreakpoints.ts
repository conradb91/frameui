import type { Token } from '@shared/types/model/projectModel'

/**
 * Real per-breakpoint canvas widths for the Screen Designer / Feature
 * Workspace breakpoint switcher (spec Phase 18) — resolved from the
 * project's own detected breakpoint tokens where possible, rather than the
 * fixed 900/768/375 the two views used to hardcode.
 */
export interface ResolvedBreakpoints {
  desktop: number
  tablet: number
  mobile: number
  /** 'detected' — read from ≥2 of the project's own breakpoint tokens.
   * 'fallback' — nothing reliable was found; these are FrameUI's own
   * defaults, not the project's. Callers must surface this (spec: "never
   * silently pretend they're real"). */
  source: 'detected' | 'fallback'
}

/** Matches what `ScreenDesignerView.tsx`/`FeatureWorkspaceView.tsx` already
 * hardcoded as `BREAKPOINT_WIDTH` before this module existed — kept as the
 * fallback so behavior is unchanged for a project with no readable
 * breakpoint tokens at all. */
export const FALLBACK_BREAKPOINTS: ResolvedBreakpoints = { desktop: 1440, tablet: 768, mobile: 390, source: 'fallback' }

/**
 * Parses a CSS length string (e.g. "768px", "48rem", or a bare number, the
 * last covering Bootstrap-style unitless breakpoint values if a future
 * adapter ever surfaces one as a plain number) into a px number. Mirrors
 * `spacingSnap.ts`'s `parseLengthToPx` — returns null for anything not
 * confidently a length (percentages, `calc()`, keywords), never guessed.
 */
function parseBreakpointValueToPx(value: string): number | null {
  const trimmed = value.trim()
  const remMatch = trimmed.match(/^(-?[\d.]+)rem$/)
  if (remMatch) return parseFloat(remMatch[1]) * 16
  const emMatch = trimmed.match(/^(-?[\d.]+)em$/)
  if (emMatch) return parseFloat(emMatch[1]) * 16
  const pxMatch = trimmed.match(/^(-?[\d.]+)px$/)
  if (pxMatch) return parseFloat(pxMatch[1])
  const bareMatch = trimmed.match(/^(-?[\d.]+)$/)
  if (bareMatch) return parseFloat(bareMatch[1])
  return null
}

/**
 * Resolves the three canvas widths the breakpoint switcher renders at from
 * the project's own breakpoint tokens (spec: "read the project's actual
 * breakpoints where possible — Tailwind config, CSS media queries, SCSS
 * variables, Bootstrap, framework theme config").
 *
 * Only tokens `resolveStyleTokens` actually read from the project count as
 * "detected" — `confidence === 'unresolved'` marks FrameUI's own bundled
 * Tailwind-default snapshot (`defaultBreakpointTokens()` in
 * `defaultTheme.ts`), used when Tailwind is present but its config couldn't
 * be statically resolved. Treating those as real would misreport a generic
 * Tailwind default as this project's breakpoints, so they're excluded here
 * the same way the fallback set below is: real detection needs ≥2 distinct,
 * confidently-parsed, project-sourced pixel values.
 *
 * Largest -> desktop, smallest -> mobile, the middle value -> tablet (or,
 * with exactly two usable values, their midpoint — there's no third value
 * to call "tablet" so one is synthesized rather than duplicating an
 * endpoint).
 */
export function resolveProjectBreakpoints(tokens: Token[]): ResolvedBreakpoints {
  const usable = tokens
    .filter((t) => t.category === 'breakpoint' && t.confidence === 'full')
    .map((t) => parseBreakpointValueToPx(t.value))
    .filter((n): n is number => n !== null && Number.isFinite(n) && n > 0)

  const unique = Array.from(new Set(usable)).sort((a, b) => a - b)
  if (unique.length < 2) return FALLBACK_BREAKPOINTS

  const mobile = unique[0]
  const desktop = unique[unique.length - 1]
  const tablet = unique.length === 2 ? Math.round((mobile + desktop) / 2) : unique[Math.floor(unique.length / 2)]

  return { desktop, tablet, mobile, source: 'detected' }
}
