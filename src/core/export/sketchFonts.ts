export interface ExportFontFace {
  family: string
  style: string
  postscript: string
}
export function resolveExportFont(
  faces: ExportFontFace[],
  family: string,
  weight: string,
  style: string,
): string | undefined {
  const w = weight === 'bold' ? 700 : Number(weight) || 400
  const italic = /italic|oblique/i.test(style)
  const score = (s: string) => {
    let n = 400
    if (/thin/i.test(s)) n = 100
    else if (/extra.?light|ultra.?light/i.test(s)) n = 200
    else if (/light/i.test(s)) n = 300
    else if (/medium/i.test(s)) n = 500
    else if (/semi.?bold|demi/i.test(s)) n = 600
    else if (/extra.?bold|ultra.?bold/i.test(s)) n = 800
    else if (/black|heavy/i.test(s)) n = 900
    else if (/bold/i.test(s)) n = 700
    return n
  }
  return faces.find(
    (f) =>
      f.family.toLowerCase() === family.toLowerCase() &&
      /italic|oblique/i.test(f.style) === italic &&
      score(f.style) === w,
  )?.postscript
}
