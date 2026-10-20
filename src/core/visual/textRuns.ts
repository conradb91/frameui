import type { TextStyleRun } from '@shared/types/richText'

export interface TextSegment extends Omit<TextStyleRun, 'start' | 'end'> {
  start: number
  end: number
  text: string
}
type RunStyle = Omit<TextStyleRun, 'start' | 'end'>
function normalizedStyle(run: TextStyleRun | undefined): RunStyle {
  if (!run) return {}
  const { start: _start, end: _end, ...style } = run
  return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined))
}
function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function normalizeTextRuns(text: string, runs: TextStyleRun[] = []): TextStyleRun[] {
  if (!text.length || !runs.length) return []
  const styles: RunStyle[] = Array.from({ length: text.length }, () => ({}))
  for (const run of runs) {
    const start = Math.max(0, Math.min(text.length, Math.floor(run.start)))
    const end = Math.max(start, Math.min(text.length, Math.floor(run.end)))
    for (let index = start; index < end; index++)
      styles[index] = { ...styles[index], ...normalizedStyle(run) }
  }
  const result: TextStyleRun[] = []
  let start = 0
  for (let index = 1; index <= styles.length; index++) {
    if (index < styles.length && sameStyle(styles[start], styles[index])) continue
    const style = styles[start]
    if (Object.keys(style).length) result.push({ start, end: index, ...style })
    start = index
  }
  return result
}

export function applyTextStyle(
  text: string,
  runs: TextStyleRun[] | undefined,
  start: number,
  end: number,
  style: Pick<TextStyleRun, 'fontWeight' | 'color'>,
): TextStyleRun[] {
  const normalized = normalizeTextRuns(text, runs)
  const from = Math.max(0, Math.min(text.length, Math.floor(Math.min(start, end))))
  const to = Math.max(from, Math.min(text.length, Math.floor(Math.max(start, end))))
  if (from === to) return normalized
  const points = [
    ...new Set([0, text.length, from, to, ...normalized.flatMap((r) => [r.start, r.end])]),
  ].sort((a, b) => a - b)
  return normalizeTextRuns(
    text,
    points.slice(0, -1).map((start, i) => {
      const end = points[i + 1],
        base = normalized.find((r) => r.start <= start && r.end >= end)
      const patch = { ...normalizedStyle(base) }
      if (start >= from && end <= to) {
        Object.assign(patch, style)
        if (style.color !== undefined) delete patch.gradient
      }
      return { start, end, ...patch }
    }),
  )
}

export function textSegments(
  text: string,
  runs: TextStyleRun[] = [],
  from = 0,
  to = text.length,
): TextSegment[] {
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
    const start = points[index],
      end = points[index + 1]
    const style = normalized.find((run) => run.start <= start && run.end >= end)
    segments.push({ start, end, text: text.slice(start, end), ...normalizedStyle(style) })
  }
  return segments
}

/** Shift formatting with a contiguous browser edit, keeping the unchanged suffix styled. */
export function rebaseTextRuns(before:string,after:string,runs:TextStyleRun[]=[]):TextStyleRun[]{
 if(before===after)return normalizeTextRuns(after,runs)
 let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++
 let suffix=0;while(suffix<before.length-start&&suffix<after.length-start&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++
 const oldEnd=before.length-suffix,newEnd=after.length-suffix,delta=newEnd-oldEnd
 const normalized=normalizeTextRuns(before,runs),out:TextStyleRun[]=[]
 for(const run of normalized){if(run.start<start)out.push({...run,end:Math.min(run.end,start)});if(run.end>oldEnd)out.push({...run,start:Math.max(run.start,oldEnd)+delta,end:run.end+delta})}
 if(newEnd>start){const position=oldEnd>start?start:Math.max(0,start-1),style=normalized.find(run=>run.start<=position&&run.end>position);if(style)out.push({...style,start,end:newEnd})}
 return normalizeTextRuns(after,out)
}
