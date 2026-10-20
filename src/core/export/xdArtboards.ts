import { parse } from 'culori'
import type { FrameUiExportNode, FrameUiPaint } from '@shared/types/frameuiExport'
import type { VisualPage } from '@shared/types/visualDesign'
/** Remove only proven synthetic, inert capture roots. Real DOM/layout groups remain editable. */
export function xdArtboardProjection(
  page: VisualPage,
  nodes: FrameUiExportNode[],
  interactionTargets: ReadonlySet<string>,
): { children: FrameUiExportNode[]; background?: FrameUiPaint } {
  const synthetic = new Set<string>()
  const scan = (children: NonNullable<VisualPage['structured']>['children']) => {
    for (const child of children) {
      if (child.source.tag === 'frameui-root') synthetic.add(child.id)
      scan(child.children)
    }
  }
  if (page.structured) scan(page.structured.children)
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const inert = (n: FrameUiExportNode) => {
    const a = n.captureAppearance
    const transform = a?.transform
    const matrix = transform
      ?.match(/^matrix\(([^)]+)\)$/)?.[1]
      .split(/[, ]+/)
      .map(Number)
    const identity =
      !transform ||
      transform === 'none' ||
      (matrix?.length === 6 && matrix.every((v, i) => near(v, [1, 0, 0, 1, 0, 0][i])))
    return (
      synthetic.has(n.id) &&
      !interactionTargets.has(n.id) &&
      identity &&
      near(n.x, 0) &&
      near(n.y, 0) &&
      near(n.width, page.width) &&
      near(n.height, page.height) &&
      near(n.opacity, 1) &&
      near(n.rotation, 0) &&
      n.visible &&
      !n.locked &&
      !n.component &&
      (!n.strokes.length || n.strokeWidth <= 0) &&
      !n.effects.length &&
      n.radius.every((r) => near(r, 0)) &&
      (!a?.clipPath || a.clipPath === 'none') &&
      (!a?.maskImage || a.maskImage === 'none') &&
      (!a?.filter || a.filter === 'none') &&
      (!a?.backdropFilter || a.backdropFilter === 'none') &&
      (!a?.mixBlendMode || a.mixBlendMode === 'normal')
    )
  }
  let background: FrameUiPaint | undefined
  const visit = (items: FrameUiExportNode[]): FrameUiExportNode[] =>
    items.flatMap((n, index) => {
      if (!inert(n)) return [n]
      if (n.fills.length) {
        const fill = n.fills[0]
        if (
          index !== 0 ||
          n.fills.length !== 1 ||
          fill.type !== 'SOLID' ||
          fill.opacity !== 1 ||
          !parse(fill.color) ||
          (parse(fill.color)?.alpha ?? 1) !== 1
        )
          return [n]
        background = fill
      }
      return visit(n.children)
    })
  return { children: visit(nodes), background }
}

/** XD's visible canvas spans -25,000..25,000 on each axis. Never scale source designs. */
export function xdCanvasPlacement(pages: { id: string; width: number; height: number; canvasX?: number; canvasY?: number }[]): { bounds: Map<string, { x: number; y: number; width: number; height: number }>; rearranged: boolean } {
  const bounds = new Map(pages.map((p, i) => [p.id, { x: p.canvasX ?? i * (p.width + 160), y: p.canvasY ?? 0, width: p.width, height: p.height }]))
  if ([...bounds.values()].every((b) => b.x >= -25000 && b.y >= -25000 && b.x + b.width <= 25000 && b.y + b.height <= 25000)) return { bounds, rearranged: false }
  const gap = 240
  const area = pages.reduce((sum, p) => sum + (p.width + gap) * (p.height + gap), 0)
  const rowWidth = Math.min(49000, Math.max(...pages.map((p) => p.width), Math.sqrt(area)))
  let x = 0, y = 0, rowHeight = 0, width = 0
  for (const p of pages) {
    if (p.width > 49000 || p.height > 49000) throw new Error('An artboard exceeds Adobe XD canvas limits. Split the source screen before exporting; dimensions were not scaled.')
    if (x > 0 && x + p.width > rowWidth) { x = 0; y += rowHeight + gap; rowHeight = 0 }
    bounds.set(p.id, { x, y, width: p.width, height: p.height })
    width = Math.max(width, x + p.width)
    x += p.width + gap; rowHeight = Math.max(rowHeight, p.height)
  }
  const height = y + rowHeight
  if (height > 49000) throw new Error('The selected artboards exceed Adobe XD canvas limits. Export fewer artboards; dimensions were not scaled.')
  for (const b of bounds.values()) { b.x -= width / 2; b.y -= height / 2 }
  return { bounds, rearranged: true }
}
