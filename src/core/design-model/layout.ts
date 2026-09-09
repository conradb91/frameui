import type { DesignNode, Breakpoint } from '@shared/types/designNode'

export interface ResolvedBox {
  node: DesignNode
  x: number
  y: number
  width: number
  height: number
  children: ResolvedBox[]
}

// Fixed visual constants matching the RenderNode/PreviewRenderNode Tailwind
// classes, so exported geometry reasonably matches what's on screen. Not
// pixel-perfect DOM measurement — a deterministic, dependency-free estimate
// consistent with this build's schematic-rendering scope decision.
const HEADING_FONT = '700 22px Inter, system-ui, sans-serif'
const HEADING_LINE_HEIGHT = 30
const TEXT_FONT = '400 14px Inter, system-ui, sans-serif'
const TEXT_LINE_HEIGHT = 20
const BUTTON_FONT = '600 13px Inter, system-ui, sans-serif'
const BUTTON_PAD_X = 16
const BUTTON_HEIGHT = 42
const PLACEHOLDER_HEIGHT = 40
const CONTAINER_PADDING = 16
const CONTAINER_GAP = 12
const IMAGE_HEIGHT = 128
const DIVIDER_HEIGHT = 1
const GRID_ROW_HEIGHT = 96
const CONCEPT_HEIGHT = 64

let measureCtx: OffscreenCanvasRenderingContext2D | null = null
function measureTextWidth(text: string, font: string): number {
  if (!measureCtx) {
    measureCtx = new OffscreenCanvas(10, 10).getContext('2d')
  }
  if (!measureCtx || !text) return 0
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

function isVisible(node: DesignNode, breakpoint: Breakpoint): boolean {
  if (node.hidden) return false
  if (breakpoint !== 'desktop' && node.responsiveHidden?.[breakpoint]) return false
  return true
}

/**
 * Pure, DOM-free geometry resolver — the one source of truth the SVG
 * serializer (and PNG rasterization built on it) consume, so there is
 * never a second reimplementation of "how a Stack with gap:N becomes
 * positions." Hidden nodes (this breakpoint) are skipped entirely, not
 * just marked invisible, matching Preview's behavior.
 */
export function resolveLayout(node: DesignNode, breakpoint: Breakpoint, containerWidth: number, x = 0, y = 0): ResolvedBox {
  switch (node.kind) {
    case 'stack': {
      const visibleChildren = node.children.filter((c) => isVisible(c, breakpoint))
      const isRow = node.direction === 'row'
      const children: ResolvedBox[] = []
      let cursor = 0

      for (const child of visibleChildren) {
        const childX = isRow ? x + cursor : x
        const childY = isRow ? y : y + cursor
        const childWidth = isRow ? undefined : containerWidth
        const box = resolveLayout(child, breakpoint, childWidth ?? containerWidth, childX, childY)
        children.push(box)
        cursor += (isRow ? box.width : box.height) + node.gap
      }
      if (visibleChildren.length > 0) cursor -= node.gap

      const crossSize = isRow
        ? Math.max(0, ...children.map((c) => c.height))
        : Math.max(0, ...children.map((c) => c.width), 0)

      // Cross-axis alignment: shift each child within the cross dimension.
      for (const c of children) {
        if (isRow) {
          if (node.align === 'center') c.y = y + (crossSize - c.height) / 2
          else if (node.align === 'end') c.y = y + crossSize - c.height
          else if (node.align === 'stretch') c.height = crossSize
        } else {
          if (node.align === 'center') c.x = x + (containerWidth - c.width) / 2
          else if (node.align === 'end') c.x = x + containerWidth - c.width
          else if (node.align === 'stretch') c.width = containerWidth
        }
      }

      return {
        node,
        x,
        y,
        width: isRow ? Math.max(0, cursor) : containerWidth,
        height: isRow ? crossSize : Math.max(0, cursor),
        children,
      }
    }

    case 'container': {
      const visibleChildren = node.children.filter((c) => isVisible(c, breakpoint))
      const innerWidth = containerWidth - CONTAINER_PADDING * 2
      const children: ResolvedBox[] = []
      let cursor = CONTAINER_PADDING
      for (const child of visibleChildren) {
        const box = resolveLayout(child, breakpoint, innerWidth, x + CONTAINER_PADDING, y + cursor)
        children.push(box)
        cursor += box.height + CONTAINER_GAP
      }
      const height = visibleChildren.length > 0 ? cursor - CONTAINER_GAP + CONTAINER_PADDING : CONTAINER_PADDING * 2 + 20
      return { node, x, y, width: containerWidth, height, children }
    }

    case 'heading':
    case 'text': {
      const font = node.kind === 'heading' ? HEADING_FONT : TEXT_FONT
      const lineHeight = node.kind === 'heading' ? HEADING_LINE_HEIGHT : TEXT_LINE_HEIGHT
      const width = Math.min(containerWidth, measureTextWidth(node.content, font) + 2)
      return { node, x, y, width, height: lineHeight, children: [] }
    }

    case 'button': {
      const width = Math.min(containerWidth, measureTextWidth(node.label, BUTTON_FONT) + BUTTON_PAD_X * 2)
      return { node, x, y, width, height: BUTTON_HEIGHT, children: [] }
    }

    case 'divider':
      return { node, x, y, width: containerWidth, height: DIVIDER_HEIGHT, children: [] }

    case 'image':
      return { node, x, y, width: containerWidth, height: IMAGE_HEIGHT, children: [] }

    case 'placeholder':
      return { node, x, y, width: containerWidth, height: PLACEHOLDER_HEIGHT, children: [] }

    case 'grid': {
      // Schematic-rendering scope decision, same as the rest of this file:
      // an even column split rather than full CSS Grid track-sizing math.
      const visibleChildren = node.children.filter((c) => isVisible(c, breakpoint))
      const columnWidth = (containerWidth - node.columnGap * (node.columns - 1)) / node.columns
      const children: ResolvedBox[] = []
      let row = 0
      let col = 0
      for (const child of visibleChildren) {
        const placement = child.gridPlacement
        const columnStart = placement?.columnStart ? placement.columnStart - 1 : col
        const columnSpan = Math.min(placement?.columnSpan ?? 1, node.columns)
        const childX = x + columnStart * (columnWidth + node.columnGap)
        const childY = y + row * (GRID_ROW_HEIGHT + node.rowGap)
        const childWidth = columnWidth * columnSpan + node.columnGap * (columnSpan - 1)
        const box = resolveLayout(child, breakpoint, childWidth, childX, childY)
        box.height = GRID_ROW_HEIGHT
        children.push(box)
        col = columnStart + columnSpan
        if (col >= node.columns) {
          col = 0
          row += 1
        } else if (!placement) {
          // Only auto-advance the flow cursor for unplaced children —
          // explicitly-placed children don't perturb siblings' auto-flow.
        }
      }
      if (visibleChildren.length > 0 && col > 0) row += 1
      const height = Math.max(GRID_ROW_HEIGHT, row * (GRID_ROW_HEIGHT + node.rowGap) - node.rowGap)
      return { node, x, y, width: containerWidth, height, children }
    }

    case 'concept':
      return { node, x, y, width: containerWidth, height: CONCEPT_HEIGHT, children: [] }
  }
}
