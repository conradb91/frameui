import type { ExportFontFace } from './sketchFonts'
export function xdFontWeight(style: string): number {
  if (/thin/i.test(style)) return 100
  if (/extra.?light|ultra.?light/i.test(style)) return 200
  if (/light/i.test(style)) return 300
  if (/medium/i.test(style)) return 500
  if (/semi.?bold|demi/i.test(style)) return 600
  if (/extra.?bold|ultra.?bold/i.test(style)) return 800
  if (/black|heavy/i.test(style)) return 900
  if (/bold/i.test(style)) return 700
  return 400
}
/** Resolve CSS family preference first, then nearest installed weight/style within that family. */
export function resolveXdCssFont(
  faces: ExportFontFace[],
  stack: string,
  weight: string,
  style: string,
): ExportFontFace | undefined {
  const requested = weight === 'bold' ? 700 : Number(weight) || 400,
    italic = /italic|oblique/i.test(style)
  const families = (stack.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map((f) =>
    f.trim().replace(/^["']|["']$/g, ''),
  )
  for (const family of families) {
    const generic = /^(sans-serif|system-ui|-apple-system|BlinkMacSystemFont)$/i.test(family)
      ? ['Arial', 'Helvetica Neue', 'Helvetica', 'Segoe UI', 'Noto Sans']
      : /^serif$/i.test(family)
        ? ['Times New Roman', 'Times', 'Georgia']
        : /^monospace$/i.test(family)
          ? ['Menlo', 'Consolas', 'Courier New']
          : []
    for (const candidate of generic.length ? generic : [family]) {
      const matching = faces.filter((f) => f.family.toLowerCase() === candidate.toLowerCase())
      if (matching.length)
        return matching.sort(
          (a, b) =>
            Number(/italic|oblique/i.test(a.style) !== italic) * 1000 +
            Math.abs(xdFontWeight(a.style) - requested) -
            (Number(/italic|oblique/i.test(b.style) !== italic) * 1000 +
              Math.abs(xdFontWeight(b.style) - requested)),
        )[0]
    }
  }
}
export interface XdRenderedFontFace {
  stack: string
  weight: string
  style: string
  family: string
  postscript: string
  substitutedFrom?: string
  fontStyle?: string
  inkByText?: Record<string, {sourceWidth:number;targetWidth:number;sourceLeft:number;targetLeft:number;sourceAscent:number;targetAscent:number}>
  sourceBaselineBySize?: Record<string, number>
  baselineBySize?: Record<string, number>
}
export function xdFontKey(stack: string, weight: string, style: string): string {
  const families = (stack.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? [])
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase(),
    )
    .join(',')
  return [
    families,
    weight === 'bold' ? '700' : String(Number(weight) || 400),
    /italic|oblique/i.test(style) ? 'italic' : 'normal',
  ].join('|')
}
