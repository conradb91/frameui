import type { Token } from '@shared/types/model/projectModel'

/**
 * Parses a CSS length string (e.g. "0.25rem", "4px", "1em", or a bare
 * number) into a px number. Returns null for anything we can't confidently
 * interpret (calc(), percentages, keyword values, …) — snapping should
 * silently skip a token it can't read rather than guess.
 */
function parseLengthToPx(value: string): number | null {
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
 * Snaps a raw numeric spacing value (gap, padding, a resize-handle delta, …)
 * to the nearest of the project's real spacing tokens — spec Phase 11:
 * "prefer the project's real spacing values… don't automatically create
 * random 17px or 29px spacing." Callers are expected to skip this (i.e. use
 * the raw value) when the user has explicitly asked for a manual override,
 * e.g. by holding a modifier key while dragging.
 *
 * Falls back to the untouched input when the project has no spacing tokens
 * (or none parse to a usable px value), so a project without a resolved
 * design system behaves exactly as it did before snapping existed.
 */
export function snapToSpacingToken(value: number, tokens: Token[]): number {
  const candidates = tokens
    .filter((t) => t.category === 'spacing')
    .map((t) => parseLengthToPx(t.value))
    .filter((n): n is number => n !== null && Number.isFinite(n))

  if (candidates.length === 0) return value

  let nearest = candidates[0]
  let nearestDistance = Math.abs(value - nearest)
  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(value - candidate)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest
}
