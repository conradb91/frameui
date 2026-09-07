import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import type { ResolvedBox } from '../design-model/layout'
import { resolveLayout } from '../design-model/layout'

// Same token values as the app's own Tailwind theme (src/renderer/styles/globals.css)
// — literal here since exported SVG must be self-contained, no external
// stylesheet dependency (this also makes it paste cleanly into Figma).
const COLOR = {
  canvasBg: '#111114',
  border: 'rgba(255,255,255,0.14)',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255,255,255,0.7)',
  textTertiary: 'rgba(255,255,255,0.45)',
  accent: '#7c6af2',
  panel2: '#17171b',
  danger: '#f16565',
  warning: '#f5b84b',
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderBox(box: ResolvedBox): string {
  const { node, x, y, width, height } = box
  const parts: string[] = []

  switch (node.kind) {
    case 'container':
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="none" stroke="${COLOR.border}" stroke-width="1"/>`)
      break
    case 'heading':
      parts.push(
        `<text x="${x}" y="${y + height * 0.78}" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="700" fill="${COLOR.textPrimary}">${esc(node.content)}</text>`,
      )
      break
    case 'text':
      parts.push(
        `<text x="${x}" y="${y + height * 0.78}" font-family="Inter, system-ui, sans-serif" font-size="14" fill="${COLOR.textSecondary}">${esc(node.content)}</text>`,
      )
      break
    case 'button': {
      const isPrimary = node.variant === 'primary'
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9" fill="${isPrimary ? COLOR.accent : COLOR.panel2}" stroke="${isPrimary ? 'none' : COLOR.border}" stroke-width="1"/>`)
      parts.push(
        `<text x="${x + width / 2}" y="${y + height / 2 + 4.5}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="${isPrimary ? '#ffffff' : COLOR.textSecondary}">${esc(node.label)}</text>`,
      )
      break
    }
    case 'divider':
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="1" fill="${COLOR.border}"/>`)
      break
    case 'image':
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${COLOR.panel2}"/>`)
      parts.push(
        `<text x="${x + width / 2}" y="${y + height / 2 + 4}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11.5" fill="${COLOR.textTertiary}">${esc(node.alt || 'Image')}</text>`,
      )
      break
    case 'placeholder': {
      const color = node.editability === 'limited' ? COLOR.warning : COLOR.danger
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9" fill="${COLOR.panel2}" stroke="${color}" stroke-opacity="0.4" stroke-dasharray="4 3" stroke-width="1"/>`)
      parts.push(
        `<text x="${x + 12}" y="${y + height / 2 + 4}" font-family="Inter, system-ui, sans-serif" font-size="12" fill="${COLOR.textSecondary}">${esc(node.label)}</text>`,
      )
      break
    }
    case 'stack':
      break // pure layout container, no visual output of its own
  }

  for (const child of box.children) parts.push(renderBox(child))
  return parts.join('\n')
}

export interface SvgExportResult {
  svg: string
  width: number
  height: number
}

const CANVAS_PADDING = 32

export function serializeScreenToSvg(tree: DesignNode, breakpoint: Breakpoint, frameWidth: number): SvgExportResult {
  const innerWidth = frameWidth - CANVAS_PADDING * 2
  const rootBox = resolveLayout(tree, breakpoint, innerWidth, CANVAS_PADDING, CANVAS_PADDING)
  const totalHeight = rootBox.y + rootBox.height + CANVAS_PADDING

  const body = renderBox(rootBox)
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frameWidth}" height="${totalHeight}" viewBox="0 0 ${frameWidth} ${totalHeight}">`,
    `<rect x="0" y="0" width="${frameWidth}" height="${totalHeight}" fill="${COLOR.canvasBg}"/>`,
    body,
    `</svg>`,
  ].join('\n')

  return { svg, width: frameWidth, height: totalHeight }
}
