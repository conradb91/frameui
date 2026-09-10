import { UI_FONT, themes } from '../../shared/theme'
import type { Flow } from '@shared/types/flow'

const NODE_WIDTH = 200
const NODE_HEIGHT = 90
const PADDING = 60

/** EXP-06 — the whole flow canvas (node thumbnaily rects + connectors) as
 * one SVG, independent of the screen checklist (it's always the full flow). */
export function serializeFlowToSvg(flow: Flow): { svg: string; width: number; height: number } {
  const maxX = Math.max(0, ...flow.nodes.map((n) => n.position.x + NODE_WIDTH))
  const maxY = Math.max(0, ...flow.nodes.map((n) => n.position.y + NODE_HEIGHT))
  const width = maxX + PADDING * 2
  const height = maxY + PADDING * 2

  const byId = new Map(flow.nodes.map((n) => [n.id, n]))
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${themes.dark['canvas']}"/>`,
    `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="${themes.dark['text-3']}"/></marker></defs>`,
  ]

  for (const edge of flow.edges) {
    const from = byId.get(edge.sourceNodeId)
    const to = byId.get(edge.targetNodeId)
    if (!from || !to) continue
    const x1 = from.position.x + PADDING + NODE_WIDTH
    const y1 = from.position.y + PADDING + NODE_HEIGHT / 2
    const x2 = to.position.x + PADDING
    const y2 = to.position.y + PADDING + NODE_HEIGHT / 2
    const midX = (x1 + x2) / 2
    parts.push(`<path d="M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}" stroke="${themes.dark['border-strong']}" stroke-width="1.6" fill="none" marker-end="url(#arrow)"/>`)
    if (edge.label) {
      parts.push(
        `<text x="${midX}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-family="${escapeXml(UI_FONT)}" font-size="11" font-weight="600" fill="${themes.dark['accent-2']}">${escapeXml(edge.label)}</text>`,
      )
    }
  }

  for (const node of flow.nodes) {
    const x = node.position.x + PADDING
    const y = node.position.y + PADDING
    parts.push(`<rect x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="0" fill="${themes.dark['panel']}" stroke="${themes.dark['border']}" stroke-width="1"/>`)
    parts.push(`<line x1="${x}" y1="${y + 52}" x2="${x + NODE_WIDTH}" y2="${y + 52}" stroke="${themes.dark['border']}"/>`)
    parts.push(
      `<text x="${x + 12}" y="${y + 72}" font-family="${escapeXml(UI_FONT)}" font-size="12.5" font-weight="600" fill="${themes.dark['text']}">${escapeXml(node.name)}</text>`,
    )
    const sourceLabel = node.source.type === 'blank' ? 'Blank screen' : 'Existing page'
    parts.push(
      `<text x="${x + 12}" y="${y + 30}" font-family="${escapeXml(UI_FONT)}" font-size="10.5" fill="${themes.dark['text-3']}">${escapeXml(sourceLabel)}</text>`,
    )
  }

  parts.push('</svg>')
  return { svg: parts.join('\n'), width, height }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
