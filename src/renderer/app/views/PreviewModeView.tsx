import { useMemo } from 'react'
import { usePreviewStore } from '../../state/previewStore'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { PreviewRenderNode } from '../../components/designer/PreviewRenderNode'
import type { Breakpoint } from '@shared/types/designNode'

const BREAKPOINT_WIDTH: Record<Breakpoint, number> = { desktop: 1040, tablet: 768, mobile: 375 }

export function PreviewModeView() {
  const flow = usePreviewStore((s) => s.flow)
  const currentNodeId = usePreviewStore((s) => s.currentNodeId)
  const currentTree = usePreviewStore((s) => s.currentTree)
  const history = usePreviewStore((s) => s.history)
  const breakpoint = usePreviewStore((s) => s.breakpoint)
  const setBreakpoint = usePreviewStore((s) => s.setBreakpoint)
  const goTo = usePreviewStore((s) => s.goTo)
  const back = usePreviewStore((s) => s.back)
  const stop = usePreviewStore((s) => s.stop)
  const activeProject = useProjectStore((s) => s.activeProject)
  const setView = useUiStore((s) => s.setView)

  const currentNode = useMemo(() => flow?.nodes.find((n) => n.id === currentNodeId) ?? null, [flow, currentNodeId])
  const outgoingEdges = useMemo(() => flow?.edges.filter((e) => e.sourceNodeId === currentNodeId) ?? [], [flow, currentNodeId])
  const positionIndex = flow ? flow.nodes.findIndex((n) => n.id === currentNodeId) : -1

  function handleExit() {
    stop()
    setView('flow-workspace')
  }

  if (!flow || !activeProject) return null

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#050506]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.028) 1px, transparent 1px)', backgroundSize: '26px 26px' }}
      />

      {/* Minimal chrome */}
      <div className="absolute left-6 top-5 flex items-center gap-2 rounded-full border border-border bg-panel-2/80 px-3.5 py-1.5 backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />
        <span className="text-[12px] font-semibold text-accent-2">Preview Mode</span>
        <span className="border-l border-border pl-2 font-mono text-[10.5px] text-text-3">
          {BREAKPOINT_WIDTH[breakpoint]}px
        </span>
      </div>

      <div className="absolute right-6 top-5 flex items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-full border border-border bg-panel-2/80 p-0.5 backdrop-blur">
          {(['desktop', 'tablet', 'mobile'] as const).map((bp) => (
            <button
              key={bp}
              type="button"
              onClick={() => setBreakpoint(bp)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${
                breakpoint === bp ? 'bg-accent/20 text-accent-2' : 'text-text-2'
              }`}
            >
              {bp}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleExit}
          className="rounded-full border border-border bg-panel-2/80 px-3.5 py-1.5 text-[12px] font-semibold text-text-2 backdrop-blur hover:text-text"
        >
          Exit Preview
        </button>
      </div>

      {/* Rendered screen */}
      <div className="flex h-full items-center justify-center p-16">
        <div
          className="max-h-full overflow-y-auto rounded-xl border border-border bg-panel p-10 shadow-2xl transition-[width] duration-200"
          style={{ width: BREAKPOINT_WIDTH[breakpoint] }}
        >
          {currentTree && <PreviewRenderNode node={currentTree} breakpoint={breakpoint} />}
        </div>
      </div>

      {/* Floating flow navigation */}
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full border border-border bg-panel-2/90 py-2 pl-2 pr-3 backdrop-blur">
        <button
          type="button"
          disabled={history.length === 0}
          onClick={() => void back(activeProject.id)}
          className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-text-2 disabled:opacity-30"
        >
          ← Back
        </button>

        <div className="flex items-center gap-1.5">
          {flow.nodes.map((n, i) => (
            <span key={n.id} className={`h-1.5 rounded-full transition-all ${i === positionIndex ? 'w-4 bg-accent-2' : 'w-1.5 bg-white/20'}`} />
          ))}
        </div>

        <span className="whitespace-nowrap font-mono text-[11.5px] text-text-3">
          {currentNode?.name} {positionIndex + 1}/{flow.nodes.length}
        </span>

        {outgoingEdges.length === 0 ? (
          <span className="whitespace-nowrap px-3 py-1.5 text-[12px] text-text-3">End of flow</span>
        ) : (
          outgoingEdges.map((edge) => (
            <button
              key={edge.id}
              type="button"
              onClick={() => void goTo(edge.targetNodeId, activeProject.id)}
              className="whitespace-nowrap rounded-full bg-gradient-to-b from-[#8676F4] to-[#7461EE] px-3.5 py-1.5 text-[12.5px] font-semibold text-white"
            >
              {edge.label || 'Continue'} →
            </button>
          ))
        )}
      </div>
    </div>
  )
}
