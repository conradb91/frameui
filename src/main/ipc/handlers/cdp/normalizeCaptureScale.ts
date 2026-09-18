import type { CapturedElement } from '@shared/types/runtimeCapture'

/** DOMSnapshot boxes already include CSS transforms, while computed style
 * lengths do not. Flatten positive uniform scales into visual style lengths
 * so descendants (especially text in device mockups) fit those measured boxes.
 * Rotated, skewed and nonuniform transforms retain the existing treatment. */
export function normalizeCaptureScale(root: CapturedElement): CapturedElement {
  const lengths = new Set([
    'fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing',
    'borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
    'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'gap', 'rowGap', 'columnGap', 'boxShadow', 'textShadow',
  ])
  function visit(el: CapturedElement, inherited: number): CapturedElement {
    // Synthetic text inherits its owner's computed transform; it is not a
    // second transformed DOM element and must not apply that scale twice.
    const matrix = el.tag !== 'frameui-text' && /^matrix\(([^)]+)\)$/.exec(el.styles.transform ?? '')
    const values = matrix ? matrix[1].split(',').map(Number) : []
    const uniform = values.length === 6 && values.every(Number.isFinite) && values[0] > 0 &&
      Math.abs(values[1]) < 1e-8 && Math.abs(values[2]) < 1e-8 && Math.abs(values[0] - values[3]) < 1e-8
    const scale = inherited * (uniform ? values[0] : 1)
    const styles = { ...el.styles }
    if (scale !== 1) {
      for (const key of lengths) if (styles[key]) {
        styles[key] = styles[key].replace(/(-?(?:\d*\.)?\d+)px\b/g, (_match, value: string) => `${Number(value) * scale}px`)
      }
    }
    if (uniform || el.tag === 'frameui-text') styles.transform = 'none'
    return { ...el, styles, children: el.children.map(child => visit(child, scale)) }
  }
  return visit(root, 1)
}
