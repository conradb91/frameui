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

export {boundedFlowPlacement as xdCanvasPlacement} from '../prototype/flowCanvasPacking'
