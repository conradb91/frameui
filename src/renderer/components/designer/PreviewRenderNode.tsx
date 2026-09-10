import type { CSSProperties } from 'react'
import type { DesignNode, Breakpoint, NodeStyle } from '@shared/types/designNode'

/**
 * A deliberately separate, non-interactive renderer for Preview mode — no
 * store coupling, no selection/click handling, and hidden nodes are truly
 * OMITTED (not just dimmed, as the designer canvas shows them) so the
 * result resembles what the flow would actually look like (PRV-01).
 * Existing-page placeholders stay visually honest here too: Preview can't
 * show what it never executed, so it shows the same labeled block, just
 * without the editor's lock-icon chrome.
 */
export function PreviewRenderNode({ node, breakpoint }: { node: DesignNode; breakpoint: Breakpoint }) {
  const isHidden = node.hidden || (breakpoint !== 'desktop' && node.responsiveHidden?.[breakpoint])
  if (isHidden) return null
  const style = styleToCss(effectiveStyle(node, breakpoint), node.kind)

  switch (node.kind) {
    case 'stack':
      return (
        <div
          className="flex min-h-[8px]"
          style={{ ...style, flexDirection: effective(node, breakpoint, 'direction') ?? node.direction, gap: effective(node, breakpoint, 'gap') ?? node.gap, alignItems: alignToCss(effective(node, breakpoint, 'align') ?? node.align), justifyContent: justifyToCss(effective(node, breakpoint, 'justify') ?? node.justify), flexWrap: (effective(node, breakpoint, 'wrap') ?? node.wrap) ? 'wrap' : 'nowrap' }}
        >
          {node.children.map((child) => (
            <PreviewRenderNode key={child.id} node={child} breakpoint={breakpoint} />
          ))}
        </div>
      )

    case 'container':
      return (
        <div className="rounded-lg border border-border p-4" style={style}>
          <div className="flex flex-col gap-3">
            {node.children.map((child) => (
              <PreviewRenderNode key={child.id} node={child} breakpoint={breakpoint} />
            ))}
          </div>
        </div>
      )

    case 'text':
      return <div className="text-[14px] text-text-2" style={style}>{node.content}</div>

    case 'heading':
      return <div className="text-[22px] font-bold text-text" style={style}>{node.content}</div>

    case 'button':
      return (
        <button
          type="button"
          style={style}
          className={`w-fit rounded-lg px-4 py-2.5 text-[13px] font-semibold ${
            node.variant === 'primary' ? 'bg-accent   text-on-accent' : 'border border-border bg-panel-2 text-text'
          }`}
        >
          {node.label}
        </button>
      )

    case 'divider':
      return <div className="h-px w-full bg-border" style={style} />

    case 'image':
      return (
        <div className="flex h-32 items-center justify-center rounded-lg bg-panel-2 text-[11.5px] text-text-3" style={style}>{node.alt || 'Image'}</div>
      )

    case 'placeholder':
      return (
        <div className="rounded-lg bg-panel-2 px-3 py-2.5 text-[12px] text-text-3" style={style}>
          <div>{node.textPreview ? `${node.label}: ${node.textPreview}` : node.label}</div>
          {node.children.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {node.children.map((child) => (
                <PreviewRenderNode key={child.id} node={child} breakpoint={breakpoint} />
              ))}
            </div>
          )}
        </div>
      )

    case 'grid':
      return (
        <div className="grid min-h-[8px]" style={{ ...style, gridTemplateColumns: `repeat(${effective(node, breakpoint, 'columns') ?? node.columns}, minmax(0, 1fr))`, columnGap: effective(node, breakpoint, 'columnGap') ?? node.columnGap, rowGap: effective(node, breakpoint, 'rowGap') ?? node.rowGap }}>
          {node.children.map((child) => <div key={child.id} style={{ gridColumn: child.gridPlacement?.columnStart ? `${child.gridPlacement.columnStart} / span ${child.gridPlacement.columnSpan ?? 1}` : undefined, gridRow: child.gridPlacement?.rowStart ? `${child.gridPlacement.rowStart} / span ${child.gridPlacement.rowSpan ?? 1}` : undefined }}><PreviewRenderNode node={child} breakpoint={breakpoint} /></div>)}
        </div>
      )

    case 'concept':
      return <div className="rounded-lg border border-dashed border-accent-2/40 bg-selected px-3 py-2.5 text-[12px] text-accent-2" style={style}>Concept component</div>
  }
}

function alignToCss(align: 'start' | 'center' | 'end' | 'stretch'): string {
  if (align === 'start') return 'flex-start'
  if (align === 'end') return 'flex-end'
  return align
}

function justifyToCss(value: 'start' | 'center' | 'end' | 'space-between' | undefined): CSSProperties['justifyContent'] {
  if (value === 'start') return 'flex-start'
  if (value === 'end') return 'flex-end'
  return value
}

function effective<T extends 'gap' | 'direction' | 'align' | 'justify' | 'wrap' | 'columns' | 'columnGap' | 'rowGap'>(node: DesignNode, breakpoint: Breakpoint, key: T) {
  return breakpoint === 'desktop' ? undefined : node.responsiveOverrides?.[breakpoint]?.[key]
}

function effectiveStyle(node: DesignNode, breakpoint: Breakpoint): NodeStyle | undefined {
  const override = breakpoint === 'desktop' ? undefined : node.responsiveOverrides?.[breakpoint]?.style
  return override ? { ...node.style, ...override } : node.style
}

function styleToCss(value: NodeStyle | undefined, kind: DesignNode['kind']): CSSProperties {
  if (!value) return {}
  const style: CSSProperties = { position: value.position, left: value.left, top: value.top }
  if (value.width !== undefined) style.width = value.width === 'fill' ? '100%' : value.width === 'auto' ? undefined : value.width
  if (value.height !== undefined) style.height = value.height === 'fill' ? '100%' : value.height === 'auto' ? undefined : value.height
  if (value.minWidth !== undefined) style.minWidth = value.minWidth
  if (value.maxWidth !== undefined) style.maxWidth = value.maxWidth
  if (value.padding !== undefined) style.padding = value.padding
  if (value.paddingTop !== undefined) style.paddingTop = value.paddingTop
  if (value.paddingRight !== undefined) style.paddingRight = value.paddingRight
  if (value.paddingBottom !== undefined) style.paddingBottom = value.paddingBottom
  if (value.paddingLeft !== undefined) style.paddingLeft = value.paddingLeft
  if (value.backgroundColor) style.backgroundColor = value.backgroundColor
  if (value.borderColor !== undefined || value.borderWidth !== undefined) { style.borderStyle = 'solid'; style.borderColor = value.borderColor ?? 'currentColor'; style.borderWidth = value.borderWidth ?? 1 }
  if (value.borderRadius !== undefined) style.borderRadius = value.borderRadius
  if (value.boxShadow) style.boxShadow = value.boxShadow
  if (value.opacity !== undefined) style.opacity = value.opacity
  if (kind === 'text' || kind === 'heading' || kind === 'button') {
    if (value.fontFamily) style.fontFamily = value.fontFamily
    if (value.fontSize !== undefined) style.fontSize = value.fontSize
    if (value.fontWeight !== undefined) style.fontWeight = value.fontWeight
    if (value.lineHeight !== undefined) style.lineHeight = value.lineHeight
    if (value.letterSpacing !== undefined) style.letterSpacing = value.letterSpacing
    if (value.color) style.color = value.color
    if (value.textAlign) style.textAlign = value.textAlign
  }
  return style
}
