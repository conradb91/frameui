/** Legacy CSS clip applies to positioned boxes, including screen-reader-only labels. */
function edges(value?: string) {
  const match = /^rect\((.*)\)$/.exec(value ?? '')
  if (!match) return
  const parts = match[1].trim().split(/[\s,]+/)
  if (parts.length !== 4) return
  const result = parts.map(v => v === 'auto' ? undefined : /^-?[\d.]+(?:px)?$/.test(v) ? parseFloat(v) : NaN)
  return result.some(v => v !== undefined && !Number.isFinite(v)) ? undefined : result
}
export function emptyLegacyClip(value?: string): boolean {
  const e = edges(value)
  return !!e && ((e[0] !== undefined && e[2] !== undefined && e[2] <= e[0]) || (e[1] !== undefined && e[3] !== undefined && e[1] <= e[3]))
}
export function legacyClipPath(value: string | undefined, width: number, height: number): string | undefined {
  const e = edges(value)
  if (!e) return
  return `inset(${e[0] ?? 0}px ${width - (e[1] ?? width)}px ${height - (e[2] ?? height)}px ${e[3] ?? 0}px)`
}
