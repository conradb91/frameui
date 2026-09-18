import type { Token, TokenCategory } from '@shared/types/model/projectModel'
import type { StructuredFrame, StructuredNode, TokenBindableProperty } from '@shared/types/structuredDesign'

/**
 * Stage 8 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md
 * §10-11), sub-slice 1 — resolves each node's already-captured browser
 * value (`tokenBindings[x].value`, populated since Stage 2) against the
 * project's already-scanned repository token index, filling in
 * `tokenBindings[x].token` where a real match is found. The browser value
 * itself is never overwritten — per spec §11, the live rendered result
 * always wins; the repository only supplies a name for it.
 *
 * Deliberately reuses the existing, already-mature `Token[]` index this
 * codebase builds from a real Tailwind/CSS scan (`resolveStyleTokens.ts`,
 * cached on `ProjectIndex.projectModel.tokens`) instead of standing up a
 * second, parallel CSS-parsing pipeline — see this stage's plan for why.
 */

const CATEGORY_FOR_PROPERTY: Record<TokenBindableProperty, TokenCategory> = {
  backgroundColor: 'color',
  color: 'color',
  borderColor: 'color',
  padding: 'spacing',
  margin: 'spacing',
  gap: 'spacing',
  borderRadius: 'radius',
  fontSize: 'typography',
  fontFamily: 'typography',
  fontWeight: 'typography',
  lineHeight: 'typography',
  letterSpacing: 'typography',
  boxShadow: 'effect',
}

/** Same "visually close" tolerance this codebase already uses for
 * near-duplicate-colour detection (`analyseDesignSystem.ts`'s
 * `colourVector()`/Euclidean-RGB-distance ≤18 check) — not reused
 * directly, since that helper only parses 6-digit hex and a browser
 * computed value is always `rgb()`/`rgba()`, never hex. */
const COLOR_DISTANCE_THRESHOLD = 18

function parseColor(value: string): [number, number, number] | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value.trim())
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return undefined
}

function matchToken(property: TokenBindableProperty, value: string, tokensByCategory: Map<TokenCategory, Token[]>): Token | undefined {
  const category = CATEGORY_FOR_PROPERTY[property]
  const candidates = tokensByCategory.get(category)
  if (!candidates?.length) return undefined
  const trimmed = value.trim()
  const exact = candidates.find((t) => t.value.trim() === trimmed)
  if (exact) return exact
  if (category !== 'color') return undefined
  const target = parseColor(trimmed)
  if (!target) return undefined
  let best: { token: Token; distance: number } | undefined
  for (const token of candidates) {
    const candidate = parseColor(token.value)
    if (!candidate) continue
    const distance = Math.hypot(target[0] - candidate[0], target[1] - candidate[1], target[2] - candidate[2])
    if (distance <= COLOR_DISTANCE_THRESHOLD && (!best || distance < best.distance)) best = { token, distance }
  }
  return best?.token
}

export function resolveStructuredTokens(frame: StructuredFrame, tokens: Token[]): StructuredFrame {
  if (!tokens.length) return frame
  const tokensByCategory = new Map<TokenCategory, Token[]>()
  for (const token of tokens) {
    if (token.confidence !== 'full') continue
    const bucket = tokensByCategory.get(token.category)
    if (bucket) bucket.push(token)
    else tokensByCategory.set(token.category, [token])
  }
  if (!tokensByCategory.size) return frame

  function resolveNode(node: StructuredNode): StructuredNode {
    const children = node.children.map(resolveNode)
    let tokenBindings = node.tokenBindings
    if (tokenBindings) {
      let changed = false
      const next: typeof tokenBindings = { ...tokenBindings }
      for (const [property, binding] of Object.entries(tokenBindings) as [TokenBindableProperty, { value: string; token?: string }][]) {
        if (!binding || binding.token) continue
        const match = matchToken(property, binding.value, tokensByCategory)
        if (match) {
          next[property] = { ...binding, token: match.name }
          changed = true
        }
      }
      if (changed) tokenBindings = next
    }
    if (children === node.children && tokenBindings === node.tokenBindings) return node
    return { ...node, children, tokenBindings }
  }

  return { ...frame, children: frame.children.map(resolveNode) }
}
