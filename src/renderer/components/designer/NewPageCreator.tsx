import { useMemo, useState } from 'react'
import { X, ChevronLeft, FileText, LayoutTemplate, Copy, Layers, Search, AlertCircle, Loader2, Monitor, Tablet, Smartphone } from 'lucide-react'
import type { ProjectModel, Page, Component } from '@shared/types/model/projectModel'
import type { Viewport } from '@shared/types/model/projectModel'
import type { FeaturePage, NewPageLayoutSource } from '@shared/types/model/featureModel'
import type { DesignNode, PlaceholderNode } from '@shared/types/designNode'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { createDefaultTree } from '@core/design-model/defaultTree'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'
import { cloneNodeWithFreshIds } from '@core/design-model/tree'
import { classifyEditability } from '@core/design-model/editability'

/**
 * Phase 16 — "New Page Creation." A dense slide-over (matching
 * `ApplicationBrowser`'s look) that walks a designer through choosing a
 * starting point for a brand-new `FeaturePage` — one that has no source in
 * the codebase yet — then builds and saves that page's "Default" design
 * tree immediately, so the page is fully ready to open the moment it's
 * created (spec: no lazily-built trees).
 */

// ---------------------------------------------------------------------------
// Layout-pattern detection — the same heuristic-grouping style as
// `ComponentLibraryPanel.tsx`'s `componentGroup()`: check regexes in a fixed
// order, first match wins. Shared by "Use Project Layout" (scans
// `ProjectModel.components`) and "Use Existing Page Pattern" (scans a
// fetched page's top-level `PageStructureItem`s).
// ---------------------------------------------------------------------------

type LayoutRole = 'shell' | 'sidebar' | 'topnav' | 'pageHeader' | 'contentContainer' | 'footer'

const LAYOUT_ROLE_LABEL: Record<LayoutRole, string> = {
  shell: 'App Shell',
  sidebar: 'Sidebar',
  topnav: 'Top Navigation',
  pageHeader: 'Page Header',
  contentContainer: 'Content Container',
  footer: 'Footer',
}

const LAYOUT_ROLE_ORDER: LayoutRole[] = ['shell', 'sidebar', 'topnav', 'pageHeader', 'contentContainer', 'footer']

function detectLayoutRole(name: string): LayoutRole | null {
  if (/app.?shell|layout|shell/i.test(name)) return 'shell'
  if (/sidebar/i.test(name)) return 'sidebar'
  if (/top.?nav|navbar|navigation/i.test(name)) return 'topnav'
  if (/page.?header/i.test(name)) return 'pageHeader'
  if (/content.?container|main.?content/i.test(name)) return 'contentContainer'
  if (/footer/i.test(name)) return 'footer'
  return null
}

/** A detected layout wrapper, normalized from either a `Component` (Use
 * Project Layout) or a top-level `PageStructureItem` (Use Existing Page
 * Pattern) so both flows build trees through the same helper below. */
interface DetectedWrapper {
  role: LayoutRole
  label: string
  sourceFilePath: string
  sourceLine?: number
  attributes?: Record<string, string>
}

function detectProjectLayoutComponents(components: Component[]): Partial<Record<LayoutRole, Component[]>> {
  const found: Partial<Record<LayoutRole, Component[]>> = {}
  for (const component of components) {
    const role = detectLayoutRole(component.name)
    if (!role) continue
    found[role] = [...(found[role] ?? []), component]
  }
  return found
}

function detectPageWrappers(structure: PageStructureItem[], sourceFilePath: string): DetectedWrapper[] {
  const wrappers: DetectedWrapper[] = []
  for (const item of structure) {
    if (!item.isKnownComponent) continue
    const role = detectLayoutRole(item.tagName)
    if (!role) continue
    wrappers.push({
      role,
      label: item.tagName,
      sourceFilePath: item.sourceFilePath ?? sourceFilePath,
      sourceLine: item.sourceLine,
      attributes: item.attributes,
    })
  }
  return wrappers
}

function wrapperPlaceholder(w: DetectedWrapper): PlaceholderNode {
  return {
    kind: 'placeholder',
    id: crypto.randomUUID(),
    editability: classifyEditability('project-component-partial'),
    provenance: 'existing',
    children: [],
    label: w.label,
    sourceFilePath: w.sourceFilePath,
    sourceReference: { filePath: w.sourceFilePath, line: w.sourceLine },
    attributes: w.attributes,
  }
}

/** Arranges detected layout wrappers around a blank content stack — top nav
 * / page header stacked above a sidebar+content row, with an optional
 * footer beneath — the shared "real, working layout-seeded page" builder
 * for both "Use Project Layout" and "Use Existing Page Pattern." When
 * `shell` is given, the whole arrangement nests inside one root
 * `PlaceholderNode` for it; otherwise the arrangement itself is the root. */
function buildLayoutShellTree(byRole: Partial<Record<LayoutRole, DetectedWrapper>>, shell?: DetectedWrapper): DesignNode {
  const contentStack = createDefaultTree(crypto.randomUUID())
  const bodyChildren: DesignNode[] = []
  if (byRole.sidebar) bodyChildren.push(wrapperPlaceholder(byRole.sidebar))
  bodyChildren.push(contentStack)

  const bodyStack: DesignNode = {
    kind: 'stack',
    id: crypto.randomUUID(),
    editability: 'editable',
    provenance: 'new',
    children: bodyChildren,
    direction: 'row',
    gap: 16,
    align: 'stretch',
  }

  const topChildren: DesignNode[] = []
  if (byRole.topnav) topChildren.push(wrapperPlaceholder(byRole.topnav))
  if (byRole.pageHeader) topChildren.push(wrapperPlaceholder(byRole.pageHeader))
  topChildren.push(bodyStack)
  if (byRole.footer) topChildren.push(wrapperPlaceholder(byRole.footer))

  const outer: DesignNode = {
    kind: 'stack',
    id: crypto.randomUUID(),
    editability: 'editable',
    provenance: 'new',
    children: topChildren,
    direction: 'column',
    gap: 12,
    align: 'stretch',
  }

  if (!shell) return outer

  return {
    kind: 'placeholder',
    id: crypto.randomUUID(),
    editability: classifyEditability('project-component-partial'),
    provenance: 'existing',
    children: [outer],
    label: shell.label,
    sourceFilePath: shell.sourceFilePath,
    sourceReference: { filePath: shell.sourceFilePath, line: shell.sourceLine },
    attributes: shell.attributes,
  }
}

// ---------------------------------------------------------------------------

type SourceStep = 'source' | 'configure' | 'details'

const VIEWPORTS: { id: Viewport; label: string; icon: typeof Monitor }[] = [
  { id: 'desktop', label: 'Desktop', icon: Monitor },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'mobile', label: 'Mobile', icon: Smartphone },
]

const SOURCE_OPTIONS: { id: NewPageLayoutSource; label: string; description: string; icon: typeof FileText }[] = [
  { id: 'blank', label: 'Blank Page', description: 'Start from an empty canvas.', icon: FileText },
  { id: 'project-layout', label: 'Use Project Layout', description: "Seed with one of this project's real layout components.", icon: LayoutTemplate },
  { id: 'clone', label: 'Clone Existing Page', description: 'Copy a real page’s full structure as a starting point.', icon: Copy },
  { id: 'pattern', label: 'Use Existing Page Pattern', description: 'Reuse just the outer layout wrappers of a real page.', icon: Layers },
]

function matchesPageQuery(page: Page, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    page.name.toLowerCase().includes(q) ||
    (page.route?.toLowerCase().includes(q) ?? false) ||
    page.source.filePath.toLowerCase().includes(q)
  )
}

function PagePicker({ pages, selectedId, onSelect }: { pages: Page[]; selectedId: string | null; onSelect: (page: Page) => void }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => pages.filter((p) => matchesPageQuery(p, query)), [pages, query])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-panel-2 px-2.5 py-2">
        <Search size={13} className="shrink-0 text-text-3" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages by name or route…"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-3"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-text-3">No pages match "{query}".</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {results.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => onSelect(page)}
                className={`rounded-md border px-2.5 py-2 text-left transition ${
                  selectedId === page.id ? 'border-accent bg-accent/10' : 'border-border bg-panel-2 hover:border-border-strong'
                }`}
              >
                <div className="text-[12px] font-medium text-text">{page.name}</div>
                <div className="mt-0.5 font-mono text-[10px] text-accent-2">{page.route ?? 'No route'}</div>
                <div className="mt-0.5 truncate font-mono text-[9.5px] text-text-3">{page.source.filePath}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function NewPageCreator(props: {
  projectId: string
  featureId: string
  projectModel: ProjectModel
  onCreated: (page: FeaturePage) => void
  onClose: () => void
}) {
  const { projectId, featureId, projectModel, onCreated, onClose } = props

  const [step, setStep] = useState<SourceStep>('source')
  const [layoutSource, setLayoutSource] = useState<NewPageLayoutSource | null>(null)

  // "Use Project Layout" configure state
  const detectedLayoutGroups = useMemo(() => detectProjectLayoutComponents(projectModel.components), [projectModel.components])
  const hasDetectedLayout = useMemo(() => LAYOUT_ROLE_ORDER.some((role) => (detectedLayoutGroups[role]?.length ?? 0) > 0), [detectedLayoutGroups])
  const [selectedLayoutComponentId, setSelectedLayoutComponentId] = useState<string | 'none' | null>(null)

  // "Clone" / "Pattern" configure state
  const [selectedPage, setSelectedPage] = useState<Page | null>(null)
  const [patternPreview, setPatternPreview] = useState<{ wrappers: DetectedWrapper[] } | null>(null)
  const [patternLoading, setPatternLoading] = useState(false)
  const [patternError, setPatternError] = useState<string | null>(null)

  // Details form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [suggestedRoute, setSuggestedRoute] = useState('')
  const [viewport, setViewport] = useState<Viewport>('desktop')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function chooseSource(source: NewPageLayoutSource) {
    setLayoutSource(source)
    setSubmitError(null)
    if (source === 'blank') {
      setStep('details')
    } else {
      setStep('configure')
    }
  }

  function backToSource() {
    setStep('source')
    setLayoutSource(null)
    setSelectedLayoutComponentId(null)
    setSelectedPage(null)
    setPatternPreview(null)
    setPatternError(null)
  }

  async function selectPatternPage(page: Page) {
    setSelectedPage(page)
    setPatternPreview(null)
    setPatternError(null)
    setPatternLoading(true)
    try {
      const structure = await window.frameui.project.getPageStructure(page.source.filePath)
      const wrappers = detectPageWrappers(structure, page.source.filePath)
      setPatternPreview({ wrappers })
    } catch {
      setPatternError('Could not read this page’s structure.')
    } finally {
      setPatternLoading(false)
    }
  }

  const canContinueFromConfigure =
    layoutSource === 'project-layout'
      ? selectedLayoutComponentId !== null
      : layoutSource === 'clone'
        ? selectedPage !== null
        : layoutSource === 'pattern'
          ? selectedPage !== null && patternPreview !== null && !patternLoading
          : false

  const canSubmit = name.trim().length > 0 && !submitting

  async function buildTree(): Promise<{ tree: DesignNode; basedOnPageId: string | null; basedOnPatternName: string | null }> {
    if (layoutSource === 'blank') {
      return { tree: createDefaultTree(crypto.randomUUID()), basedOnPageId: null, basedOnPatternName: null }
    }

    if (layoutSource === 'project-layout') {
      if (!selectedLayoutComponentId || selectedLayoutComponentId === 'none') {
        return { tree: createDefaultTree(crypto.randomUUID()), basedOnPageId: null, basedOnPatternName: null }
      }
      const all = LAYOUT_ROLE_ORDER.flatMap((role) => detectedLayoutGroups[role] ?? [])
      const picked = all.find((c) => c.id === selectedLayoutComponentId)
      if (!picked) {
        return { tree: createDefaultTree(crypto.randomUUID()), basedOnPageId: null, basedOnPatternName: null }
      }
      const pickedRole = detectLayoutRole(picked.name)
      const byRole: Partial<Record<LayoutRole, DetectedWrapper>> = {}
      for (const role of LAYOUT_ROLE_ORDER) {
        if (role === pickedRole) continue
        const first = detectedLayoutGroups[role]?.[0]
        if (first) byRole[role] = { role, label: first.name, sourceFilePath: first.source.filePath, sourceLine: first.source.line }
      }
      const shell: DetectedWrapper = { role: pickedRole ?? 'shell', label: picked.name, sourceFilePath: picked.source.filePath, sourceLine: picked.source.line }
      return { tree: buildLayoutShellTree(byRole, shell), basedOnPageId: null, basedOnPatternName: picked.name }
    }

    if (layoutSource === 'clone') {
      if (!selectedPage) throw new Error('No page selected to clone.')
      const structure = await window.frameui.project.getPageStructure(selectedPage.source.filePath)
      const draft = buildExistingPageDraftTree(crypto.randomUUID(), structure, selectedPage.source.filePath)
      return { tree: cloneNodeWithFreshIds(draft), basedOnPageId: selectedPage.id, basedOnPatternName: null }
    }

    if (layoutSource === 'pattern') {
      if (!selectedPage || !patternPreview) throw new Error('No page pattern selected.')
      const byRole: Partial<Record<LayoutRole, DetectedWrapper>> = {}
      for (const w of patternPreview.wrappers) {
        if (!byRole[w.role]) byRole[w.role] = w
      }
      const patternName = patternPreview.wrappers.map((w) => w.label).join(', ') || 'Layout pattern'
      return { tree: buildLayoutShellTree(byRole), basedOnPageId: selectedPage.id, basedOnPatternName: patternName }
    }

    throw new Error('No starting point selected.')
  }

  async function handleSubmit() {
    if (!layoutSource || !canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { tree, basedOnPageId, basedOnPatternName } = await buildTree()

      const page = await window.frameui.workspace.createFeaturePage(projectId, {
        featureId,
        name: name.trim(),
        description: description.trim() || undefined,
        suggestedRoute: suggestedRoute.trim() || null,
        initialViewport: viewport,
        layoutSource,
        basedOnPageId,
        basedOnPatternName,
      })

      const state = await window.frameui.workspace.createDesignState(projectId, {
        featureId,
        pageRef: { kind: 'new', pageId: page.id },
        pageSlugHint: name.trim(),
        name: 'Default',
        origin: 'design',
        provenance: 'new',
      })

      await window.frameui.workspace.saveDesignTree({ ownerId: state.id, projectId, tree, updatedAt: new Date().toISOString() })

      onCreated(page)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create this page. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const stepLabel =
    step === 'source' ? 'Step 1 · Choose a starting point' : step === 'configure' ? 'Step 2 · Configure' : layoutSource === 'blank' ? 'Step 2 · Page details' : 'Step 3 · Page details'

  return (
    <div className="absolute inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex h-full w-[440px] shrink-0 flex-col border-l border-border bg-panel shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
            {step !== 'source' && (
              <button type="button" onClick={backToSource} className="flex h-6 w-6 items-center justify-center rounded-md text-text-3 hover:bg-white/5 hover:text-text">
                <ChevronLeft size={15} />
              </button>
            )}
            <LayoutTemplate size={15} className="text-accent-2" />
            New Page
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-white/5 hover:text-text">
            <X size={15} />
          </button>
        </div>

        <div className="border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-3">{stepLabel}</div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {step === 'source' && (
            <div className="flex flex-col gap-2">
              {SOURCE_OPTIONS.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => chooseSource(option.id)}
                    className="flex items-start gap-3 rounded-lg border border-border bg-panel-2 p-3 text-left transition hover:border-accent/50 hover:bg-white/[0.03]"
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-panel text-accent-2">
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-text">{option.label}</div>
                      <div className="mt-0.5 text-[11px] text-text-3">{option.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {step === 'configure' && layoutSource === 'project-layout' && (
            <div className="flex min-h-0 flex-1 flex-col">
              {!hasDetectedLayout ? (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-panel-2 px-2.5 py-2 text-[11px] text-text-3">
                  <AlertCircle size={13} className="mt-0.5 shrink-0 text-text-3" />
                  No layout-shaped components (app shell, sidebar, top nav, header, footer) were detected in this project. You can still continue with a blank content area.
                </div>
              ) : (
                <div className="mb-2 text-[11px] text-text-3">Found layout components in this project:</div>
              )}

              <div className="flex flex-col gap-2 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => setSelectedLayoutComponentId('none')}
                  className={`rounded-md border px-2.5 py-2 text-left text-[12px] transition ${
                    selectedLayoutComponentId === 'none' ? 'border-accent bg-accent/10 text-text' : 'border-border bg-panel-2 text-text-2 hover:border-border-strong'
                  }`}
                >
                  No layout — start with a blank content area
                </button>

                {LAYOUT_ROLE_ORDER.filter((role) => (detectedLayoutGroups[role]?.length ?? 0) > 0).map((role) => (
                  <div key={role}>
                    <div className="mb-1 mt-1 text-[9.5px] font-semibold uppercase tracking-wide text-text-3">{LAYOUT_ROLE_LABEL[role]}</div>
                    <div className="flex flex-col gap-1.5">
                      {(detectedLayoutGroups[role] ?? []).map((component) => (
                        <button
                          key={component.id}
                          type="button"
                          onClick={() => setSelectedLayoutComponentId(component.id)}
                          className={`rounded-md border px-2.5 py-2 text-left transition ${
                            selectedLayoutComponentId === component.id ? 'border-accent bg-accent/10' : 'border-border bg-panel-2 hover:border-border-strong'
                          }`}
                        >
                          <div className="text-[12px] font-medium text-text">{component.name}</div>
                          <div className="mt-0.5 truncate font-mono text-[9.5px] text-text-3">{component.source.filePath}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'configure' && (layoutSource === 'clone' || layoutSource === 'pattern') && (
            <div className="flex min-h-0 flex-1 flex-col">
              <PagePicker pages={projectModel.pages} selectedId={selectedPage?.id ?? null} onSelect={(page) => void selectPatternPage(page)} />
              {layoutSource === 'pattern' && selectedPage && (
                <div className="mt-3 rounded-md border border-border bg-panel-2 p-2.5 text-[11px]">
                  {patternLoading ? (
                    <div className="flex items-center gap-1.5 text-text-3">
                      <Loader2 size={12} className="animate-spin" />
                      Scanning "{selectedPage.name}" for layout wrappers…
                    </div>
                  ) : patternError ? (
                    <div className="flex items-center gap-1.5 text-danger">
                      <AlertCircle size={12} />
                      {patternError}
                    </div>
                  ) : patternPreview && patternPreview.wrappers.length > 0 ? (
                    <div className="text-text-2">
                      Found {patternPreview.wrappers.length} layout wrapper{patternPreview.wrappers.length === 1 ? '' : 's'}:{' '}
                      {patternPreview.wrappers.map((w) => `${w.label} (${LAYOUT_ROLE_LABEL[w.role]})`).join(', ')}. The rest of this page's
                      content will be dropped — only these wrappers plus a blank content area carry over.
                    </div>
                  ) : (
                    <div className="text-text-3">No layout wrapper components detected among this page's top-level elements — this pattern will just be a blank content area.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'details' && (
            <div className="flex flex-col gap-3.5">
              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Name *</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Payment Overview"
                  className="w-full rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[12.5px] text-text outline-none placeholder:text-text-3 focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this page for?"
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-[12px] text-text outline-none placeholder:text-text-3 focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Suggested Route</label>
                <input
                  value={suggestedRoute}
                  onChange={(e) => setSuggestedRoute(e.target.value)}
                  placeholder="/payments/overview"
                  className="w-full rounded-md border border-border bg-panel-2 px-2.5 py-1.5 font-mono text-[12px] text-text outline-none placeholder:text-text-3 focus:border-accent"
                />
                <div className="mt-1 text-[10px] text-text-3">Not written to the app's routes — for reference only.</div>
              </div>

              <div>
                <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Initial Viewport</label>
                <div className="flex gap-1.5">
                  {VIEWPORTS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setViewport(id)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11.5px] font-medium transition ${
                        viewport === id ? 'border-accent bg-accent/15 text-accent-2' : 'border-border bg-panel-2 text-text-2 hover:text-text'
                      }`}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {submitError && (
                <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  {submitError}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
          {step === 'configure' && (
            <button
              type="button"
              disabled={!canContinueFromConfigure}
              onClick={() => setStep('details')}
              className="rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          )}
          {step === 'details' && (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              className="flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting && <Loader2 size={13} className="animate-spin" />}
              Create Page
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
