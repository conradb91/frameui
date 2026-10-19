import type { CapturedElement } from '@shared/types/runtimeCapture'

/** DOMSnapshot boxes already include CSS transforms, while computed style
 * lengths do not. Flatten positive uniform scales into visual style lengths
 * so descendants (especially text in device mockups) fit those measured boxes.
 * Affine transforms on standalone boxes and SVG roots are recovered from their border-box geometry; complex transformed ancestor trees remain reviewable. */
export function normalizeCaptureScale(root: CapturedElement): CapturedElement {
  const lengths = new Set([
    'fontSize',
    'lineHeight',
    'letterSpacing',
    'wordSpacing',
    'borderWidth',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRadius',
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomLeftRadius',
    'borderBottomRightRadius',
    'padding',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'margin',
    'marginTop',
    'marginRight',
    'marginBottom',
    'marginLeft',
    'gap',
    'rowGap',
    'columnGap',
    'boxShadow',
    'textShadow',
  ])
  function visit(el: CapturedElement, inherited: number, complexAncestor = false): CapturedElement {
    // Synthetic text inherits its owner's computed transform; it is not a
    // second transformed DOM element and must not apply that scale twice.
    const matrix =
      el.tag !== 'frameui-text' && /^matrix\(([^)]+)\)$/.exec(el.styles.transform ?? '')
    const values = matrix ? matrix[1].split(',').map(Number) : []
    const uniform =
      values.length === 6 &&
      values.every(Number.isFinite) &&
      values[0] > 0 &&
      Math.abs(values[1]) < 1e-8 &&
      Math.abs(values[2]) < 1e-8 &&
      Math.abs(values[0] - values[3]) < 1e-8
    const scale = inherited * (uniform ? values[0] : 1)
    const styles = { ...el.styles }
    if (scale !== 1) {
      for (const key of lengths)
        if (styles[key]) {
          styles[key] = styles[key].replace(
            /(-?(?:\d*\.)?\d+)px\b/g,
            (_match, value: string) => `${Number(value) * scale}px`,
          )
        }
    }
    if (uniform || el.tag === 'frameui-text') styles.transform = 'none'
    let rect = el.rect
    const affine = values.length === 6 && values.every(Number.isFinite) && !uniform
    if (
      affine &&
      !complexAncestor &&
      (el.tag === 'svg' || !el.children.length || el.tag === 'input') &&
      el.tag !== 'frameui-text'
    ) {
      const px = (key: string) => Number.parseFloat(el.styles[key]) || 0
      const width =
        px('width') +
        (el.styles.boxSizing === 'border-box'
          ? 0
          : px('paddingLeft') + px('paddingRight') + px('borderLeftWidth') + px('borderRightWidth'))
      const height =
        px('height') +
        (el.styles.boxSizing === 'border-box'
          ? 0
          : px('paddingTop') + px('paddingBottom') + px('borderTopWidth') + px('borderBottomWidth'))
      if (width > 0 && height > 0) {
        const origin = (el.styles.transformOrigin ?? `${width / 2}px ${height / 2}px`)
          .split(/\s+/)
          .map(Number.parseFloat)
        const [a, b, c, d, e, f] = values,
          ox = origin[0] ?? width / 2,
          oy = origin[1] ?? height / 2
        const corners = [
          [0, 0],
          [width, 0],
          [0, height],
          [width, height],
        ].map(([x, y]) => ({
          x: a * (x - ox) + c * (y - oy) + ox + e,
          y: b * (x - ox) + d * (y - oy) + oy + f,
        }))
        const minX = Math.min(...corners.map((p) => p.x)),
          minY = Math.min(...corners.map((p) => p.y))
        const expectedWidth = (Math.max(...corners.map((p) => p.x)) - minX) * inherited,
          expectedHeight = (Math.max(...corners.map((p) => p.y)) - minY) * inherited
        // Reject geometry affected by an unknown ancestor transform or inline fragmentation.
        if (
          Math.abs(expectedWidth - rect.width) < 1 &&
          Math.abs(expectedHeight - rect.height) < 1
        ) {
          rect = {
            x: rect.x - minX * inherited,
            y: rect.y - minY * inherited,
            width: width * inherited,
            height: height * inherited,
          }
          styles.frameuiTransform = `matrix(${a},${b},${c},${d},${e * inherited},${f * inherited})`
          styles.frameuiTransformOrigin = `${ox * inherited}px ${oy * inherited}px`
          styles.transform = 'none'
        }
      }
    }
    if (scale !== 1 && el.attributes?.['data-frameui-glyph-height']) {
      const oldLeading = Number(el.attributes['data-frameui-leading']) || 0
      const glyphHeight = Number(el.attributes['data-frameui-glyph-height'])
      const newLeading = ((Number.parseFloat(styles.lineHeight) || glyphHeight) - glyphHeight) / 2
      rect = {
        ...rect,
        y: rect.y + oldLeading - newLeading,
        height: rect.height - 2 * oldLeading + 2 * newLeading,
      }
    }
    let attributes = el.attributes
    if (scale !== 1 && attributes?.['data-frameui-text-lines'])
      try {
        const lines = JSON.parse(attributes['data-frameui-text-lines'])
        attributes = {
          ...attributes,
          'data-frameui-text-lines': JSON.stringify(
            lines.map((line: { height: number }) => ({ ...line, height: line.height * scale })),
          ),
        }
      } catch {
        /* ordinary text remains available */
      }
    return {
      ...el,
      rect,
      styles,
      attributes,
      children: el.children.map((child) => visit(child, scale, complexAncestor || affine)),
    }
  }
  return visit(root, 1)
}
