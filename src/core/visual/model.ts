import type { VisualObject, VisualKind } from '../../shared/types/visualDesign'
export function object(
  kind: VisualKind,
  values: Partial<VisualObject> = {},
): VisualObject {
  return {
    id: crypto.randomUUID(),
    kind,
    name: kind,
    x: 0,
    y: 0,
    width: 160,
    height: 100,
    rotation: 0,
    fill: '#e8e9ed',
    stroke: 'none',
    strokeWidth: 0,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
    radius: [0, 0, 0, 0],
    hidden: false,
    locked: false,
    clip: false,
    fontFamily: 'Inter, sans-serif',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    letterSpacing: 0,
    textAlign: 'left',
    layout: {
      direction: 'none',
      alignment: 'start',
      distribution: 'start',
      gap: 0,
      padding: 0,
      wrap: false,
      constraints: 'left-top',
    },
    children: [],
    ...values,
  }
}
export function visit(objects: VisualObject[], fn: (o: VisualObject) => void) {
  for (const o of objects) {
    fn(o)
    visit(o.children, fn)
  }
}
export function cloneObject(o: VisualObject): VisualObject {
  const copy = structuredClone(o)
  visit([copy], (n) => {
    n.id = crypto.randomUUID()
  })
  return copy
}
export function removeObjects(
  objects: VisualObject[],
  ids: Set<string>,
): VisualObject[] {
  return objects
    .filter((o) => !ids.has(o.id))
    .map((o) => ({ ...o, children: removeObjects(o.children, ids) }))
}
export function routePattern(path: string) {
  return (
    path
      .split('?')[0]
      .replace(/\/$/, '')
      .replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,})(?=\/|$)/gi, '/:id') || '/'
  )
}
export function safeRoute(raw: string, origin: string): boolean {
  try {
    const u = new URL(raw, origin)
    return (
      u.origin === new URL(origin).origin &&
      !/(?:logout|log-out|signout|sign-out|delete|destroy|remove|submit|send|pay|purchase|approve|migrate|upload|execute|trigger|unsubscribe|revoke)(?:\/|$|[?=_-])/i.test(
        u.pathname + u.search,
      ) &&
      !u.search
    )
  } catch {
    return false
  }
}

export function applyVisualLayout(parent: VisualObject) {
  const { direction, padding, gap, alignment, distribution, wrap } =
    parent.layout
  if (direction === 'grid') {
    const columns = Math.max(
      1,
      Number(parent.layout.grid) ||
        parent.layout.grid?.split(/\s+/).filter(Boolean).length ||
        2,
    )
    const width = Math.max(
      1,
      (parent.width - padding * 2 - gap * (columns - 1)) / columns,
    )
    let y = padding
    for (let i = 0; i < parent.children.length; i += columns) {
      const row = parent.children.slice(i, i + columns)
      const height = Math.max(...row.map((c) => c.height))
      row.forEach((c, col) => {
        c.x = padding + col * (width + gap)
        c.y = y
        c.width = width
      })
      y += height + gap
    }
    return
  }
  if (!['row', 'column'].includes(direction)) return
  const horizontal = direction === 'row',
    axis = horizontal ? 'x' : 'y',
    cross = horizontal ? 'y' : 'x',
    size = horizontal ? 'width' : 'height',
    crossSize = horizontal ? 'height' : 'width'
  const children = parent.children.filter((c) => !c.hidden)
  const total = children.reduce((sum, c) => sum + c[size], 0)
  const available = parent[size] - padding * 2
  const actualGap =
    distribution === 'space-between' && children.length > 1
      ? Math.max(gap, (available - total) / (children.length - 1))
      : gap
  const occupied = total + actualGap * Math.max(0, children.length - 1)
  let cursor =
      padding +
      (distribution === 'center'
        ? Math.max(0, (available - occupied) / 2)
        : distribution === 'end'
          ? Math.max(0, available - occupied)
          : 0),
    line = padding,
    lineSize = 0
  for (const child of children) {
    if (
      wrap &&
      cursor > padding &&
      cursor + child[size] > parent[size] - padding
    ) {
      cursor = padding
      line += lineSize + gap
      lineSize = 0
    }
    child[axis] = cursor
    child[cross] = wrap
      ? line
      : alignment === 'center'
        ? (parent[crossSize] - child[crossSize]) / 2
        : alignment === 'end'
          ? parent[crossSize] - padding - child[crossSize]
          : padding
    if (alignment === 'stretch')
      child[crossSize] = Math.max(1, parent[crossSize] - padding * 2)
    cursor += child[size] + actualGap
    lineSize = Math.max(lineSize, child[crossSize])
  }
}

/** Apply structural edits at the actual sibling level, including imported groups. */
export function editSiblings(
  objects: VisualObject[],
  ids: Set<string>,
  edit: (siblings: VisualObject[]) => VisualObject[],
): VisualObject[] {
  const next = objects.map((o) =>
    ids.has(o.id) ? o : { ...o, children: editSiblings(o.children, ids, edit) },
  )
  return next.some((o) => ids.has(o.id)) ? edit(next) : next
}

export function resizeVisualObject(
  parent: VisualObject,
  width: number,
  height: number,
) {
  width = Math.max(
    parent.layout.minWidth ?? 1,
    Math.min(parent.layout.maxWidth ?? Infinity, width),
  )
  height = Math.max(1, height)
  const dx = width - parent.width,
    dy = height - parent.height
  for (const child of parent.children) {
    const constraint = child.layout.constraints
    if (constraint === 'right-top') child.x += dx
    if (constraint === 'center') {
      child.x += dx / 2
      child.y += dy / 2
    }
    if (constraint === 'stretch') {
      resizeVisualObject(child, child.width + dx, child.height + dy)
    }
    if (constraint === 'scale') {
      const sx = width / Math.max(1, parent.width),
        sy = height / Math.max(1, parent.height)
      child.x *= sx
      child.y *= sy
      resizeVisualObject(child, child.width * sx, child.height * sy)
    }
  }
  parent.width = width
  parent.height = height
  applyVisualLayout(parent)
}

/** Copy only edited branches so dragging one object does not redraw an entire screen. */
export function updateVisualSelection(
  objects: VisualObject[],
  ids: Set<string>,
  change: (object: VisualObject) => void,
  deep = false,
): VisualObject[] {
  let changed = false
  const result = objects.map((o) => {
    if (ids.has(o.id)) {
      changed = true
      const copy = deep ? structuredClone(o) : { ...o }
      change(copy)
      return copy
    }
    const children = updateVisualSelection(o.children, ids, change, deep)
    if (children !== o.children) {
      changed = true
      return { ...o, children }
    }
    return o
  })
  return changed ? result : objects
}
