import type { DesignNode, Breakpoint } from '@shared/types/designNode'

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

  switch (node.kind) {
    case 'stack':
      return (
        <div
          className="flex min-h-[8px]"
          style={{ flexDirection: node.direction === 'row' ? 'row' : 'column', gap: node.gap, alignItems: alignToCss(node.align) }}
        >
          {node.children.map((child) => (
            <PreviewRenderNode key={child.id} node={child} breakpoint={breakpoint} />
          ))}
        </div>
      )

    case 'container':
      return (
        <div className="rounded-lg border border-border p-4">
          <div className="flex flex-col gap-3">
            {node.children.map((child) => (
              <PreviewRenderNode key={child.id} node={child} breakpoint={breakpoint} />
            ))}
          </div>
        </div>
      )

    case 'text':
      return <div className="text-[14px] text-text-2">{node.content}</div>

    case 'heading':
      return <div className="text-[22px] font-bold text-white">{node.content}</div>

    case 'button':
      return (
        <button
          type="button"
          className={`w-fit rounded-lg px-4 py-2.5 text-[13px] font-semibold ${
            node.variant === 'primary' ? 'bg-gradient-to-b from-[#8676F4] to-[#7461EE] text-white' : 'border border-border bg-panel-2 text-text'
          }`}
        >
          {node.label}
        </button>
      )

    case 'divider':
      return <div className="h-px w-full bg-border" />

    case 'image':
      return (
        <div className="flex h-32 items-center justify-center rounded-lg bg-panel-2 text-[11.5px] text-text-3">{node.alt || 'Image'}</div>
      )

    case 'placeholder':
      return <div className="rounded-lg bg-panel-2 px-3 py-2.5 text-[12px] text-text-3">{node.label}</div>
  }
}

function alignToCss(align: 'start' | 'center' | 'end' | 'stretch'): string {
  if (align === 'start') return 'flex-start'
  if (align === 'end') return 'flex-end'
  return align
}
