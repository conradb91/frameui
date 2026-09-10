import { useEffect, useState } from 'react'
import { useFlowStore } from '../../state/flowStore'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { serializeScreenToSvg } from '@core/export/svgSerializer'
import { serializeFlowToSvg } from '@core/export/flowSvgSerializer'
import { svgToPngBase64 } from '../../lib/svgToPngBase64'
import { buildReviewPdfHtml } from '../../lib/buildReviewPdfHtml'
import { createDefaultTree } from '@core/design-model/defaultTree'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import { FeatureExportPanelView } from './FeatureExportPanelView'

// Matches ScreenDesignerView's breakpoint widths — a project's actual
// detected breakpoints (RSP-02) aren't wired into export sizing yet; see
// the punch list. This at least makes EXP-04's device picker real instead
// of desktop-only.
const BREAKPOINT_WIDTH: Record<Breakpoint, number> = { desktop: 900, tablet: 768, mobile: 375 }
const BREAKPOINT_LABEL: Record<Breakpoint, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' }

export function ExportPanelView() {
  const activeFeatureId = useUiStore((s) => s.activeFeatureId)
  if (activeFeatureId) return <FeatureExportPanelView />
  return <LegacyExportPanelView />
}

function LegacyExportPanelView() {
  const activeFlow = useFlowStore((s) => s.activeFlow)
  const activeProject = useProjectStore((s) => s.activeProject)
  const setView = useUiStore((s) => s.setView)

  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const [device, setDevice] = useState<Breakpoint>('desktop')
  const [busy, setBusy] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [pdfFailed, setPdfFailed] = useState(false)

  useEffect(() => {
    if (!activeFlow) return
    setChecked(new Set(activeFlow.nodes.map((n) => n.id)))
    setPrimaryId(activeFlow.nodes[0]?.id ?? null)
  }, [activeFlow])

  if (!activeFlow || !activeProject) return null

  async function loadTree(screenId: string): Promise<DesignNode> {
    const draft = await window.frameui.workspace.getScreenDraft(activeProject!.id, screenId)
    return draft?.tree ?? createDefaultTree(screenId)
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCopySvg() {
    if (!primaryId) return
    setBusy('copy')
    try {
      const tree = await loadTree(primaryId)
      const { svg } = serializeScreenToSvg(tree, device, BREAKPOINT_WIDTH[device])
      try {
        await navigator.clipboard.writeText(svg)
        setLastResult('Copied SVG to clipboard.')
      } catch {
        // spec §31: clipboard blocked -> offer Download SVG immediately,
        // rather than a dead-end error.
        setLastResult('Clipboard access was blocked — use Download SVG instead.')
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleDownloadSvg() {
    if (!primaryId) return
    setBusy('svg')
    try {
      const node = activeFlow!.nodes.find((n) => n.id === primaryId)!
      const tree = await loadTree(primaryId)
      const { svg } = serializeScreenToSvg(tree, device, BREAKPOINT_WIDTH[device])
      const result = await window.frameui.export.saveSvg(svg, `${node.name}.svg`)
      setLastResult(result.ok ? `Saved ${result.filePath}` : 'Download cancelled.')
    } finally {
      setBusy(null)
    }
  }

  async function handleDownloadPng() {
    if (!primaryId) return
    setBusy('png')
    try {
      const node = activeFlow!.nodes.find((n) => n.id === primaryId)!
      const tree = await loadTree(primaryId)
      const { svg, width, height } = serializeScreenToSvg(tree, device, BREAKPOINT_WIDTH[device])
      const base64 = await svgToPngBase64(svg, width, height)
      const result = await window.frameui.export.savePng(base64, `${node.name}.png`)
      setLastResult(result.ok ? `Saved ${result.filePath}` : 'Download cancelled.')
    } finally {
      setBusy(null)
    }
  }

  /** spec §31: "PDF unavailable -> offer PNG fallback." Downloads the flow
   * overview plus every checked screen as PNGs — same content the PDF
   * would have contained, just as separate raster files. */
  async function handlePdfFallbackPngs() {
    setBusy('pdf-fallback')
    try {
      const { svg: flowSvg, width: flowWidth, height: flowHeight } = serializeFlowToSvg(activeFlow!)
      const flowBase64 = await svgToPngBase64(flowSvg, flowWidth, flowHeight)
      await window.frameui.export.savePng(flowBase64, `${activeFlow!.name} — Flow.png`)
      const checkedNodes = activeFlow!.nodes.filter((n) => checked.has(n.id))
      for (const n of checkedNodes) {
        const tree = await loadTree(n.id)
        const { svg, width, height } = serializeScreenToSvg(tree, device, BREAKPOINT_WIDTH[device])
        const base64 = await svgToPngBase64(svg, width, height)
        await window.frameui.export.savePng(base64, `${n.name}.png`)
      }
      setLastResult(`Saved ${checkedNodes.length + 1} PNG files.`)
    } finally {
      setBusy(null)
    }
  }

  async function handleFlowImage() {
    setBusy('flow')
    try {
      const { svg, width, height } = serializeFlowToSvg(activeFlow!)
      const base64 = await svgToPngBase64(svg, width, height)
      const result = await window.frameui.export.savePng(base64, `${activeFlow!.name} — Flow.png`)
      setLastResult(result.ok ? `Saved ${result.filePath}` : 'Download cancelled.')
    } finally {
      setBusy(null)
    }
  }

  async function handleReviewPdf() {
    setBusy('pdf')
    setPdfFailed(false)
    try {
      const checkedNodes = activeFlow!.nodes.filter((n) => checked.has(n.id))
      const screens = await Promise.all(
        checkedNodes.map(async (n) => {
          const tree = await loadTree(n.id)
          const { svg } = serializeScreenToSvg(tree, device, BREAKPOINT_WIDTH[device])
          return { name: n.name, svg }
        }),
      )
      const { svg: flowSvg } = serializeFlowToSvg(activeFlow!)
      const html = buildReviewPdfHtml(activeFlow!.name, flowSvg, screens)
      const result = await window.frameui.export.generateReviewPdf(html, `${activeFlow!.name} — Review.pdf`)
      if (result.ok) {
        setLastResult(`Saved ${result.filePath}`)
      } else if (result.error) {
        setLastResult(`Failed: ${result.error}`)
        setPdfFailed(true)
      } else {
        setLastResult('Generation cancelled.')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-raised px-5">
        <div className="text-[13px] font-semibold text-text">Export — {activeFlow.name}</div>
        <button type="button" onClick={() => setView('flow-workspace')} className="text-[12.5px] text-text-2 hover:text-text">
          Close
        </button>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden p-4">
        {/* Screens & devices */}
        <div className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-panel">
          <div className="border-b border-border px-4 py-3 text-[12px] font-semibold tracking-wide text-text-3">Screens</div>
          <div className="flex-1 overflow-y-auto p-2">
            {activeFlow.nodes.map((n) => (
              <div key={n.id} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${primaryId === n.id ? 'bg-selected' : ''}`}>
                <input type="checkbox" checked={checked.has(n.id)} onChange={() => toggle(n.id)} />
                <button type="button" onClick={() => setPrimaryId(n.id)} className="flex-1 truncate text-left text-[12.5px] text-text-2 hover:text-text">
                  {n.name}
                </button>
                {primaryId === n.id && <span className="text-[12px] font-semibold text-accent-2">Active</span>}
              </div>
            ))}
          </div>
          <div className="border-t border-border px-4 py-2.5 text-[12px] text-text-3">
            Click a screen to make it "Active" for Copy/SVG/PNG. Checked screens go into the Review PDF.
          </div>
          <div className="border-t border-border p-3">
            <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-text-3">Device (EXP-04)</div>
            <div className="flex gap-1.5">
              {(Object.keys(BREAKPOINT_LABEL) as Breakpoint[]).map((bp) => (
                <button
                  key={bp}
                  type="button"
                  onClick={() => setDevice(bp)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] font-semibold ${
                    device === bp ? 'border-accent-2 bg-selected text-accent-2' : 'border-border bg-panel-2 text-text-2'
                  }`}
                >
                  {BREAKPOINT_LABEL[bp]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Output options */}
        <div className="flex flex-1 flex-col gap-3">
          <OutputRow
            title="Copy to Figma"
            description="Copies the active screen as SVG markup to your clipboard."
            actionLabel="Copy"
            onAction={handleCopySvg}
            busy={busy === 'copy'}
            disabled={!primaryId}
          />
          <OutputRow
            title="Download SVG"
            description="Vector file for the active screen — opens in Figma and other design tools."
            actionLabel="Download"
            onAction={handleDownloadSvg}
            busy={busy === 'svg'}
            disabled={!primaryId}
          />
          <OutputRow
            title="Download PNG"
            description="Raster image of the active screen for docs, chat and presentations."
            actionLabel="Download"
            onAction={handleDownloadPng}
            busy={busy === 'png'}
            disabled={!primaryId}
          />
          <OutputRow
            title="Review PDF"
            description="A print-ready PDF with the flow overview and every checked screen."
            actionLabel="Generate"
            onAction={handleReviewPdf}
            busy={busy === 'pdf'}
            disabled={checked.size === 0}
          />
          <OutputRow
            title="Flow Image"
            description="The whole flow canvas as one PNG — screens and connectors included."
            actionLabel="Download"
            onAction={handleFlowImage}
            busy={busy === 'flow'}
            disabled={false}
          />

          {pdfFailed && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-panel p-3.5">
              <div className="text-[12px] text-warning">PDF generation isn't available right now.</div>
              <button
                type="button"
                onClick={() => void handlePdfFallbackPngs()}
                disabled={busy === 'pdf-fallback'}
                className="shrink-0 rounded-lg border border-warning/40 bg-panel px-3 py-1.5 text-[12px] font-semibold text-warning disabled:opacity-50"
              >
                {busy === 'pdf-fallback' ? 'Working…' : 'Download PNGs instead'}
              </button>
            </div>
          )}

          {lastResult && <div className="mt-2 text-[12px] text-text-2">{lastResult}</div>}
        </div>
      </div>
    </div>
  )
}

function OutputRow({
  title,
  description,
  actionLabel,
  onAction,
  busy,
  disabled,
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  busy: boolean
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-panel p-3.5">
      <div className="flex-1">
        <div className="text-[13px] font-semibold text-text">{title}</div>
        <div className="mt-0.5 text-[12px] text-text-3">{description}</div>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled || busy}
        className="shrink-0 rounded-lg border border-accent bg-accent   px-3.5 py-2 text-[12px] font-semibold text-on-accent disabled:opacity-50"
      >
        {busy ? 'Working…' : actionLabel}
      </button>
    </div>
  )
}
