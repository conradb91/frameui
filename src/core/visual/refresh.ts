import type { VisualObject, VisualPage } from '../../shared/types/visualDesign'
export interface DesignConflict {
  id: string
  objectId: string
  name: string
  property: string
  local: unknown
  incoming: unknown
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** Preserve designer properties independently of unrelated changes in the product. */
export function mergeCapturedPage(
  local: VisualPage,
  incoming: VisualPage,
): VisualPage {
  if (!local.edited)
    return {
      ...incoming,
      id: local.id,
      pinned: local.pinned,
      folder: local.folder,
      importedObjects: structuredClone(incoming.objects),
    }
  if (!local.importedObjects)
    return {
      ...local,
      conflicts: [
        ...(local.conflicts ?? []),
        {
          id: crypto.randomUUID(),
          objectId: local.id,
          name: local.name,
          property: 'page',
          local: local.objects,
          incoming: incoming.objects,
        },
      ],
      captureStatus: 'Conflict',
    }
  const conflicts: DesignConflict[] = []
  function mergeValue(
    base: unknown,
    localValue: unknown,
    remoteValue: unknown,
    node: VisualObject,
    property: string,
  ): unknown {
    if (same(localValue, base) || same(localValue, remoteValue))
      return structuredClone(remoteValue)
    if (same(remoteValue, base)) return structuredClone(localValue)
    if (
      base &&
      localValue &&
      remoteValue &&
      typeof base === 'object' &&
      typeof localValue === 'object' &&
      typeof remoteValue === 'object' &&
      !Array.isArray(base) &&
      !Array.isArray(localValue) &&
      !Array.isArray(remoteValue)
    ) {
      const result: Record<string, unknown> = {}
      for (const key of new Set([
        ...Object.keys(base),
        ...Object.keys(localValue),
        ...Object.keys(remoteValue),
      ]))
        result[key] = mergeValue(
          (base as Record<string, unknown>)[key],
          (localValue as Record<string, unknown>)[key],
          (remoteValue as Record<string, unknown>)[key],
          node,
          `${property}.${key}`,
        )
      return result
    }
    conflicts.push({
      id: crypto.randomUUID(),
      objectId: node.id,
      name: node.name,
      property,
      local: structuredClone(localValue),
      incoming: structuredClone(remoteValue),
    })
    return structuredClone(localValue)
  }
  function mergeNodes(
    base: VisualObject[],
    ours: VisualObject[],
    theirs: VisualObject[],
  ): VisualObject[] {
    const used = new Set<string>(),
      result: VisualObject[] = []
    for (let i = 0; i < base.length; i++) {
      const b = base[i],
        l = ours.find((o) => o.id === b.id)
      const r =
        theirs.find(
          (o) =>
            !used.has(o.id) &&
            b.source?.selector &&
            o.source?.selector === b.source.selector,
        ) ??
        theirs.find(
          (o) => !used.has(o.id) && o.kind === b.kind && o.name === b.name,
        ) ??
        (theirs[i] && !used.has(theirs[i].id) && theirs[i].kind === b.kind
          ? theirs[i]
          : undefined)
      if (r) used.add(r.id)
      if (!l) continue
      if (!r) {
        if (!same(l, b)) {
          result.push(structuredClone(l))
          conflicts.push({
            id: crypto.randomUUID(),
            objectId: l.id,
            name: l.name,
            property: 'removed',
            local: l,
            incoming: null,
          })
        }
        continue
      }
      const merged = { ...l, source: r.source } as VisualObject
      for (const key of new Set([
        ...Object.keys(b),
        ...Object.keys(l),
        ...Object.keys(r),
      ])) {
        if (
          ['id', 'children', 'source', 'componentId', 'overrides'].includes(key)
        )
          continue
        Object.assign(merged, {
          [key]: mergeValue(
            b[key as keyof VisualObject],
            l[key as keyof VisualObject],
            r[key as keyof VisualObject],
            l,
            key,
          ),
        })
      }
      merged.children = mergeNodes(b.children, l.children, r.children)
      result.push(merged)
    }
    result.push(
      ...ours
        .filter((o) => !base.some((b) => b.id === o.id))
        .map((o) => structuredClone(o)),
    )
    result.push(
      ...theirs.filter((o) => !used.has(o.id)).map((o) => structuredClone(o)),
    )
    return result
  }
  const objects = mergeNodes(
    local.importedObjects,
    local.objects,
    incoming.objects,
  )
  // Remap the incoming baseline to merged identities so the next refresh uses the same anchors.
  const reidentify = (
    source: VisualObject[],
    merged: VisualObject[],
  ): VisualObject[] =>
    source.map((o, i) => {
      const target =
        merged.find(
          (n) => o.source?.selector && n.source?.selector === o.source.selector,
        ) ??
        merged.find((n) => n.name === o.name && n.kind === o.kind) ??
        merged[i]
      return {
        ...structuredClone(o),
        id: target?.id ?? o.id,
        children: reidentify(o.children, target?.children ?? []),
      }
    })
  return {
    ...local,
    objects,
    sourceHash: incoming.sourceHash,
    capturedAt: incoming.capturedAt,
    fonts: incoming.fonts,
    importedObjects: reidentify(incoming.objects, objects),
    conflicts,
    captureStatus: conflicts.length ? 'Conflict' : 'Modified',
  }
}
