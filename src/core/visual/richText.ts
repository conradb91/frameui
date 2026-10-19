export { normalizeTextRuns, applyTextStyle, textSegments } from './textRuns'
export type { TextSegment } from './textRuns'

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
