import type { Component } from '@shared/types/model/projectModel'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'

/**
 * Stage 8 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md
 * §30-31), sub-slice 3 — resolves each node's already-captured
 * `source.component` hint (populated at compile time by `compile.ts`'s
 * `sourceOf()`, from `componentHint`) against the project's already-built
 * component index, filling in `componentBinding` and promoting the node's
 * `type` to `'ComponentInstance'` on a match, per spec §30.
 *
 * Reuses the exact matching algorithm `designIde.handlers.ts`'s legacy
 * post-normalize pass already uses for `VisualObject` (`c.name.replace(
 * /([a-z])([A-Z])/g, '$1 $2') === hint`) — the only component-matching
 * algorithm this codebase has ever had, and inherently the safest kind
 * (exact match only) for spec §30's "never incorrectly promote generic DOM
 * into a component instance" requirement. No fuzzy/partial-confidence
 * tiers — every match is confidence `1`; anything else stays untouched.
 * `variant` is deliberately left unset: `Component` carries no props/variant
 * data anywhere in this codebase's project model to derive one from.
 */
export function resolveStructuredComponents(frame: StructuredFrame, components: Component[]): StructuredFrame {
  if (!components.length) return frame
  const byCleanedName = new Map<string, Component>()
  for (const component of components) {
    const key = component.name.replace(/([a-z])([A-Z])/g, '$1 $2')
    if (!byCleanedName.has(key)) byCleanedName.set(key, component)
  }
  if (!byCleanedName.size) return frame

  function resolveNode(node: StructuredNode): StructuredNode {
    // `.map()` always allocates a new array even when every element comes
    // back unchanged (true even for an empty `children: []`) — compare
    // element-by-element so an untouched subtree keeps its original object
    // identity, matching this frame's own top-level early-return guard.
    const resolvedChildren = node.children.map(resolveNode)
    const childrenChanged = resolvedChildren.some((c, i) => c !== node.children[i])
    const children = childrenChanged ? resolvedChildren : node.children
    const match = node.source.component ? byCleanedName.get(node.source.component) : undefined
    if (!match) {
      if (children === node.children) return node
      return { ...node, children }
    }
    return {
      ...node,
      children,
      type: 'ComponentInstance',
      source:{...node.source,file:match.source.filePath},
      componentBinding: { componentId: match.id, confidence: 1 },
      captureConfidence: { ...node.captureConfidence, componentConfidence: 1 },
    }
  }

  return { ...frame, children: frame.children.map(resolveNode) }
}
