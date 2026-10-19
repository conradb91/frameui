import type { CapturedElement } from '@shared/types/runtimeCapture'
import type { TextStyleRun, TextGradient } from '@shared/types/richText'
import type { StructuredTypography } from '@shared/types/structuredDesign'
export function captureTextGradient(
  el: CapturedElement,
  owner: CapturedElement = el,
): TextGradient | undefined {
  const s = el.styles
  if (
    !/text/.test(s.backgroundClip ?? s.WebkitBackgroundClip ?? '') ||
    !s.backgroundImage ||
    s.backgroundImage === 'none'
  )
    return
  let fragments: TextGradient['fragments']
  let clone = false
  try {
    const paint = JSON.parse(el.attributes?.['data-frameui-gradient-paint'] ?? 'null')
    if (paint) {
      let offset = 0
      clone = paint.clone
      fragments = paint.fragments.map(
        (box: { x: number; y: number; width: number; height: number }) => {
          const f = { ...box, x: box.x - owner.rect.x, y: box.y - owner.rect.y, offset }
          offset += box.width
          return f
        },
      )
    }
  } catch { /* Retain ordinary text when optional paint metadata is absent. */ }
  return {
    fragments,
    clone,
    image: s.backgroundImage,
    size: s.backgroundSize,
    position: s.backgroundPosition,
    repeat: s.backgroundRepeat,
    bounds: {
      x: el.rect.x - owner.rect.x,
      y: el.rect.y - owner.rect.y,
      width: el.rect.width,
      height: el.rect.height,
    },
  }
}
export function richTextFromCapture(
  owner: CapturedElement,
): Pick<StructuredTypography, 'text' | 'textRuns' | 'captureLines' | 'gradient'> {
  const exact = (el: CapturedElement): boolean =>
    !!el.attributes?.['data-frameui-exact-text'] || el.children.some(exact)
  const hasExact = exact(owner)
  let text = ''
  const runs: TextStyleRun[] = [],
    lines: NonNullable<StructuredTypography['captureLines']> = []
  const walk = (el: CapturedElement, paint?: TextGradient) => {
    if (
      el.styles.visibility === 'hidden' ||
      el.styles.display === 'none' ||
      el.styles.opacity === '0'
    )
      return
    if (el.tag !== 'frameui-text') paint = captureTextGradient(el, owner) ?? paint
    if (el.tag === 'br') {
      text += '\n'
      return
    }
    if (el.tag === 'frameui-text') {
      const content = el.textPreview ?? ''
      if (!hasExact && text && !text.endsWith('\n') && !/^[\s]/.test(content)) text += ' '
      const start = text.length
      text += content
      const s = el.styles
      if (content)
        runs.push({
          start,
          end: text.length,
          fontWeight: s.fontWeight,
          fontStyle: s.fontStyle,
          fontFamily: s.fontFamily,
          fontSize: parseFloat(s.fontSize) || undefined,
          lineHeight: parseFloat(s.lineHeight) || undefined,
          letterSpacing: parseFloat(s.letterSpacing) || 0,
          color: s.color,
          textDecoration: s.textDecoration,
          gradient: paint,
        })
      let fragments:
        | { text: string; x: number; y: number; width: number; height: number; start?: number }[]
        | undefined
      try {
        fragments = JSON.parse(el.attributes?.['data-frameui-text-lines'] ?? 'null')
      } catch { /* Retain ordinary text when optional paint metadata is absent. */ }
      if (fragments?.length) {
        let offset = 0
        for (const line of fragments) {
          const local = line.start ?? content.indexOf(line.text, offset)
          offset = Math.max(0, local) + line.text.length
          lines.push({
            ...line,
            start: start + Math.max(0, local),
            x: el.rect.x - owner.rect.x + line.x,
            y: el.rect.y - owner.rect.y + line.y,
          })
        }
      } else if (content.trim())
        lines.push({
          text: content,
          start,
          x: el.rect.x - owner.rect.x,
          y: el.rect.y - owner.rect.y,
          width: el.rect.width,
          height: parseFloat(s.lineHeight) || el.rect.height,
        })
      return
    }
    el.children.forEach((c) => walk(c, paint))
  }
  walk(owner)
  const leading = text.length - text.trimStart().length,
    trailing = text.trimEnd().length
  const trimmed = text.slice(leading, trailing)
  return {
    text: trimmed,
    textRuns: runs
      .map((r) => ({
        ...r,
        start: Math.max(0, r.start - leading),
        end: Math.min(trailing, r.end) - leading,
      }))
      .filter((r) => r.end > r.start),
    captureLines: lines
      .map((l) => {
        const from = Math.max(l.start ?? 0, leading),
          to = Math.min((l.start ?? 0) + l.text.length, trailing)
        return { ...l, start: from - leading, text: text.slice(from, to) }
      })
      .filter((l) => l.text),
    gradient: captureTextGradient(owner),
  }
}
