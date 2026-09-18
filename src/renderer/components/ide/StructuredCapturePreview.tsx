import { useEffect, useState } from 'react'
import { Bug } from 'lucide-react'
import { VisualSvg, FontDefinitions } from './VisualSvg'
import { StructuredFrameView } from './StructuredFrameView'
import { ModalBody, ModalError, ModalField, ModalHeader, ModalSection, ModalShell } from '../ui/Modal'

type CaptureSummary = Awaited<ReturnType<typeof window.frameui.design.listStructuredCaptures>>[number]

/**
 * Stage 3 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
 * "Render captured models beside the existing SVG output." A dev-only
 * debug view (only reachable from a command-palette entry gated on
 * `import.meta.env.DEV` — see `DesignIde.tsx`), not a live editor surface.
 * Shows the legacy `VisualObject`/SVG rendering of a capture next to the
 * new `StructuredFrame`/HTML-CSS rendering of the exact same capture, read
 * back from the debug files `design:captureCurrentState`/`design:capture`
 * already write. Stage 4 adds the objective half of that comparison — a
 * Pixelmatch diff-percentage and diff image, computed asynchronously after
 * capture, so it may not be present yet even for a capture with a legacy
 * comparison already saved.
 */
export function StructuredCapturePreview({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [captures, setCaptures] = useState<CaptureSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof window.frameui.design.loadStructuredCapture>>>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.frameui.design.listStructuredCaptures(projectId).then(setCaptures).catch((e) => setError(String(e)))
  }, [projectId])

  useEffect(() => {
    if (!selected) { setLoaded(null); return }
    void window.frameui.design.loadStructuredCapture(projectId, selected).then(setLoaded).catch((e) => setError(String(e)))
  }, [projectId, selected])

  const frame = loaded?.structured.frames[0]

  return (
    <ModalShell size="wide" variant="selection" onClose={onClose} closeOnBackdrop className="ide-structured-preview-dialog">
      <ModalHeader
        eyebrow="Developer tool"
        title="Structured capture preview"
        description="Compare the legacy SVG and structured HTML/CSS renderers for the same saved capture. Nothing here changes the design."
        icon={<Bug size={17} />}
        onClose={onClose}
      />
      <ModalBody>
        <ModalSection title="Capture">
          <div className="ide-structured-preview-picker">
          <ModalField label="Saved capture" hint="Captures without a legacy comparison cannot be selected.">
            <select aria-label="Capture" value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)}>
              <option value="">Select a capture…</option>
              {captures.map((c) => (
                <option key={c.baseName} value={c.baseName} disabled={!c.hasLegacy}>
                  {c.name} · {c.viewport} · {c.route}
                  {c.visualMatchPercent !== undefined ? ` · ${c.visualMatchPercent.toFixed(1)}% match` : ''}
                  {!c.hasLegacy ? ' (no legacy comparison saved)' : ''}
                </option>
              ))}
            </select>
          </ModalField>
          </div>
        </ModalSection>
        {error && <ModalError details={error}>The saved comparison could not be loaded. Choose another capture or create a fresh capture.</ModalError>}
        {frame && (
          <ModalSection title="Renderer comparison"><div className="ide-structured-preview-panes">
            <div className="ide-structured-preview-pane">
              <h3>Legacy (SVG)</h3>
              <div className="ide-structured-preview-frame" style={{ width: frame.width, height: frame.height }}>
                {loaded?.legacy ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`}>
                    <FontDefinitions fonts={loaded.legacy.fonts} />
                    <VisualSvg objects={loaded.legacy.objects} />
                  </svg>
                ) : (
                  <p>No legacy comparison saved for this capture.</p>
                )}
              </div>
            </div>
            <div className="ide-structured-preview-pane">
              <h3>New (HTML/CSS)</h3>
              <div className="ide-structured-preview-frame" style={{ width: frame.width, height: frame.height }}>
                <StructuredFrameView frame={frame} />
              </div>
            </div>
            {frame.captureMetadata.visualMatch ? (
              <div className="ide-structured-preview-pane">
                <h3>Pixel diff</h3>
                <p>
                  {(100 - frame.captureMetadata.visualMatch.diffPercent).toFixed(1)}% match — {frame.captureMetadata.visualMatch.diffPixels.toLocaleString()} of {frame.captureMetadata.visualMatch.totalPixels.toLocaleString()} px differ.
                  Fonts aren&rsquo;t embedded yet, so text-heavy pages will show a real, expected diff here.
                </p>
                {loaded?.images?.diff && (
                  <div className="ide-structured-preview-frame" style={{ width: frame.width, height: frame.height }}>
                    <img src={loaded.images.diff} alt="Pixel diff" width={frame.width} height={frame.height} />
                  </div>
                )}
              </div>
            ) : (
              <div className="ide-structured-preview-pane">
                <h3>Pixel diff</h3>
                <p>Not computed yet — the Pixelmatch comparison runs in the background after capture and may still be in progress.</p>
              </div>
            )}
          </div></ModalSection>
        )}
      </ModalBody>
    </ModalShell>
  )
}
