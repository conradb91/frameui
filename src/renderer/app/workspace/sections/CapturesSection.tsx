import { useEffect, useMemo, useState } from 'react'
import type { CapturedElement, CapturedPage } from '@shared/types/runtimeCapture'
import { matchRoutePattern } from '@core/design-model/matchRoutePattern'
import { inferRoutePatterns } from '@core/design-model/inferRoutePatterns'
import { useProjectStore } from '../../../state/projectStore'
import { formatRelativeTime } from '../../../lib/formatRelativeTime'

const EMPTY_CAPTURES: CapturedPage[] = []

function countElements(element: CapturedElement): number {
  return element.children.reduce((count, child) => count + countElements(child), 1)
}

function elementLabel(element: CapturedElement): string {
  const id = element.id ? `#${element.id}` : ''
  const classes = element.classes ? `.${element.classes.trim().split(/\s+/).join('.')}` : ''
  return `${element.tag}${id}${classes}`
}

export function CapturesSection() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const [captures, setCaptures] = useState<CapturedPage[]>(EMPTY_CAPTURES)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [selectedElement, setSelectedElement] = useState<CapturedElement | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!activeProject) { setCaptures(EMPTY_CAPTURES); return }
    void window.frameui.capture.list(activeProject.id).then((list) => { if (!cancelled) setCaptures(list) })
    return () => { cancelled = true }
  }, [activeProject])

  const sorted = useMemo(() => [...captures].sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()), [captures])
  const selected = sorted.find((capture) => capture.id === selectedId) ?? sorted[0] ?? null
  const elementCount = selected ? countElements(selected.root) : 0
  const routeMatch = useMemo(
    () => (selected ? matchRoutePattern(selected.url, activeIndex?.projectModel.routes ?? []) : null),
    [selected, activeIndex],
  )
  const inferredPatterns = useMemo(
    () => inferRoutePatterns(captures, activeIndex?.projectModel.routes ?? []),
    [captures, activeIndex],
  )
  const inferredMatch = selected
    ? inferredPatterns.find((inferred) => inferred.captureIds.includes(selected.id))
    : undefined

  useEffect(() => {
    setSelectedElement(null)
    setScreenshotUrl(null)
    if (!activeProject || !selected?.screenshotFileName) return
    let cancelled = false
    void window.frameui.capture.getScreenshotDataUrl(activeProject.id, selected.id).then((url) => { if (!cancelled) setScreenshotUrl(url) })
    return () => { cancelled = true }
  }, [activeProject, selected])

  return <div className="flex min-h-0 flex-1">
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-bg-raised">
      <div className="flex h-10 items-center justify-between px-3"><span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Captures</span><span className="font-mono text-[9.5px] text-text-3">{sorted.length}</span></div>
      <div className="flex-1 overflow-y-auto px-1.5 py-2">{sorted.map((capture) => <button key={capture.id} type="button" onClick={() => setSelectedId(capture.id)} className={`block w-full rounded-[4px] px-2 py-2 text-left ${selected?.id === capture.id ? 'bg-blue-500/14 text-text' : 'text-text-2 hover:bg-white/[0.04]'}`}><span className="block truncate text-[11px]">{capture.url}</span><span className="mt-0.5 block text-[9.5px] text-text-3">{formatRelativeTime(capture.capturedAt)}</span></button>)}{sorted.length === 0 && <div className="px-2 py-3 text-[10px] leading-relaxed text-text-3">No captures yet — open Capture Session and click Capture This Page.</div>}</div>
    </aside>
    <main className="min-w-0 flex-1 overflow-y-auto p-6">{selected ? <>
      <div className="mb-5">{screenshotUrl ? <img src={screenshotUrl} alt="Captured page screenshot" className="max-h-[360px] rounded-[5px] border border-border" /> : <div className="flex h-[140px] items-center justify-center rounded-[5px] border border-border bg-panel text-[11px] text-text-3">No screenshot</div>}</div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-3">Structure</div>
      <div className="overflow-x-auto rounded-[5px] border border-border bg-panel p-2 font-mono text-[10.5px] leading-relaxed"><ElementRow element={selected.root} depth={0} selectedElement={selectedElement} onSelect={setSelectedElement} /></div>
    </> : <div className="flex h-full items-center justify-center text-center text-[11px] text-text-3">No captures yet — open Capture Session and click Capture This Page.</div>}</main>
    <aside className="w-[280px] shrink-0 border-l border-border bg-bg-raised">{selected ? <>
      <div className="border-b border-border p-3"><div className="truncate text-[12px] font-semibold text-text" title={selected.url}>{selected.url}</div><div className="mt-0.5 text-[10px] text-text-3">Capture inspector</div></div>
      <div className="p-3">
        <InspectorField label="URL" value={selected.url} mono />
        <InspectorField label="Captured at" value={new Date(selected.capturedAt).toLocaleString()} />
        <InspectorField label="Elements" value={String(elementCount)} />
        {routeMatch ? <>
          <InspectorField label="Matches Route" value={routeMatch.route.path} mono />
          {Object.entries(routeMatch.params).map(([name, value]) => <InspectorField key={`param:${name}`} label={`Param: ${name}`} value={value} mono />)}
        </> : inferredMatch ? <>
          <InspectorField label="Inferred Pattern" value={inferredMatch.pattern} mono />
          <InspectorField label="Matches Route" value={`Shared with ${inferredMatch.captureIds.length - 1} other capture${inferredMatch.captureIds.length - 1 === 1 ? '' : 's'} — not yet in source`} />
        </> : <InspectorField label="Matches Route" value="No matching route found in source" />}
        {selectedElement ? <>
          <div className="mb-1 mt-4 text-[9.5px] font-semibold uppercase tracking-wide text-text-3">Selected element — {elementLabel(selectedElement)}</div>
          {Object.keys(selectedElement.styles).length === 0 && !selectedElement.aria && <div className="py-2 text-[10px] text-text-3">No styles or ARIA attributes recorded.</div>}
          {Object.entries(selectedElement.styles).map(([key, value]) => <InspectorField key={`style:${key}`} label={key} value={value} mono />)}
          {selectedElement.aria && Object.entries(selectedElement.aria).map(([key, value]) => <InspectorField key={`aria:${key}`} label={`aria: ${key}`} value={value} mono />)}
        </> : <div className="mt-4 text-[10px] leading-relaxed text-text-3">Click an element in the structure to inspect its computed styles and ARIA attributes.</div>}
      </div>
    </> : null}</aside>
  </div>
}

function ElementRow({ element, depth, selectedElement, onSelect }: { element: CapturedElement; depth: number; selectedElement: CapturedElement | null; onSelect: (element: CapturedElement) => void }) {
  return <div>
    <button type="button" onClick={() => onSelect(element)} style={{ paddingLeft: `${depth * 14}px` }} className={`block w-full truncate rounded-[3px] py-0.5 pr-1 text-left ${selectedElement === element ? 'bg-blue-500/14 text-text' : 'text-text-2 hover:bg-white/[0.04]'}`}>{elementLabel(element)} <span className="text-text-3">{Math.round(element.rect.width)}×{Math.round(element.rect.height)}</span></button>
    {element.children.map((child, index) => <ElementRow key={index} element={child} depth={depth + 1} selectedElement={selectedElement} onSelect={onSelect} />)}
  </div>
}

function InspectorField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="border-b border-border py-2"><div className="mb-1 text-[9.5px] text-text-3">{label}</div><div className={`break-all text-[10.5px] text-text-2 ${mono ? 'font-mono text-[9.5px]' : ''}`}>{value}</div></div>
}
