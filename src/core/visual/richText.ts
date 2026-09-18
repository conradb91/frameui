import type { TextStyleRun } from '@shared/types/richText'

export interface TextSegment {
  start: number
  end: number
  text: string
  fontWeight?: string
  color?: string
}

type RunStyle = Partial<Pick<TextStyleRun, 'fontWeight' | 'color'>>

function normalizedStyle(run: TextStyleRun | undefined): RunStyle {
  const style: RunStyle = {}
  if (run?.fontWeight !== undefined) style.fontWeight = run.fontWeight
  if (run?.color !== undefined) style.color = run.color
  return style
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return a.fontWeight === b.fontWeight && a.color === b.color
}

export function normalizeTextRuns(text: string, runs: TextStyleRun[] = []): TextStyleRun[] {
  if (!text.length || !runs.length) return []
  const styles: RunStyle[] = Array.from({ length: text.length }, () => ({}))
  for (const run of runs) {
    const start = Math.max(0, Math.min(text.length, Math.floor(run.start)))
    const end = Math.max(start, Math.min(text.length, Math.floor(run.end)))
    for (let index = start; index < end; index++) styles[index] = { ...styles[index], ...normalizedStyle(run) }
  }
  const result: TextStyleRun[] = []
  let start = 0
  for (let index = 1; index <= styles.length; index++) {
    if (index < styles.length && sameStyle(styles[start], styles[index])) continue
    const style = styles[start]
    if (style.fontWeight !== undefined || style.color !== undefined) result.push({ start, end: index, ...style })
    start = index
  }
  return result
}

export function applyTextStyle(text: string, runs: TextStyleRun[] | undefined, start: number, end: number, style: Pick<TextStyleRun, 'fontWeight' | 'color'>): TextStyleRun[] {
  const normalized = normalizeTextRuns(text, runs)
  const from = Math.max(0, Math.min(text.length, Math.floor(Math.min(start, end))))
  const to = Math.max(from, Math.min(text.length, Math.floor(Math.max(start, end))))
  if (from === to) return normalized
  return normalizeTextRuns(text, [...normalized, { start: from, end: to, ...style }])
}

export function textSegments(text: string, runs: TextStyleRun[] = [], from = 0, to = text.length): TextSegment[] {
  const normalized = normalizeTextRuns(text, runs)
  const boundaries = new Set<number>([Math.max(0, from), Math.min(text.length, to)])
  for (const run of normalized) {
    if (run.end <= from || run.start >= to) continue
    boundaries.add(Math.max(from, run.start))
    boundaries.add(Math.min(to, run.end))
  }
  const points = [...boundaries].sort((a, b) => a - b)
  const segments: TextSegment[] = []
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index], end = points[index + 1]
    const style = normalized.find((run) => run.start <= start && run.end >= end)
    segments.push({ start, end, text: text.slice(start, end), fontWeight: style?.fontWeight, color: style?.color })
  }
  return segments
}

export function textRangeWithin(root: HTMLElement, range: Range): { start: number; end: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const beforeStart = document.createRange()
  beforeStart.selectNodeContents(root)
  beforeStart.setEnd(range.startContainer, range.startOffset)
  const beforeEnd = document.createRange()
  beforeEnd.selectNodeContents(root)
  beforeEnd.setEnd(range.endContainer, range.endOffset)
  return { start: beforeStart.toString().length, end: beforeEnd.toString().length }
}

export function restoreTextRange(root: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let offset = 0
  let startNode: Node | null = null, endNode: Node | null = null, startOffset = 0, endOffset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    const next = offset + (node.textContent?.length ?? 0)
    if (!startNode && start <= next) { startNode = node; startOffset = Math.max(0, start - offset) }
    if (!endNode && end <= next) { endNode = node; endOffset = Math.max(0, end - offset); break }
    offset = next
  }
  if (!startNode || !endNode) return
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
