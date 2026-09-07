import { useEffect, useState } from 'react'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { useFlowStore } from '../../state/flowStore'
import { LivePreviewPanel } from '../../components/project/LivePreviewPanel'
import { FrameMark, ChevronRightIcon } from '../../components/icons/icons'
import type { SupportLevel } from '@shared/types/projectIndex'
import type { StyleTokens, StyleToken } from '@shared/types/styleTokens'

const SUPPORT_LABEL: Record<SupportLevel, string> = {
  supported: 'Supported',
  partial: 'Partial Support',
  'inspect-only': 'Inspect Only',
}
const SUPPORT_COLOR: Record<SupportLevel, string> = {
  supported: 'text-success border-success/30 bg-success/10',
  partial: 'text-warning border-warning/30 bg-warning/10',
  'inspect-only': 'text-danger border-danger/30 bg-danger/10',
}

export function ProjectSummaryView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const indexing = useProjectStore((s) => s.indexing)
  const fetchIndex = useProjectStore((s) => s.fetchIndex)
  const reindex = useProjectStore((s) => s.reindex)
  const closeProject = useProjectStore((s) => s.closeProject)
  const setView = useUiStore((s) => s.setView)

  const flowSummaries = useFlowStore((s) => s.summaries)
  const loadFlowSummaries = useFlowStore((s) => s.loadSummaries)
  const createFlow = useFlowStore((s) => s.createFlow)
  const openFlow = useFlowStore((s) => s.openFlow)
  const [creatingFlow, setCreatingFlow] = useState(false)
  const [newFlowName, setNewFlowName] = useState('')

  useEffect(() => {
    void fetchIndex()
  }, [fetchIndex])

  useEffect(() => {
    if (activeProject) void loadFlowSummaries(activeProject.id)
  }, [activeProject, loadFlowSummaries])

  useEffect(() => {
    const unsubscribe = window.frameui.project.onFileChanged(() => {
      void reindex()
    })
    return unsubscribe
  }, [reindex])

  async function handleChangeProject() {
    await closeProject()
    setView('open-project')
  }

  async function handleCreateFlow() {
    if (!activeProject || !newFlowName.trim()) return
    const flow = await createFlow(activeProject.id, newFlowName.trim())
    setCreatingFlow(false)
    setNewFlowName('')
    await openFlow(activeProject.id, flow.id)
    setView('flow-workspace')
  }

  async function handleOpenFlow(flowId: string) {
    if (!activeProject) return
    await openFlow(activeProject.id, flowId)
    setView('flow-workspace')
  }

  if (!activeProject) {
    return null
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Top bar */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-raised px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-gradient-to-br from-[#9385FF] to-[#6C58E8] text-white">
            <FrameMark className="h-[13px] w-[13px]" />
          </div>
          <span className="text-[13px] font-semibold text-text-2">FrameUI</span>
          <ChevronRightIcon className="mx-0.5 h-3 w-3 text-text-3" />
          <span className="font-mono text-[13px] font-semibold text-text">{activeProject.name}</span>
        </div>
        <button
          type="button"
          onClick={() => void handleChangeProject()}
          className="text-[12.5px] text-text-2 hover:text-text"
        >
          Change Project
        </button>
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-end justify-between px-14 pb-5 pt-8">
        <div>
          {activeIndex && (
            <div className="mb-2.5 flex items-center gap-2">
              <span
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${SUPPORT_COLOR[activeIndex.supportLevel]}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {SUPPORT_LABEL[activeIndex.supportLevel]}
              </span>
              <span className="text-xs text-text-3">
                Scanned {activeIndex.scannedFileCount.toLocaleString()} files in {(activeIndex.scanDurationMs / 1000).toFixed(1)}s
              </span>
            </div>
          )}
          <h1 className="text-[26px] font-bold tracking-[-0.4px]">
            {indexing && !activeIndex ? 'Scanning project…' : `${activeProject.name} is ready to design`}
          </h1>
          <p className="mt-2 max-w-[560px] text-[13.5px] text-text-2">
            Confirm FrameUI understood the repo below, then start a flow using these real components and styles.
          </p>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => void reindex()}
            disabled={indexing}
            className="rounded-lg border border-border bg-panel-2 px-3.5 py-2.5 text-[12.5px] font-semibold text-text-2 hover:text-text disabled:opacity-60"
          >
            {indexing ? 'Scanning…' : 'Rescan'}
          </button>
          {creatingFlow ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateFlow()
                  if (e.key === 'Escape') setCreatingFlow(false)
                }}
                placeholder="Flow name, e.g. Customer Onboarding"
                className="w-64 rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-[13px] text-text outline-none focus:border-accent-2"
              />
              <button
                type="button"
                onClick={() => void handleCreateFlow()}
                disabled={!newFlowName.trim()}
                className="rounded-lg border border-accent bg-gradient-to-b from-[#8676F4] to-[#7461EE] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
              >
                Create
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingFlow(true)}
              className="rounded-lg border border-accent bg-gradient-to-b from-[#8676F4] to-[#7461EE] px-4 py-2.5 text-[13px] font-semibold text-white"
            >
              Create Flow
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {!activeIndex ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-3">
          {indexing ? 'Reading pages, components and structure…' : 'No scan data yet.'}
        </div>
      ) : (
        <div className="flex flex-1 gap-6 overflow-hidden px-14 pb-10">
          <div className="flex w-[420px] shrink-0 flex-col gap-3.5 overflow-y-auto pb-2">
            <div className="grid grid-cols-2 gap-3.5">
              <Stat label="Framework" value={activeIndex.framework === 'react' ? 'React' : 'Unrecognized'} />
              <Stat label="Language" value={capitalize(activeIndex.language)} />
              <Stat label="Bundler" value={activeIndex.bundler === 'unknown' ? 'Unrecognized' : capitalize(activeIndex.bundler)} />
              <Stat label="Route Style" value={routeStyleLabel(activeIndex.routerStyle)} />
              <Stat label="Pages Found" value={`${activeIndex.pages.length} pages`} />
              <Stat label="Components" value={`${activeIndex.components.length} components`} />
            </div>
            <LivePreviewPanel devCommand={activeIndex.devCommand} />
            {flowSummaries.length > 0 && (
              <div className="rounded-xl border border-border bg-panel p-4">
                <div className="mb-2.5 text-[11px] text-text-3">Flows</div>
                <div className="flex flex-col gap-1.5">
                  {flowSummaries.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => void handleOpenFlow(f.id)}
                      className="flex items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    >
                      <span className="text-[12.5px] font-medium text-text">{f.name}</span>
                      <span className="text-[11px] text-text-3">{f.screenCount} screens</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <StyleTokensPanel tokens={activeIndex.styleTokens} />
          </div>

          <div className="flex flex-1 flex-col gap-3.5 overflow-hidden">
            <ListPanel title="Detected Pages" count={activeIndex.pages.length}>
              {activeIndex.pages.length === 0 ? (
                <EmptyRow>No pages detected under a conventional pages/app directory.</EmptyRow>
              ) : (
                activeIndex.pages.map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                    <span className="flex-1 truncate text-[13px]">{p.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-text-3">{p.route ?? p.filePath}</span>
                  </div>
                ))
              )}
            </ListPanel>

            <ListPanel title="Detected Components" count={activeIndex.components.length}>
              {activeIndex.components.length === 0 ? (
                <EmptyRow>No exported components detected.</EmptyRow>
              ) : (
                activeIndex.components.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                    <span className="h-2 w-2 shrink-0 rounded-sm bg-accent" />
                    <span className="flex-1 truncate text-[13px]">{c.name}</span>
                    <span className="shrink-0 truncate font-mono text-[11px] text-text-3">{c.filePath}</span>
                  </div>
                ))
              )}
            </ListPanel>
          </div>
        </div>
      )}
    </div>
  )
}

const SOURCE_LABEL: Record<StyleTokens['source'], string> = {
  'tailwind-v3': 'Tailwind CSS (config)',
  'tailwind-v4': 'Tailwind CSS (@theme)',
  'css-custom-properties': 'CSS custom properties',
  none: 'No style tokens detected',
}

function ConfidenceTag({ confidence }: { confidence: StyleToken['confidence'] }) {
  return confidence === 'full' ? (
    <span className="rounded px-1 py-px text-[8.5px] font-bold tracking-wide text-accent-2">PROJECT</span>
  ) : (
    <span className="rounded px-1 py-px text-[8.5px] font-bold tracking-wide text-warning">DEFAULT</span>
  )
}

function StyleTokensPanel({ tokens }: { tokens: StyleTokens }) {
  const isEmpty = tokens.colors.length + tokens.spacing.length + tokens.radius.length + tokens.breakpoints.length === 0

  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] text-text-3">Style Tokens</span>
        <span className="font-mono text-[10.5px] text-text-3">{SOURCE_LABEL[tokens.source]}</span>
      </div>

      {isEmpty ? (
        <div className="py-2 text-[12px] text-text-3">
          No Tailwind config or CSS custom properties found — colours, spacing and radius won't be labeled "Project"
          in the designer.
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {tokens.colors.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] text-text-3">Colours</div>
              <div className="flex flex-wrap gap-2">
                {tokens.colors.slice(0, 10).map((t) => (
                  <div key={t.name} className="w-[52px]">
                    <div
                      className="h-7 w-full rounded-md border border-border"
                      style={{ background: t.value || '#1b1b20' }}
                      title={t.value}
                    />
                    <div className="mt-1 truncate font-mono text-[9.5px] text-text-3" title={t.name}>
                      {t.name}
                    </div>
                    <ConfidenceTag confidence={t.confidence} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {tokens.radius.length > 0 && (
            <TokenChipRow label="Radius" items={tokens.radius} />
          )}
          {tokens.spacing.length > 0 && (
            <TokenChipRow label="Spacing" items={tokens.spacing.slice(0, 8)} />
          )}
          {tokens.breakpoints.length > 0 && (
            <TokenChipRow label="Breakpoints" items={tokens.breakpoints} />
          )}
        </div>
      )}
    </div>
  )
}

function TokenChipRow({ label, items }: { label: string; items: StyleToken[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] text-text-3">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((t) => (
          <span
            key={t.name}
            className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 font-mono text-[10.5px] text-text-2"
          >
            {t.name}
            {t.value && <span className="text-text-3">· {t.value}</span>}
            <ConfidenceTag confidence={t.confidence} />
          </span>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-2 text-[11px] text-text-3">{label}</div>
      <div className="text-[15px] font-semibold">{value}</div>
    </div>
  )
}

function ListPanel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[12.5px] font-semibold">{title}</span>
        <span className="font-mono text-[11px] text-text-3">{count}</span>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-[12px] text-text-3">{children}</div>
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function routeStyleLabel(style: string): string {
  switch (style) {
    case 'next-app':
      return 'Next App Router'
    case 'next-pages':
      return 'Next Pages Router'
    case 'conventional':
      return 'Conventional'
    default:
      return 'Unrecognized'
  }
}
