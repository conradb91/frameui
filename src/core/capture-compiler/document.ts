import type { CapturedElement } from '@shared/types/runtimeCapture'
import type { StructuredDesignDocument, StructuredFrame } from '@shared/types/structuredDesign'
import { compileStructuredNodes } from './compile'

/**
 * Wraps `compileStructuredNodes`'s output into a single `StructuredFrame` —
 * one captured screen/route/viewport. See docs/CAPTURE_ENGINE_REBUILD_SPEC.md
 * §36 and this stage's plan for why `assets`/`fonts`/`tokens`/`sources`
 * stay empty at the document level (`makeStructuredDocument`, below).
 */
export function makeStructuredFrame(
  root: CapturedElement,
  /** `durationMs` is the caller's own end-to-end timer (CDP capture +
   * compile) — this function doesn't re-measure, since the CDP capture
   * itself happens before it's called. */
  ctx: { name: string; route: string; state?: string; width: number; height: number; durationMs: number },
): StructuredFrame {
  const children = compileStructuredNodes(root, { route: ctx.route })
  return {
    id: crypto.randomUUID(),
    name: ctx.name,
    viewport: `${ctx.width}x${ctx.height}`,
    sourceRoute: ctx.route,
    sourceState: ctx.state,
    width: ctx.width,
    height: Math.max(ctx.height, Math.ceil(root.rect.y + root.rect.height)),
    children,
    captureMetadata: {
      capturedAt: new Date().toISOString(),
      engine: 'domSnapshot',
      structuredNodeCount: countStructuredNodes(children),
      durationMs: ctx.durationMs,
    },
  }
}

function countStructuredNodes(nodes: StructuredFrame['children']): number {
  let count = 0
  for (const node of nodes) count += 1 + countStructuredNodes(node.children)
  return count
}

export function makeStructuredDocument(projectId: string, frames: StructuredFrame[]): StructuredDesignDocument {
  return {
    version: 1,
    projectId,
    designId: crypto.randomUUID(),
    frames,
    assets: [],
    fonts: [],
    tokens: [],
    sources: [],
  }
}
