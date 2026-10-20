import type { StructuredFrame, StructuredLayoutMode, StructuredNode } from '@shared/types/structuredDesign'
import type { TextStyleRun } from '@shared/types/richText'

/**
 * Stage 6 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
 * mutation helpers for an existing `StructuredNode` tree — no equivalent to
 * `@core/visual/model.ts`'s `visit()`/`object()`/`cloneObject()` existed for
 * this schema before this stage, since Stages 2-5 only ever built new trees
 * (via `compile.ts`), never edited one in place. All functions here are
 * immutable — they return a new `StructuredFrame`/array, never mutate the
 * input — matching the `structuredClone`-then-mutate convention used at the
 * `edit()` call site in `DesignIde.tsx`.
 */

export function visitStructuredNodes(nodes: StructuredNode[], fn: (node: StructuredNode) => void): void {
  for (const node of nodes) {
    fn(node)
    visitStructuredNodes(node.children, fn)
  }
}

export function findStructuredNode(nodes: StructuredNode[], id: string): StructuredNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findStructuredNode(node.children, id)
    if (found) return found
  }
  return undefined
}


function mapShared(nodes: StructuredNode[], map: (node: StructuredNode) => StructuredNode): StructuredNode[] {
  const next = nodes.map(map)
  return next.some((node, index) => node !== nodes[index]) ? next : nodes
}

/** Updates a selected layer without copying unrelated capture subtrees. */
export function patchStructuredNode(frame: StructuredFrame, id: string, patch: Partial<Omit<StructuredNode, 'id' | 'children' | 'parentId'>>): StructuredFrame {
  function update(nodes: StructuredNode[]): StructuredNode[] {
    return mapShared(nodes,node=>{
      if(node.id===id) return {...node,...patch}
      const children=update(node.children)
      return children===node.children?node:{...node,children}
    })
  }
  const children=update(frame.children)
  return children===frame.children?frame:{...frame,children}
}

/** Applies one or more bounds patches in a single immutable pass — a
 * multi-select drag/resize commit updates every selected node's new
 * position/size together, not one `StructuredFrame` rebuild per node. */
export function updateStructuredNodeBounds(
  frame: StructuredFrame,
  updates: { id: string; bounds: Partial<StructuredNode['bounds']> }[],
): StructuredFrame {
  if (!updates.length) return frame
  const byId = new Map(updates.map((u) => [u.id, u.bounds]))
  function patch(nodes: StructuredNode[]): StructuredNode[] {
    return mapShared(nodes, (node) => {
      const requested = byId.get(node.id)
      const boundsPatch = requested && Object.entries(requested).some(([key, value]) => node.bounds[key as keyof typeof node.bounds] !== value) ? requested : undefined
      const children = patch(node.children)
      if (!boundsPatch && children === node.children) return node
      return {
        ...node,
        bounds: boundsPatch ? { ...node.bounds, ...boundsPatch } : node.bounds,
        typography: node.typography&&boundsPatch&&(boundsPatch.width!==undefined||boundsPatch.height!==undefined)?{...node.typography,captureLines:undefined}:node.typography,
        children,
      }
    })
  }
  const children = patch(frame.children)
  return children === frame.children ? frame : { ...frame, children }
}

/** Stage 9 sub-slice 3 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §23) — converts
 * the given nodes into `RasterFallback` images in a single immutable pass,
 * mirroring `updateStructuredNodeBounds`'s multi-patch shape: a `diffMask`-
 * driven correction pass may rasterize several subtrees from one capture at
 * once, not one `StructuredFrame` rebuild per node. Each patched node keeps
 * its `bounds`/`name`/everything else — only `type`, `source.imageSrc`, and
 * `children` (cleared, since a raster image has no editable subtree) change. */
export function applyRasterFallbacks(
  frame: StructuredFrame,
  patches: { id: string; imageSrc: string }[],
): StructuredFrame {
  if (!patches.length) return frame
  const byId = new Map(patches.map((p) => [p.id, p.imageSrc]))
  function patch(nodes: StructuredNode[]): StructuredNode[] {
    return mapShared(nodes, (node) => {
      const imageSrc = byId.get(node.id)
      if (imageSrc) return { ...node, type: 'RasterFallback', source: { ...node.source, imageSrc }, children: [] }
      // `.map()` always allocates a new array even when every element comes
      // back unchanged (true even for an empty `children: []`) — compare
      // element-by-element so an untouched subtree keeps its original
      // object identity (same fix `resolveComponents.ts` needed).
      const patchedChildren = patch(node.children)
      const changed = patchedChildren.some((c, i) => c !== node.children[i])
      return changed ? { ...node, children: patchedChildren } : node
    })
  }
  const children = patch(frame.children)
  return children === frame.children ? frame : { ...frame, children }
}

/** For Delete/Backspace — removes the given nodes (and, implicitly, their
 * subtrees) from wherever they occur in the tree. */
export function removeStructuredNodes(frame: StructuredFrame, ids: string[]): StructuredFrame {
  if (!ids.length) return frame
  const idSet = new Set(ids)
  function filter(nodes: StructuredNode[]): StructuredNode[] {
    const kept: StructuredNode[] = []
    for (const node of nodes) {
      if (idSet.has(node.id)) continue
      const children = filter(node.children)
      kept.push(children === node.children ? node : { ...node, children })
    }
    return kept.length === nodes.length && kept.every((node, index) => node === nodes[index]) ? nodes : kept
  }
  const children = filter(frame.children)
  return children === frame.children ? frame : { ...frame, children }
}

/** Inline text-edit commit (grouping-follow-up + Stage 7 of the
 * capture-engine rebuild) — a no-op (returns `frame` unchanged) if the
 * target node has no `typography` at all, i.e. isn't actually a Text node. */
export function updateStructuredNodeText(frame: StructuredFrame, id: string, text: string, textRuns?: TextStyleRun[]): StructuredFrame {
  const node = findStructuredNode(frame.children, id)
  if (node?.source.control) {
    if(node.locked)return frame
    const control=node.source.control
    if(control.type==='select'){const options=control.options?.map(option=>option.value===control.value?{...option,label:text}:option);if(JSON.stringify(options)===JSON.stringify(control.options))return frame;return patchStructuredNode(frame,id,{source:{...node.source,control:{...control,options}}})}
    const field=control.placeholder!==undefined?'placeholder':'value'
    if(control[field]===text)return frame
    return patchStructuredNode(frame,id,{source:{...node.source,control:{...control,[field]:text}}})
  }
  if (!node?.typography || (node.typography.text === text && node.typography.textRuns === textRuns)) return frame
  function patch(nodes: StructuredNode[]): StructuredNode[] {
    return mapShared(nodes, (n) => {
      if (n.id === id) return { ...n, typography: { ...n.typography!, text, textRuns, captureLines:undefined } }
      const children = patch(n.children)
      return children === n.children ? n : { ...n, children }
    })
  }
  const children = patch(frame.children)
  return children === frame.children ? frame : { ...frame, children }
}

/**
 * Wraps `ids` (≥2) into a new free-positioned `Group` node, rebasing each
 * member's bounds to be relative to the group instead of their shared
 * parent — mirrors legacy `group()`'s bounding-box/offset math
 * (`DesignIde.tsx`'s `group()`, via `@core/visual/model.ts`'s
 * `editSiblings`) but reimplemented independently for `StructuredNode`, not
 * shared code, per this rebuild's "legacy and V2 stay independent" rule.
 *
 * Deliberately a no-op (`undefined`) unless every id in `ids` is found
 * together as siblings under one `'free'`-mode parent — the same
 * constraint Stage 6 already applies to drag/resize. A node inside a
 * `'stack'`/`'grid'` parent can't be pulled into a new freely-positioned
 * group without a real layout change, which isn't attempted here.
 */
export function groupStructuredNodes(frame: StructuredFrame, ids: string[]): { frame: StructuredFrame; groupId: string } | undefined {
  if (ids.length < 2) return undefined
  const idSet = new Set(ids)
  let groupId: string | undefined
  function transform(nodes: StructuredNode[], parentId: string | null, parentMode: StructuredLayoutMode): StructuredNode[] {
    const members = nodes.filter((n) => idSet.has(n.id))
    if (members.length === ids.length && parentMode === 'free') {
      const x = Math.min(...members.map((n) => n.bounds.x))
      const y = Math.min(...members.map((n) => n.bounds.y))
      const width = Math.max(...members.map((n) => n.bounds.x + n.bounds.width)) - x
      const height = Math.max(...members.map((n) => n.bounds.y + n.bounds.height)) - y
      const id = crypto.randomUUID()
      groupId = id
      const group: StructuredNode = {
        id,
        type: 'Group',
        name: 'Group',
        parentId,
        bounds: { x, y, width, height },
        layout: { mode: 'free' },
        appearance: { radius: [0, 0, 0, 0], opacity: 1, rotation: 0, clip: false },
        source: { tag: 'div' },
        constraints: { position: 'static' },
        visibility: true,
        locked: false,
        children: members.map((n) => ({ ...n, parentId: id, bounds: { ...n.bounds, x: n.bounds.x - x, y: n.bounds.y - y } })),
      }
      const index = nodes.findIndex((n) => idSet.has(n.id))
      const remaining = nodes.filter((n) => !idSet.has(n.id))
      remaining.splice(index, 0, group)
      return remaining
    }
    return nodes.map((n) => (idSet.has(n.id) ? n : { ...n, children: transform(n.children, n.id, n.layout.mode) }))
  }
  // The frame root is treated as an implicit free container, the same
  // convention `StructuredFrameView.tsx` already uses for top-level children.
  const children = transform(frame.children, null, 'free')
  return groupId ? { frame: { ...frame, children }, groupId } : undefined
}

/**
 * Reverses `groupStructuredNodes` — flattens each given group's children
 * back into its parent, restoring their absolute-relative coordinates by
 * adding the group's own bounds back on. A compiler-produced `'Group'`
 * (the DOM-collapse leaf artifact `compile.ts` assigns — always childless)
 * is distinguished from a manually-created one (always ≥2 children) by
 * that alone, no separate flag needed — ungrouping the former is a no-op.
 */
export function ungroupStructuredNodes(frame: StructuredFrame, groupIds: string[]): StructuredFrame {
  const idSet = new Set(groupIds)
  function transform(nodes: StructuredNode[]): StructuredNode[] {
    return nodes.flatMap((n) => {
      if (idSet.has(n.id) && n.children.length > 0)
        return n.children.map((c) => ({
          ...c,
          parentId: n.parentId,
          bounds: { ...c.bounds, x: c.bounds.x + n.bounds.x, y: c.bounds.y + n.bounds.y },
          children: transform(c.children),
        }))
      return [{ ...n, children: transform(n.children) }]
    })
  }
  return { ...frame, children: transform(frame.children) }
}

/** Intentional auto-layout edits reflow stored boxes; capture itself never reflows. */
export function layoutStructured(node:StructuredNode){
 if(node.layout.mode!=='stack')return
 const horizontal=node.layout.direction==='horizontal',padding=node.layout.padding??{top:0,left:0,right:0,bottom:0}
 let cursor=horizontal?padding.left:padding.top
 for(const child of node.children){child.bounds.x=horizontal?cursor:padding.left;child.bounds.y=horizontal?padding.top:cursor;cursor+=(horizontal?child.bounds.width:child.bounds.height)+(node.layout.gap??0)}
}
