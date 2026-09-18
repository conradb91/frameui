function normalizeRoutePath(raw: string) {
  const normalized = raw.replace(/\/+$/, '') || '/'
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function routeHashPath(url: URL): string | null {
  const raw = url.hash.startsWith('#!/')
    ? url.hash.slice(2)
    : url.hash.startsWith('#/')
      ? url.hash.slice(1)
      : ''
  return raw ? normalizeRoutePath(raw.split('?')[0]) : null
}

/** A concrete application route, including hash-router paths but not anchors. */
export function runtimeRoutePath(raw: string, base?: string): string {
  const url = new URL(raw, base)
  return routeHashPath(url) ?? normalizeRoutePath(url.pathname)
}

/** Stable BFS identity. Ordinary document anchors do not create extra pages. */
export function runtimeRouteKey(raw: string, base?: string): string {
  return runtimeRoutePath(raw, base)
}

function isLikelyDynamicSegment(segment: string) {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{32}$/i.test(segment) ||
    /^[0-9a-f]{8,}-[0-9a-f-]{10,}$/i.test(segment) ||
    (segment.length >= 10 &&
      /[0-9]/.test(segment) &&
      /^[A-Za-z0-9-_.]+$/.test(segment))
  )
}

/** Infer a pattern only when at least two routes share the same static shape. */
export function discoverFromPathSegments(candidates: string[]) {
  const grouped = new Map<string, string[]>()
  for (const candidate of candidates) {
    const path = runtimeRoutePath(candidate)
    const segments = path.split('/').filter(Boolean)
    if (!segments.length) continue
    const dynamicCount = segments.filter(isLikelyDynamicSegment).length
    if (!dynamicCount) continue
    const pattern = `/${segments
      .map((segment) => (isLikelyDynamicSegment(segment) ? ':id' : segment))
      .join('/')}`
    const examples = grouped.get(pattern)
    if (examples) examples.push(path)
    else grouped.set(pattern, [path])
  }
  return new Map(
    [...grouped].filter(([, examples]) => new Set(examples).size >= 2),
  )
}
