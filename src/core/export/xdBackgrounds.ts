/** Split CSS image layers without splitting functions, quoted strings or data URLs. */
export function splitXdCssLayers(value: string): string[] {
  const result: string[] = []
  let start = 0,
    depth = 0,
    quote = ''
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '\\') {
      i++
      continue
    }
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      result.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  result.push(value.slice(start).trim())
  return result.filter(Boolean)
}
/** User-facing diagnostics must never include embedded assets or unbounded CSS. */
export function xdDiagnostic(value: string): string {
  return value
    .replace(/data:[^\s"')]+/gi, '[embedded asset]')
    .replace(/\p{Cc}/gu, ' ')
    .slice(0, 240)
}
export function xdImageSource(value: string): string | undefined {
  const m = /^url\(\s*(?:"([\s\S]*)"|'([\s\S]*)'|([^\s][\s\S]*?))\s*\)$/i.exec(value)
  return m?.[1] ?? m?.[2] ?? m?.[3]
}
