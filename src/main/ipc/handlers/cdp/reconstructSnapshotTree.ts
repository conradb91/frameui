import type { Protocol } from 'devtools-protocol'
import type { CapturedElement } from '@shared/types/runtimeCapture'

type CaptureSnapshotResponse = Protocol.DOMSnapshot.CaptureSnapshotResponse
type RareStringData = Protocol.DOMSnapshot.RareStringData

/** Same redaction rules as `captureScript.ts`'s `textPreviewOf`/`ariaOf`, and
 * the same shape as `svgSerializer.ts`'s `safeContent` — a bare keyword
 * match (e.g. `password`, `api key`) fires on completely ordinary UI copy
 * like a "Forgot password?" link or a "Card number" field label, so these
 * only redact when the keyword is followed by an actual `key: value`/
 * `key=value` assignment shape, or when the content is a token/number
 * that looks like a secret by its own shape regardless of any label. */
const TEXT_SECRET_PATTERN =
  /(?:bearer\s+[a-z0-9._-]+|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|\b\d{13,19}\b)/i
const ATTRIBUTE_SECRET_PATTERN =
  /(?:bearer\s+[a-z0-9._-]+|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|\b\d{13,19}\b)/i
const MAX_TEXT_PREVIEW = 20000
const NON_VISUAL_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'link',
  'meta',
  'title',
])
const ATTRIBUTE_ALLOWLIST = new Set([
  'src',
  'alt',
  'placeholder',
  'type',
  'viewBox',
  'd',
  'fill',
  'stroke',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'x2',
  'y1',
  'y2',
  'stroke-width',
  'transform',
  'x',
  'y',
  'width',
  'height',
  'points',
  'data-frameui-source',
])
const SELECTOR_TAGS = new Set(['button', 'input', 'select', 'iframe', 'frame'])

type Rect = { x: number; y: number; width: number; height: number }

function rectFromArray(rect: number[] | undefined): Rect {
  const [x = 0, y = 0, width = 0, height = 0] = rect ?? []
  return { x, y, width, height }
}

function emptyRoot(): CapturedElement {
  return {
    tag: 'body',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    styles: {},
    children: [],
  }
}

/**
 * Rebuilds a `CapturedElement` tree from a `DOMSnapshot.captureSnapshot`
 * response — a flattened/columnar format, not a tree. Replaces the
 * `executeJavaScript(CAPTURE_SCRIPT)` DOM-walk as the producer feeding
 * `normalizeVisual()`; the output shape is unchanged so nothing downstream
 * of this function needs to know the difference.
 *
 * A DOM node with no entry in `layout.nodeIndex` (no `LayoutObject` —
 * `display:none`, or a non-rendering wrapper like `display:contents`)
 * never gets its own `CapturedElement`, but its subtree is still walked:
 * any descendant that DOES have a layout entry is attached to the nearest
 * ancestor that was actually captured. This is deliberate — a
 * `display:contents` wrapper must not cause its visible children to be
 * dropped (see `scripts/smoke-capture-registry.cjs`'s existing assertion
 * for this exact case), and `opacity:0` elements still have real geometry
 * and layout entries, so they're captured with `opacity` preserved, never
 * treated as a drop signal.
 */
export function reconstructSnapshotTree(
  snapshot: CaptureSnapshotResponse,
  requestedStyles: readonly string[],
  viewport: { width: number; height: number },
  coordinateScale = 1,
): CapturedElement {
  const doc = snapshot.documents[0]
  if (!doc) return emptyRoot()
  const strings = snapshot.strings
  const str = (index: number | undefined): string =>
    index === undefined || index < 0 || index >= strings.length
      ? ''
      : strings[index]

  const nodes = doc.nodes
  const nodeCount = nodes.nodeType?.length ?? 0
  if (!nodeCount) return emptyRoot()
  const parentIndex = nodes.parentIndex ?? []
  const nodeTypeArr = nodes.nodeType ?? []
  const nodeNameArr = nodes.nodeName ?? []
  const nodeValueArr = nodes.nodeValue ?? []
  const attributesArr = nodes.attributes ?? []

  const childrenOf: number[][] = Array.from({ length: nodeCount }, () => [])
  for (let i = 0; i < nodeCount; i++) {
    const p = parentIndex[i]
    if (p !== undefined && p >= 0 && p < nodeCount && p !== i)
      childrenOf[p].push(i)
  }

  const rareStringMap = (data?: RareStringData): Map<number, number> => {
    const map = new Map<number, number>()
    if (data) for (let k = 0; k < data.index.length; k++) map.set(data.index[k], data.value[k])
    return map
  }
  const shadowRootTypeOf = rareStringMap(nodes.shadowRootType)
  const pseudoTypeOf = rareStringMap(nodes.pseudoType)
  const currentSourceURLOf = rareStringMap(nodes.currentSourceURL)

  const tagOf = (i: number): string => str(nodeNameArr[i]).toLowerCase()

  const allAttributesOf = (i: number): Record<string, string> => {
    const raw = attributesArr[i]
    const result: Record<string, string> = {}
    if (!raw) return result
    for (let k = 0; k + 1 < raw.length; k += 2) result[str(raw[k])] = str(raw[k + 1])
    return result
  }

  const layout = doc.layout
  const layoutIndexOf = new Map<number, number>()
  for (let k = 0; k < layout.nodeIndex.length; k++) layoutIndexOf.set(layout.nodeIndex[k], k)

  const scrollOffsetX = doc.scrollOffsetX ?? 0
  const scrollOffsetY = doc.scrollOffsetY ?? 0

  const stylesAt = (layoutIdx: number): Record<string, string> => {
    const styles: Record<string, string> = {}
    const row = layout.styles[layoutIdx]
    if (!row) return styles
    for (let p = 0; p < requestedStyles.length; p++) styles[requestedStyles[p]] = str(row[p])
    return styles
  }
  // Document-relative CDP bounds minus the current scroll offset reproduce
  // `getBoundingClientRect()`'s viewport-relative semantics that the old
  // in-page walk relied on. Getting this subtraction wrong is the easiest
  // way to silently misplace every element, so it's centralized here.
  const documentRectToViewport = (rect: Rect): Rect => ({
    x: Math.round((rect.x - scrollOffsetX) / coordinateScale),
    y: Math.round((rect.y - scrollOffsetY) / coordinateScale),
    width: Math.round(rect.width / coordinateScale),
    height: Math.round(rect.height / coordinateScale),
  })
  const rectAt = (layoutIdx: number): Rect =>
    documentRectToViewport(rectFromArray(layout.bounds[layoutIdx]))

  const textBoxesByLayoutIndex = new Map<number, number[]>()
  const textBoxes = doc.textBoxes
  for (let k = 0; k < textBoxes.layoutIndex.length; k++) {
    const owner = textBoxes.layoutIndex[k]
    const list = textBoxesByLayoutIndex.get(owner)
    if (list) list.push(k)
    else textBoxesByLayoutIndex.set(owner, [k])
  }

  const redactText = (text: string): string =>
    TEXT_SECRET_PATTERN.test(text) ? '[redacted]' : text
  const redactAttribute = (value: string): string =>
    ATTRIBUTE_SECRET_PATTERN.test(value) ? '[redacted]' : value

  /** A DOM text node's rendered content, resolved from the owning layout
   * entry's `layout.text` (the actual post-layout rendered text) where
   * present, falling back to the raw `nodeValue` only when it isn't — these
   * can diverge for wrapped text, `text-transform`, and generated content,
   * so `layout.text` is treated as authoritative, not `nodeValue`. */
  function textLeavesFor(domIndex: number): CapturedElement[] {
    const layoutIdx = layoutIndexOf.get(domIndex)
    if (layoutIdx === undefined) return []
    const styles = stylesAt(layoutIdx)
    const layoutText = str(layout.text[layoutIdx])
    const source = layoutText !== '' ? layoutText : str(nodeValueArr[domIndex])
    if (!source.trim()) return []
    const boxes = textBoxesByLayoutIndex.get(layoutIdx)
    if (!boxes || !boxes.length)
      return [
        {
          tag: 'frameui-text',
          textPreview: redactText(source.replace(/\s+/g, ' ').trim()).slice(0, MAX_TEXT_PREVIEW),
          rect: rectAt(layoutIdx),
          styles,
          children: [],
        },
      ]
    // `textBoxes` gives one box per rendered *line* of this text node, not
    // one per node. A single wrapped paragraph/heading must stay one leaf —
    // union the line boxes into the node's overall bounds rather than
    // emitting a separate frameui-text per line, or wrapped text fractures
    // into one sibling element per line downstream.
    const lineRects = boxes.map((k) =>
      documentRectToViewport(rectFromArray(textBoxes.bounds[k])),
    )
    // A single rendered line must not wrap again due to subpixel font
    // metrics inside its tight Range box. Multiline text remains editable
    // as one wrapping run, preserving the existing paragraph behavior.
    if (lineRects.every((rect) => Math.abs(rect.y - lineRects[0].y) < 1)) styles.whiteSpace = 'pre'
    const x = Math.min(...lineRects.map((r) => r.x))
    const y = Math.min(...lineRects.map((r) => r.y))
    const right = Math.max(...lineRects.map((r) => r.x + r.width))
    const bottom = Math.max(...lineRects.map((r) => r.y + r.height))
    return [
      {
        tag: 'frameui-text',
        textPreview: redactText(source.replace(/\s+/g, ' ').trim()).slice(0, MAX_TEXT_PREVIEW),
        rect: { x, y, width: right - x, height: bottom - y },
        styles,
        children: [],
      } satisfies CapturedElement,
    ]
  }

  /** `::before`/`::after` surface as their own node with `pseudoType` set —
   * reconstructed as a `frameui-visual` leaf using the CDP-reported layout
   * box directly (no width/height heuristic needed, unlike the old script's
   * `getComputedStyle(el, pseudo)` fallback math). Generated text content is
   * read from any text-node child, since CDP has no direct `content` field
   * — an assumption to confirm against a real Chromium build. */
  function pseudoLeafFor(domIndex: number): CapturedElement[] {
    const pseudoType = str(pseudoTypeOf.get(domIndex))
    if (pseudoType !== 'before' && pseudoType !== 'after') return []
    const layoutIdx = layoutIndexOf.get(domIndex)
    if (layoutIdx === undefined) return []
    const content = childrenOf[domIndex]
      .filter((c) => nodeTypeArr[c] === 3)
      .map((c) => str(nodeValueArr[c]))
      .join('')
      .trim()
    return [
      {
        tag: 'frameui-visual',
        textPreview: content ? redactText(content) : undefined,
        rect: rectAt(layoutIdx),
        styles: stylesAt(layoutIdx),
        children: [],
      },
    ]
  }

  function hasDisabledFieldsetAncestor(domIndex: number): boolean {
    let cursor = parentIndex[domIndex]
    while (cursor !== undefined && cursor >= 0) {
      if (tagOf(cursor) === 'fieldset' && allAttributesOf(cursor).disabled !== undefined) return true
      cursor = parentIndex[cursor]
    }
    return false
  }

  function ariaOf(attrs: Record<string, string>, tag: string): Record<string, string> | undefined {
    const aria: Record<string, string> = {}
    if (attrs.role) aria.role = attrs.role
    for (const [name, value] of Object.entries(attrs))
      if (name.startsWith('aria-') && !/(?:value|token|secret)/i.test(name))
        aria[name] = redactAttribute(value)
    if (tag === 'img' && attrs.alt !== undefined) aria.alt = redactAttribute(attrs.alt)
    return Object.keys(aria).length > 0 ? aria : undefined
  }

  let htmlIndex: number | undefined
  for (let i = 0; i < nodeCount; i++)
    if (nodeTypeArr[i] === 1 && tagOf(i) === 'html') {
      htmlIndex = i
      break
    }
  if (htmlIndex === undefined) return emptyRoot()

  function captureSelectorFor(domIndex: number): string {
    const path: string[] = []
    let cursor = domIndex
    while (cursor !== htmlIndex && parentIndex[cursor] !== undefined) {
      const parent = parentIndex[cursor]
      // Pseudo-elements aren't part of the element tree for CSS selector
      // purposes and must not shift real siblings' :nth-child position.
      const siblings = childrenOf[parent].filter(
        (c) => nodeTypeArr[c] === 1 && !pseudoTypeOf.has(c),
      )
      const index = siblings.indexOf(cursor) + 1
      path.unshift(`${tagOf(cursor)}:nth-child(${index})`)
      cursor = parent
    }
    return `html>${path.join('>')}`
  }

  function needsCaptureSelector(tag: string, attrs: Record<string, string>): boolean {
    return (
      SELECTOR_TAGS.has(tag) ||
      attrs.role === 'button' ||
      attrs['data-component'] !== undefined ||
      attrs['data-frameui-component'] !== undefined
    )
  }

  function convert(domIndex: number): CapturedElement[] {
    const nodeType = nodeTypeArr[domIndex]
    if (nodeType === 3) return textLeavesFor(domIndex)
    if (nodeType !== 1) return []
    if (pseudoTypeOf.has(domIndex)) return pseudoLeafFor(domIndex)
    const tag = tagOf(domIndex)
    if (NON_VISUAL_TAGS.has(tag)) return []

    const childDescendants: CapturedElement[] = []
    for (const child of childrenOf[domIndex]) {
      if (shadowRootTypeOf.has(child)) {
        for (const shadowChild of childrenOf[child]) childDescendants.push(...convert(shadowChild))
      } else {
        childDescendants.push(...convert(child))
      }
    }

    const layoutIdx = layoutIndexOf.get(domIndex)
    // No layout entry: emit nothing for this node, but keep its already-
    // captured descendants — they attach to the nearest real ancestor.
    if (layoutIdx === undefined) return childDescendants

    const attrsAll = allAttributesOf(domIndex)
    const styles = stylesAt(layoutIdx)
    const rect = rectAt(layoutIdx)

    const attributes: Record<string, string> = {}
    for (const [name, value] of Object.entries(attrsAll))
      if (ATTRIBUTE_ALLOWLIST.has(name)) attributes[name] = value

    if (needsCaptureSelector(tag, attrsAll)) attributes.captureSelector = captureSelectorFor(domIndex)

    const baseURL = str(doc.baseURL) || str(doc.documentURL)
    if (tag === 'a' && attrsAll.href !== undefined) {
      try {
        attributes.href = new URL(attrsAll.href, baseURL).href
      } catch {
        attributes.href = attrsAll.href
      }
    }
    if (tag === 'img') {
      const currentSource = currentSourceURLOf.has(domIndex)
        ? str(currentSourceURLOf.get(domIndex))
        : undefined
      const rawSrc = currentSource || attrsAll.src
      if (rawSrc) {
        try {
          attributes.src = new URL(rawSrc, baseURL).href
        } catch {
          attributes.src = rawSrc
        }
      }
    }
    // Canvas pixel data isn't representable in a DOM/style snapshot — a
    // genuine CDP gap, not something the tree walk can recover. The caller
    // (`domSnapshot.ts`) splices in a screenshot-derived data URL afterward,
    // matched by `captureSelector`, the same way `captureVisualStates.ts`
    // re-selects elements.
    if (tag === 'canvas' && !attributes.captureSelector)
      attributes.captureSelector = captureSelectorFor(domIndex)

    const backgroundMatch = /url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/.exec(styles.backgroundImage || '')
    if (backgroundMatch) attributes.backgroundSrc = backgroundMatch[1] || backgroundMatch[2] || backgroundMatch[3].trim()
    if (attrsAll.disabled !== undefined || hasDisabledFieldsetAncestor(domIndex))
      attributes.visualState = 'Disabled'

    const componentHint =
      attrsAll['data-component'] || attrsAll['data-frameui-component'] || undefined

    return [
      {
        tag,
        classes: attrsAll.class || undefined,
        attributes,
        rect,
        styles,
        aria: ariaOf(attrsAll, tag),
        componentHint,
        children: childDescendants,
      },
    ]
  }

  let bodyIndex: number | undefined
  for (const child of childrenOf[htmlIndex])
    if (nodeTypeArr[child] === 1 && tagOf(child) === 'body') {
      bodyIndex = child
      break
    }
  if (bodyIndex === undefined) return emptyRoot()

  const [captured] = convert(bodyIndex)
  if (!captured) return emptyRoot()
  // Matches the old script's `Math.max(captured.rect.height, innerHeight)`
  // guard — the root box is never smaller than the viewport, even when the
  // page's own content is shorter.
  captured.rect.height = Math.max(captured.rect.height, Math.round(viewport.height))
  captured.rect.width = Math.max(captured.rect.width, Math.round(viewport.width))
  return captured
}
