function titleCaseWords(input: string): string {
  return input
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/** One path segment (a folder or filename minus extension) -> a display word. */
export function prettifySegment(segment: string): string {
  if (segment.startsWith('(') && segment.endsWith(')')) {
    // Route group — not part of the URL; caller filters these out of the
    // route string, but still needs something to fall back on if a segment
    // is passed here directly.
    return titleCaseWords(segment.slice(1, -1))
  }
  if (segment.startsWith('[...') && segment.endsWith(']')) {
    return `${titleCaseWords(segment.slice(4, -1))} (catch-all)`
  }
  if (segment.startsWith('[[...') && segment.endsWith(']]')) {
    return `${titleCaseWords(segment.slice(5, -2))} (optional catch-all)`
  }
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return titleCaseWords(segment.slice(1, -1))
  }
  if (segment === 'index') return 'Home'
  return titleCaseWords(segment)
}

/** Directory segments (already split, route groups excluded) -> a display name. */
export function nameFromSegments(segments: string[]): string {
  if (segments.length === 0) return 'Home'
  return prettifySegment(segments[segments.length - 1])
}

/** Directory segments -> a route string, with Next.js route groups elided. */
export function routeFromSegments(segments: string[]): string {
  const kept = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')))
  if (kept.length === 0) return '/'
  return '/' + kept.join('/')
}

export function isComponentLikeName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name)
}

export function componentNameFromFilePath(filePath: string): string {
  const base = filePath
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(tsx|ts|jsx|js)$/, '')
  const withoutIndex = base === 'index' ? (filePath.split(/[\\/]/).slice(-2, -1)[0] ?? 'Component') : base
  const words = titleCaseWords(withoutIndex).replace(/\s+/g, '')
  return words || 'Component'
}
