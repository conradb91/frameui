import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { PageStructureItem } from '@shared/types/pageStructure'
import type { Component } from '@shared/types/model/projectModel'
import { useProjectStore } from '../../../state/projectStore'
import { useUiStore } from '../../../state/uiStore'
import { StructurePreview } from '../../../components/project/StructurePreview'
import { ComponentThumbnail } from '../../../components/designer/ComponentThumbnail'

const EMPTY_COMPONENTS: Component[] = []

function componentGroup(component: Component): string {
  const value = `${component.name} ${component.source.filePath}`.toLowerCase()
  if (/button|action|cta/.test(value)) return 'Buttons'
  if (/input|field|select|form|textarea/.test(value)) return 'Inputs & Forms'
  if (/card|panel|tile/.test(value)) return 'Cards'
  if (/nav|menu|sidebar|header|footer/.test(value)) return 'Navigation'
  if (/modal|dialog|drawer|popover/.test(value)) return 'Overlays'
  if (/table|grid|list/.test(value)) return 'Data display'
  return 'Custom'
}

export function ComponentsSection() {
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const setSection = useUiStore((s) => s.setSection)
  const setSelectedScreenId = useUiStore((s) => s.setSelectedScreenId)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Structure cache shared between the left list's row thumbnails and the
  // big detail preview on the right, keyed by file path so switching
  // selection or scrolling the list never refetches a component already
  // seen.
  const [structureCache, setStructureCache] = useState<Record<string, PageStructureItem[]>>({})
  const inFlightRef = useRef<Set<string>>(new Set())
  const components = activeIndex?.projectModel.components ?? EMPTY_COMPONENTS
  const selected = components.find((component) => component.id === selectedId) ?? components[0] ?? null
  const grouped = useMemo(() => {
    const groups = new Map<string, Component[]>()
    for (const component of components.filter((item) => !query.trim() || item.name.toLowerCase().includes(query.toLowerCase()) || item.source.filePath.toLowerCase().includes(query.toLowerCase()))) groups.set(componentGroup(component), [...(groups.get(componentGroup(component)) ?? []), component])
    return [...groups.entries()]
  }, [components, query])
  const usedIn = activeIndex?.projectModel.pages.filter((page) => selected && page.componentNames.some((name) => name.replace(/[-_.:]/g, '').toLowerCase() === selected.name.replace(/[-_.:]/g, '').toLowerCase())) ?? []
  const structure = selected ? structureCache[selected.source.filePath] ?? [] : []

  // A reindex/project switch invalidates every previously fetched
  // structure — relative file paths can collide across projects.
  useEffect(() => {
    setStructureCache({})
    inFlightRef.current = new Set()
  }, [activeIndex?.projectModel.projectId])

  useEffect(() => {
    let cancelled = false
    const visible = grouped.flatMap(([, items]) => items)
    const wanted = selected ? [selected, ...visible] : visible
    for (const component of wanted) {
      const key = component.source.filePath
      if (structureCache[key] !== undefined || inFlightRef.current.has(key)) continue
      inFlightRef.current.add(key)
      void window.frameui.project
        .getPageStructure(key)
        .then((items) => { if (!cancelled) setStructureCache((prev) => (prev[key] !== undefined ? prev : { ...prev, [key]: items })) })
        .catch(() => { if (!cancelled) setStructureCache((prev) => (prev[key] !== undefined ? prev : { ...prev, [key]: [] })) })
        .finally(() => { inFlightRef.current.delete(key) })
    }
    return () => { cancelled = true }
  }, [grouped, selected, structureCache])

  function openUsage(pageId: string) {
    setSelectedScreenId(pageId)
    setSection('screens')
  }

  return <div className="flex min-h-0 flex-1">
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-bg-raised"><div className="flex h-10 items-center justify-between px-3"><span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Components</span><span className="font-mono text-[9.5px] text-text-3">{components.length}</span></div><div className="border-b border-border px-2 pb-2"><div className="flex h-7 items-center gap-2 rounded-[5px] border border-border bg-panel px-2"><Search size={12} className="text-text-3" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search components…" className="min-w-0 flex-1 bg-transparent text-[11px] text-text outline-none placeholder:text-text-3" /></div></div><div className="flex-1 overflow-y-auto px-1.5 py-2">{grouped.map(([group, items]) => <div key={group} className="mb-3"><div className="mb-1 flex justify-between px-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-text-3"><span>{group}</span><span>{items.length}</span></div>{items.map((component) => <button key={component.id} type="button" onClick={() => setSelectedId(component.id)} className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left ${selected?.id === component.id ? 'bg-blue-500/14 text-text' : 'text-text-2 hover:bg-white/[0.04]'}`}><ComponentThumbnail component={component} structure={structureCache[component.source.filePath] ?? null} size="sm" /><span className="truncate text-[11px]">{component.name}</span></button>)}</div>)}</div></aside>
    <main className="min-w-0 flex-1 overflow-y-auto p-6">{selected ? <><div className="mb-5 flex items-baseline gap-3"><h1 className="text-[16px] font-semibold text-text">{selected.name}</h1><span className="text-[10px] text-text-3">{usedIn.length} screen{usedIn.length === 1 ? '' : 's'}</span></div><div className="grid grid-cols-2 gap-4"><ComponentState label="Default" structure={structure} /><ComponentState label="Hover" structure={structure} muted /><ComponentState label="Active" structure={structure} muted /><ComponentState label="Disabled" structure={structure} muted /></div>{usedIn.length > 0 && <section className="mt-7"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-3">Used in</div><div className="border-t border-border">{usedIn.map((page) => <button key={page.id} type="button" onClick={() => openUsage(page.id)} className="grid w-full grid-cols-[1fr_1fr_90px] border-b border-border py-2 text-left text-[10.5px] hover:bg-white/[0.025]"><span className="text-text-2">{page.name}</span><span className="font-mono text-[9.5px] text-text-3">{page.route}</span><span className="text-right text-blue-300">Open screen</span></button>)}</div></section>}</> : <div className="flex h-full items-center justify-center text-[11px] text-text-3">No reusable components detected.</div>}</main>
    <aside className="w-[280px] shrink-0 border-l border-border bg-bg-raised">{selected ? <><div className="border-b border-border p-3"><div className="text-[12px] font-semibold text-text">{selected.name}</div><div className="mt-0.5 text-[10px] text-text-3">Component inspector</div></div><div className="p-3"><InspectorField label="Source" value={selected.source.filePath} mono /><InspectorField label="Source type" value={selected.exportKind === 'template' ? 'Template component' : `${selected.exportKind} export`} /><InspectorField label="Usage" value={`${usedIn.length} screens`} /><InspectorField label="Elements" value={String(countNodes(structure))} /><div className="mt-4 rounded-[4px] border border-border bg-panel p-2.5 text-[10px] leading-relaxed text-text-3">Runtime props, computed styles, variants and accessibility become available after running the application.</div></div></> : null}</aside>
  </div>
}

function ComponentState({ label, structure, muted }: { label: string; structure: PageStructureItem[]; muted?: boolean }) { return <div><div className="mb-1.5 text-[10px] text-text-3">{label}</div><div className={`aspect-[16/8] overflow-hidden rounded-[5px] border border-border bg-white ${muted ? 'opacity-65' : ''}`}><StructurePreview structure={structure} compact /></div></div> }
function InspectorField({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="border-b border-border py-2"><div className="mb-1 text-[9.5px] text-text-3">{label}</div><div className={`break-all text-[10.5px] text-text-2 ${mono ? 'font-mono text-[9.5px]' : ''}`}>{value}</div></div> }
function countNodes(items: PageStructureItem[]): number { return items.reduce((count, item) => count + 1 + countNodes(item.children), 0) }
