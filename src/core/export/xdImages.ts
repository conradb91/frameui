/** Browser-rendered, image-only CSS colour adjustments; originals remain in companion data. */
export interface XdRenderedImageEffect {
  source: string
  filter: string
  data: string
}
export const xdImageColorFilter =
  /^(?:(?:saturate|brightness|contrast|grayscale|sepia|invert|opacity|hue-rotate)\([^)]*\)\s*)+$/i

/** Explicit CSS replaced-element rectangle, before clipping to the element box. */
export function xdObjectImageBounds(width: number, height: number, intrinsicWidth: number, intrinsicHeight: number, fit: string, position = '50% 50%') {
  let scale = fit === 'contain' ? Math.min(width / intrinsicWidth, height / intrinsicHeight) : Math.max(width / intrinsicWidth, height / intrinsicHeight)
  if (fit === 'none') scale = 1
  if (fit === 'scale-down') scale = Math.min(1, Math.min(width / intrinsicWidth, height / intrinsicHeight))
  const w = fit === 'fill' ? width : intrinsicWidth * scale
  const h = fit === 'fill' ? height : intrinsicHeight * scale
  const parts = position.trim().split(/\s+/)
  if (parts.length === 1 && /^(top|bottom)$/.test(parts[0])) parts.unshift('50%')
  if (/^(top|bottom)$/.test(parts[0]) && /^(left|right|center)$/.test(parts[1] ?? '')) parts.reverse()
  const offset = (v: string, space: number) => v === 'center' ? space / 2 : v === 'right' || v === 'bottom' ? space : v === 'left' || v === 'top' ? 0 : /^-?[\d.]+%$/.test(v) ? parseFloat(v) * space / 100 : /^-?[\d.]+(?:px)?$/.test(v) ? parseFloat(v) : space / 2
  return { x: offset(parts[0] ?? '50%', width - w), y: offset(parts[1] ?? '50%', height - h), width: w, height: h }
}
