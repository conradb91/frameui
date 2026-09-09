/**
 * Design Model spec §3 "runtime observation" — the second source of truth
 * alongside static source parsing. A `CapturedElement` describes what a
 * real element in the running application actually rendered as (dimensions,
 * a handful of computed styles), never what its source *implies* it might
 * render as — so this is a deliberately separate type family from
 * `PageStructureItem` (static parsing) rather than a shared/unified shape.
 */
export interface CapturedElement {
  tag: string
  id?: string
  classes?: string
  /** Direct text-node content only, truncated — never descendant text, and
   * never a template expression's source (there is none here; this is
   * already-rendered output). */
  textPreview?: string
  rect: { x: number; y: number; width: number; height: number }
  /** A curated allowlist of computed style properties (box/layout, flexbox,
   * grid, spacing, typography, visual — see `captureScript.ts`'s
   * `STYLE_PROPERTIES`), not every computed style. A `Record` rather than a
   * fixed interface so the allowlist can grow in a later slice without
   * another type change. */
  styles: Record<string, string>
  /** `role`, every `aria-*` attribute present, and `alt` on `<img>` — the
   * raw accessibility-relevant attributes, not a computed accessible
   * name/role (spec §3 "ARIA information"). Omitted when none are present. */
  aria?: Record<string, string>
  children: CapturedElement[]
}

export interface CapturedPage {
  id: string
  projectId: string
  /** The webview's real URL at capture time — not yet matched against any
   * `RoutePattern` (spec §4, later work). */
  url: string
  capturedAt: string
  root: CapturedElement
  /** Set once `capture.saveScreenshot` succeeds — the file lives at
   * `<userData>/workspace/capture-screenshots/<projectId>/<screenshotFileName>`.
   * Absent when the screenshot step failed or hasn't run. */
  screenshotFileName?: string
}
