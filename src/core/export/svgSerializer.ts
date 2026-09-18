import { UI_FONT, themes } from '../../shared/theme'
import type { DesignNode, Breakpoint, NodeStyle } from '@shared/types/designNode'
import type { ExportWarning, FeatureExportSettings, ExportScene, DesignExporter } from '@shared/types/handoff'
import type { ResolvedBox } from '../design-model/layout'
import { resolveLayout } from '../design-model/layout'

const COLOR = { canvasBg: themes.dark.canvas, border: themes.dark.border, textPrimary: themes.dark.text, textSecondary: themes.dark['text-2'], textTertiary: themes.dark['text-3'], accent: themes.dark.accent, panel2: themes.dark['panel-2'], danger: themes.dark.danger, warning: themes.dark.warning }
const CANVAS_PADDING = 32

function esc(text: string): string { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;') }
function safeContent(text: string): string { return /(?:bearer\s+[a-z0-9._-]+|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|\b\d{13,19}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(text) ? '[redacted]' : text }
function num(value: number): string { return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0' }
function safeId(value: string): string { const id = value.replace(/[^a-zA-Z0-9_.:-]+/g, '-'); return /^[a-zA-Z_]/.test(id) ? id : `node-${id}` }
function name(node: DesignNode): string {
  if (node.kind === 'placeholder') return node.label
  if (node.kind === 'concept') return node.conceptComponentId
  if (node.kind === 'button') return node.label || 'Button'
  if (node.kind === 'heading' || node.kind === 'text') return node.content.slice(0, 48) || node.kind
  if (node.kind === 'image') return node.alt || 'Image'
  return node.kind[0].toUpperCase() + node.kind.slice(1)
}
function styleAt(node: DesignNode, breakpoint: Breakpoint): NodeStyle { return { ...node.style, ...(breakpoint === 'desktop' ? undefined : node.responsiveOverrides?.[breakpoint]?.style) } }
function paintAttrs(style: NodeStyle): string { return style.opacity === undefined ? '' : `opacity="${num(style.opacity)}"` }
function textAttrs(style: NodeStyle, defaults: { size: number; weight: number; color: string }): string {
  return `font-family="${esc(style.fontFamily || UI_FONT)}" font-size="${num(style.fontSize ?? defaults.size)}" font-weight="${num(style.fontWeight ?? defaults.weight)}" fill="${esc(style.color ?? defaults.color)}"${style.letterSpacing !== undefined ? ` letter-spacing="${num(style.letterSpacing)}"` : ''}`
}
function rect(box: ResolvedBox, style: NodeStyle, defaults: { fill: string; radius?: number; stroke?: string }): string {
  const fill = style.backgroundColor ?? defaults.fill
  const stroke = style.borderColor ?? defaults.stroke ?? 'none'
  const borderWidth = style.borderWidth ?? (stroke === 'none' ? 0 : 1)
  return `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}" rx="${num(style.borderRadius ?? defaults.radius ?? 0)}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${num(borderWidth)}" ${paintAttrs(style)}/>`
}
function renderBox(box: ResolvedBox, breakpoint: Breakpoint, warnings: ExportWarning[]): string {
  const { node, x, y, width, height } = box
  const style = styleAt(node, breakpoint)
  const parts = [`<g id="${safeId(node.id)}" data-frameui-id="${esc(node.id)}" data-frameui-kind="${node.kind}" aria-label="${esc(name(node))}">`]
  if (style.boxShadow) warnings.push({ code: 'effect-approximation', message: `Shadow on ${name(node)} is approximated in SVG.`, nodeId: node.id })
  if (style.fontFamily && !/^(Inter|Arial|Helvetica|system-ui|sans-serif|serif|monospace)/i.test(style.fontFamily)) warnings.push({ code: 'font-availability', message: `Font “${style.fontFamily}” must be installed in the importing design tool to render exactly.`, nodeId: node.id })
  switch (node.kind) {
    case 'stack': case 'grid': if (style.backgroundColor || style.borderColor) parts.push(rect(box, style, { fill: 'none' })); break
    case 'container': parts.push(rect(box, style, { fill: 'none', radius: 12, stroke: COLOR.border })); break
    case 'heading': case 'text': {
      const defaults = node.kind === 'heading' ? { size: 22, weight: 700, color: COLOR.textPrimary } : { size: 14, weight: 400, color: COLOR.textSecondary }
      const anchor = style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start'
      const tx = anchor === 'middle' ? x + width / 2 : anchor === 'end' ? x + width : x
      const lineHeight = style.lineHeight ?? (node.kind === 'heading' ? 30 : 20)
      parts.push(`<text x="${num(tx)}" y="${num(y + Math.min(height, lineHeight) * .78)}" text-anchor="${anchor}" ${textAttrs(style, defaults)} ${paintAttrs(style)}>${esc(safeContent(node.content))}</text>`)
      break
    }
    case 'button': {
      const primary = node.variant === 'primary'
      parts.push(rect(box, style, { fill: primary ? COLOR.accent : COLOR.panel2, radius: 9, stroke: primary ? 'none' : COLOR.border }))
      parts.push(`<text x="${num(x + width / 2)}" y="${num(y + height / 2 + 4.5)}" text-anchor="middle" ${textAttrs(style, { size: 13, weight: 600, color: primary ? themes.dark['on-accent'] : COLOR.textSecondary })}>${esc(safeContent(node.label))}</text>`)
      break
    }
    case 'divider': parts.push(rect({ ...box, height: typeof style.height === 'number' ? style.height : 1 }, style, { fill: style.backgroundColor ?? COLOR.border })); break
    case 'image': {
      const clipId = `clip-${safeId(node.id)}`
      parts.push(`<defs><clipPath id="${clipId}"><rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="${num(style.borderRadius ?? 10)}"/></clipPath></defs>`)
      if (node.vector) parts.push(`<svg x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" viewBox="${esc(node.vector.viewBox)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})" aria-label="${esc(node.alt)}">${node.vector.paths.map((path) => `<path id="${safeId(path.id)}" d="${esc(path.d)}" fill="${esc(path.fill ?? 'none')}"${path.stroke ? ` stroke="${esc(path.stroke)}"` : ''}${path.opacity !== undefined ? ` opacity="${num(path.opacity)}"` : ''}/>`).join('')}</svg>`)
      else if (node.src?.startsWith('data:image/')) parts.push(`<image x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" href="${esc(node.src)}" preserveAspectRatio="${node.objectFit === 'contain' ? 'xMidYMid meet' : node.objectFit === 'fill' ? 'none' : 'xMidYMid slice'}" clip-path="url(#${clipId})"/>`)
      else {
        parts.push(rect(box, style, { fill: COLOR.panel2, radius: 10 }))
        parts.push(`<text x="${num(x + width / 2)}" y="${num(y + height / 2 + 4)}" text-anchor="middle" ${textAttrs(style, { size: 11.5, weight: 400, color: COLOR.textTertiary })}>${esc(node.alt || 'Image')}</text>`)
        if (node.src) warnings.push({ code: 'image-not-embedded', message: `Image “${node.alt || node.id}” was not embedded because its source is not portable.`, nodeId: node.id })
      }
      break
    }
    case 'placeholder': {
      const color = node.editability === 'limited' ? COLOR.warning : COLOR.danger
      parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="${num(style.borderRadius ?? 9)}" fill="${esc(style.backgroundColor ?? COLOR.panel2)}" stroke="${esc(style.borderColor ?? color)}" stroke-opacity="0.4" stroke-dasharray="4 3" stroke-width="${num(style.borderWidth ?? 1)}" ${paintAttrs(style)}/>`)
      parts.push(`<text x="${num(x + 12)}" y="${num(y + height / 2 + 4)}" ${textAttrs(style, { size: 12, weight: 400, color: COLOR.textSecondary })}>${esc(safeContent(node.textPreview || node.label))}</text>`)
      break
    }
    case 'concept': {
      parts.push(rect(box, style, { fill: COLOR.panel2, radius: 10, stroke: COLOR.accent }))
      const props = Object.values(node.propertyValues).filter(Boolean).join(' · ')
      parts.push(`<text x="${num(x + 14)}" y="${num(y + 26)}" ${textAttrs(style, { size: 13, weight: 600, color: COLOR.textPrimary })}>${esc(node.conceptComponentId)}</text>`)
      if (props) parts.push(`<text x="${num(x + 14)}" y="${num(y + 45)}" ${textAttrs(style, { size: 11, weight: 400, color: COLOR.textTertiary })}>${esc(safeContent(props))}</text>`)
      break
    }
  }
  for (const child of box.children) parts.push(renderBox(child, breakpoint, warnings))
  parts.push('</g>')
  return parts.join('\n')
}

export interface SvgExportResult { svg: string; width: number; height: number; warnings: ExportWarning[] }
export interface SvgSerializeOptions { background?: 'design' | 'transparent'; includeMetadata?: boolean; embedImages?: boolean; name?: string }
export function serializeScreenToSvg(tree: DesignNode, breakpoint: Breakpoint, frameWidth: number, options: SvgSerializeOptions = {}): SvgExportResult {
  if (options.embedImages === false) tree = stripImageData(tree)
  const rootBox = resolveLayout(tree, breakpoint, Math.max(1, frameWidth - CANVAS_PADDING * 2), CANVAS_PADDING, CANVAS_PADDING)
  const totalHeight = Math.max(1, rootBox.y + rootBox.height + CANVAS_PADDING)
  const warnings: ExportWarning[] = []
  const metadata = options.includeMetadata ? `<metadata>${esc(JSON.stringify({ exporter: 'FrameUI SVG V1', rootId: tree.id, breakpoint }))}</metadata>` : ''
  const background = options.background === 'transparent' ? '' : `<rect id="Background" x="0" y="0" width="${frameWidth}" height="${num(totalHeight)}" fill="${COLOR.canvasBg}"/>`
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${frameWidth}" height="${num(totalHeight)}" viewBox="0 0 ${frameWidth} ${num(totalHeight)}" role="img" aria-label="${esc(options.name ?? 'FrameUI design')}">`, `<title>${esc(options.name ?? 'FrameUI design')}</title>`, metadata, background, `<g id="Page" aria-label="Page">${renderBox(rootBox, breakpoint, warnings)}</g>`, '</svg>'].filter(Boolean).join('\n')
  return { svg, width: frameWidth, height: totalHeight, warnings }
}
export class SvgExporter implements DesignExporter<SvgExportResult> {
  readonly format = 'svg-v1'
  exportScene(scene: ExportScene, settings: FeatureExportSettings): SvgExportResult { return serializeScreenToSvg(scene.tree, scene.viewport, scene.width, { background: settings.background, includeMetadata: settings.includeMetadata, embedImages: settings.embedImages, name: settings.includePageLabels ? scene.name : 'FrameUI design' }) }
}

function stripImageData(node: DesignNode): DesignNode {
  return { ...node, ...(node.kind === 'image' ? { src: undefined } : {}), children: node.children.map(stripImageData) } as DesignNode
}
