import type { DesignNode, PrimitiveKind } from '@shared/types/designNode'

// `crypto.randomUUID()` is the global Web Crypto API, available both in the
// renderer (browser) and in Electron's main process (modern Node) — no
// platform-specific import needed, keeping design-model code portable.

export function createPrimitiveNode(kind: PrimitiveKind): DesignNode {
  const id = crypto.randomUUID()
  const editability = 'editable' as const

  switch (kind) {
    case 'stack':
      return { kind, id, editability, children: [], direction: 'column', gap: 12, align: 'stretch' }
    case 'text':
      return { kind, id, editability, children: [], content: 'Text' }
    case 'heading':
      return { kind, id, editability, children: [], content: 'Heading' }
    case 'button':
      return { kind, id, editability, children: [], label: 'Button', variant: 'primary' }
    case 'container':
      return { kind, id, editability, children: [] }
    case 'divider':
      return { kind, id, editability, children: [] }
    case 'image':
      return { kind, id, editability, children: [], alt: 'Image' }
  }
}
