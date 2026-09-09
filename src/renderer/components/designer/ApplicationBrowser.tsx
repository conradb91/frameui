import { useMemo, useState } from 'react'
import { X, Search, FileStack } from 'lucide-react'
import type { ProjectModel, Page } from '@shared/types/model/projectModel'
import type { Feature } from '@shared/types/model/featureModel'

/**
 * Phase 8 — "Add Existing Page" searchable Application Browser. Pulls from
 * the real indexed `ProjectModel.pages`, not a flat filename search, and
 * always asks the designer to choose editable vs. reference-only per the
 * spec's explicit two-action requirement.
 */

/** Strips route-param placeholders (`:id`, `{id}`) so segment matching
 * doesn't try to fuzzy-match against a param name, while still letting a
 * plain substring like "bill" match "/bills/:id" via the raw-route check
 * below. */
function routeSegments(route: string | null): string[] {
  if (!route) return []
  return route
    .split('/')
    .filter(Boolean)
    .filter((segment) => !/^:.+/.test(segment) && !/^\{.+\}$/.test(segment))
}

function matchesQuery(page: Page, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (page.name.toLowerCase().includes(q)) return true
  if (page.route && page.route.toLowerCase().includes(q)) return true
  if (routeSegments(page.route).some((segment) => segment.toLowerCase().includes(q))) return true
  if (page.componentNames.some((name) => name.toLowerCase().includes(q))) return true
  if (page.source.filePath.toLowerCase().includes(q)) return true
  return false
}

type AddedState = 'design' | 'reference' | null

export function ApplicationBrowser({
  projectModel,
  feature,
  onAddPage,
  onClose,
}: {
  projectModel: ProjectModel
  feature: Feature
  onAddPage: (pageId: string, mode: 'design' | 'reference') => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => projectModel.pages.filter((page) => matchesQuery(page, query)), [projectModel.pages, query])

  function addedState(pageId: string): AddedState {
    if (feature.pageIds.includes(pageId)) return 'design'
    if (feature.referenceOnlyPageIds.includes(pageId)) return 'reference'
    return null
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-panel shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
            <FileStack size={15} className="text-accent-2" />
            Add Existing Page
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-white/5 hover:text-text">
            <X size={15} />
          </button>
        </div>

        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-panel-2 px-2.5 py-2">
            <Search size={14} className="shrink-0 text-text-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages by name, route, or component…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-text-3"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {results.length === 0 ? (
            <div className="px-2 py-6 text-center text-[12px] text-text-3">No pages match "{query}".</div>
          ) : (
            <div className="flex flex-col gap-2">
              {results.map((page) => (
                <PageResultRow key={page.id} page={page} added={addedState(page.id)} onAddPage={onAddPage} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PageResultRow({
  page,
  added,
  onAddPage,
}: {
  page: Page
  added: AddedState
  onAddPage: (pageId: string, mode: 'design' | 'reference') => void
}) {
  return (
    <div className="rounded-lg border border-border bg-panel-2 p-3">
      <div className="text-[13px] font-medium text-text">{page.name}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-accent-2">{page.route ?? 'No route'}</div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-text-3" title={page.source.filePath}>
        {page.source.filePath}
      </div>

      {added ? (
        <div className="mt-2.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-1.5 text-[11px] font-semibold text-success">
          Already added {added === 'reference' ? '· Reference only' : '· Editable'}
        </div>
      ) : (
        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            onClick={() => onAddPage(page.id, 'design')}
            className="flex-1 rounded-md border border-accent bg-accent/90 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-accent"
          >
            Add to Feature
          </button>
          <button
            type="button"
            onClick={() => onAddPage(page.id, 'reference')}
            className="flex-1 rounded-md border border-border bg-panel px-2 py-1.5 text-[11px] font-semibold text-text-2 hover:text-text"
          >
            Add as Reference Only
          </button>
        </div>
      )}
    </div>
  )
}
