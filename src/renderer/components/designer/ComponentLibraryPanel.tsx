import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { PageStructureItem } from '@shared/types/pageStructure'
import type { Component, Page } from '@shared/types/model/projectModel'
import { ComponentThumbnail } from './ComponentThumbnail'

/**
 * Visual, searchable project component library (spec Phase 13) — meant to
 * be embedded inside the Feature Workspace's Components activity and/or
 * the Screen Designer's Insert panel. Renders every result with a real
 * `ComponentThumbnail` (not just a name/icon row) so a designer can search
 * and recognize components visually, and lets any result be inserted with
 * a plain click (the required, must-work path) or dragged natively for a
 * drop-target canvas to pick up later.
 */

const EMPTY_COMPONENTS: Component[] = []
const EMPTY_PAGES: Page[] = []

function normalize(value: string): string {
  return value.replace(/[-_.:]/g, '').toLowerCase()
}

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

export function ComponentLibraryPanel({
  components = EMPTY_COMPONENTS,
  pages = EMPTY_PAGES,
  activeProjectId,
  onInsert,
}: {
  components: Component[]
  pages: Page[]
  activeProjectId: string
  onInsert: (component: Component) => void
}) {
  const [query, setQuery] = useState('')
  const [structureCache, setStructureCache] = useState<Record<string, PageStructureItem[]>>({})

  // A different project's file paths mean nothing to a cache keyed by path
  // alone — start clean whenever the active project changes.
  useEffect(() => {
    setStructureCache({})
  }, [activeProjectId, components])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return components
    const matchedViaPages = new Set<string>()
    for (const page of pages) {
      for (const name of page.componentNames) {
        if (name.toLowerCase().includes(q)) matchedViaPages.add(normalize(name))
      }
    }
    return components.filter(
      (component) =>
        component.name.toLowerCase().includes(q) ||
        component.source.filePath.toLowerCase().includes(q) ||
        matchedViaPages.has(normalize(component.name)),
    )
  }, [components, pages, query])

  const grouped = useMemo(() => {
    const groups = new Map<string, Component[]>()
    for (const component of filtered) {
      const group = componentGroup(component)
      groups.set(group, [...(groups.get(group) ?? []), component])
    }
    return [...groups.entries()]
  }, [filtered])

  useEffect(() => {
    let cancelled = false
    const missing = [...new Set(filtered.map((component) => component.source.filePath))].filter((key) => structureCache[key] === undefined).slice(0, 60)
    if (!missing.length) return
    void Promise.all(missing.map(async (key) => [key, await window.frameui.project.getPageStructure(key).catch(() => [])] as const))
      .then((entries) => { if (!cancelled) setStructureCache((previous) => ({ ...previous, ...Object.fromEntries(entries) })) })
    return () => { cancelled = true }
  }, [activeProjectId, filtered, structureCache])

  function handleDragStart(event: React.DragEvent<HTMLButtonElement>, component: Component) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({ type: 'frameui/component', componentId: component.id }),
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-panel-2">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-2.5">
        <div className="flex h-7 w-full items-center gap-2 rounded-[5px] border border-border bg-panel px-2">
          <Search size={12} className="text-text-3" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search components…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-3"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-text-3">
            {components.length === 0 ? 'No reusable components detected.' : 'No components match your search.'}
          </div>
        ) : (
          grouped.map(([group, items]) => (
            <div key={group} className="mb-4">
              <div className="mb-1.5 flex justify-between px-0.5 text-[11px] font-semibold tracking-wide text-text-3">
                <span>{group}</span>
                <span>{items.length}</span>
              </div>
              <div className="flex flex-col gap-1">
                {items.map((component) => (
                  <button
                    key={component.id}
                    type="button"
                    draggable
                    onDragStart={(event) => handleDragStart(event, component)}
                    onClick={() => onInsert(component)}
                    title={`Insert ${component.name}`}
                    className="flex items-center gap-2 rounded-[5px] border border-border bg-panel p-1.5 text-left transition hover:border-accent-2 hover:bg-hover"
                  >
                    <ComponentThumbnail component={component} structure={structureCache[component.source.filePath] ?? null} size="sm" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[11px] text-text-2">{component.name}</span>
                      <span className="truncate font-mono text-[11px] text-text-3">{component.source.filePath}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
