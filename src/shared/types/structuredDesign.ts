import type { TextStyleRun } from './richText'

/**
 * The "FrameUI Design Model" from docs/CAPTURE_ENGINE_REBUILD_SPEC.md §36 —
 * Stage 2 of the capture-engine rebuild. Deliberately independent of, and
 * unrelated to, the existing `VisualObject`/`VisualPage` types in
 * `visualDesign.ts` (today's SVG-shape-oriented capture output), the
 * hand-authored `DesignNode` tree in `designNode.ts`, and the static
 * source-derived `DesignIRNode` in `designIR.ts` — prefixed `Structured*`
 * throughout so it can't be confused with any of those three.
 *
 * Nothing in this file is consumed by the renderer yet ("Create captured
 * documents without displaying them to users yet" — spec §39 Stage 2). Some
 * fields exist in the shape only, deliberately left unpopulated by Stage 2's
 * compiler because the logic that would populate them belongs to a later,
 * explicitly separate stage — see the comment on each such field.
 */

/** Spec §6's taxonomy, stated as "at least" — a floor, not exhaustive.
 * 'Link' is one addition beyond the spec's literal list: collapsing <a>
 * into 'Button' (as the legacy VisualKind union does) loses real
 * information this richer schema exists to preserve. 'ComponentInstance'
 * and 'RasterFallback' exist for forward compatibility only — Stage 2's
 * compiler never assigns them (that's stage 8/9 logic). */
export type StructuredNodeType =
  | 'Frame'
  | 'Section'
  | 'Container'
  | 'Group'
  | 'ComponentInstance'
  | 'Text'
  | 'Image'
  | 'SVG'
  | 'Icon'
  | 'Shape'
  | 'Divider'
  | 'Input'
  | 'Button'
  | 'Link'
  | 'UnknownWebElement'
  | 'RasterFallback'

export type StructuredLayoutMode = 'free' | 'stack' | 'grid'

/** Describes how THIS node lays out its children — orthogonal to
 * `StructuredConstraints.position`, which describes how this node is
 * positioned within ITS parent. Populated purely from
 * `CAPTURED_STYLE_PROPERTIES`, already captured today — no new capture-side
 * work needed for this schema. */
export interface StructuredLayout {
  mode: StructuredLayoutMode
  /** stack only, from flexDirection */
  direction?: 'horizontal' | 'vertical'
  reverse?: boolean
  wrap?: boolean
  /** alignItems */
  align?: string
  /** justifyContent */
  justify?: string
  alignContent?: string
  gap?: number
  gridTemplateColumns?: string
  gridTemplateRows?: string
  gridAutoFlow?: string
  padding?: { top: number; right: number; bottom: number; left: number }
  minWidth?: number
  maxWidth?: number
}

/** Raw computed `position` only — NOT an edge-pinning/anchor inference
 * (the way legacy `VisualObject.layout.constraints` is). Anchor inference
 * is an editing-time concern for a later stage (Moveable), not a
 * capture-time one. */
export interface StructuredConstraints {
  position: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky' | string
}

export interface StructuredAppearance {
  /** Recovered CSS affine transform on an untransformed measured border box. */
  transform?: string
  transformOrigin?: string
  zIndex?: number
  backgroundColor?: string
  backgroundImage?: string
  backgroundSize?: string
  backgroundPosition?: string
  backgroundRepeat?: string
  backgroundBlendMode?: string
  backgroundOrigin?: string
  backgroundClip?: string
  clipPath?: string
  maskImage?: string
  maskSize?: string
  maskPosition?: string
  maskRepeat?: string
  maskMode?: string
  maskComposite?: string
  filter?: string
  backdropFilter?: string
  mixBlendMode?: string
  isolation?: string
  overflowClipMargin?: string

  objectPosition?: string
  border?: { width: number; style?: string; color?: string }
  /** top-left, top-right, bottom-right, bottom-left — same order as legacy
   * `VisualObject.radius`. */
  radius: [number, number, number, number]
  boxShadow?: string
  opacity: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  objectFit?: 'cover' | 'contain' | 'fill'
  blur?: number
  rotation: number
  /** overflow hidden/clip/scroll/auto — boolean only. Full clip-path/mask
   * fidelity (spec §26) is not attempted by this schema. */
  clip: boolean
  clipX?: boolean
  clipY?: boolean
  accentColor?: string
  colorScheme?: string
}

export interface StructuredTypography {
  gradient?: import('./richText').TextGradient | null
  captureLines?: {text:string;start?:number;x:number;y:number;width:number;height:number}[]
  textOverflow?: string
  whiteSpace?: string
  fontStyle?: string
  textWrap?: string
  fontFeatureSettings?: string
  fontVariationSettings?: string
  fontOpticalSizing?: string
  fontKerning?: string
  fontStretch?: string
  wordSpacing?: string
  WebkitFontSmoothing?: string
  text: string
  /** Designer-applied character-range overrides; capture leaves this empty. */
  textRuns?: TextStyleRun[]
  fontFamily: string
  fontSize: number
  fontWeight: string
  lineHeight: number
  letterSpacing: number
  textAlign: string
  textDecoration?: string
  color?: string
}

export interface StructuredSource {
  tag: string
  domId?: string
  classes?: string
  /** data-frameui-source */
  file?: string
  /** componentHint, cleaned — informational only, NOT a `StructuredComponentBinding`. */
  component?: string
  /** captureSelector */
  selector?: string
  href?: string
  /** `img.src`/`video.poster`, only when it's a safe `data:image/...` URI —
   * same acceptance rule legacy `VisualObject.src` already uses. Without
   * this, an `Image`-type node has nothing to actually render. */
  imageSrc?: string
  /** Raw SVG presentation attributes carried forward verbatim for `SVG`/
   * `Shape`-type nodes (`d`, `points`, `cx`/`cy`/`r`/`rx`/`ry`, `x1`/`y1`/
   * `x2`/`y2`, and the root `<svg>`'s own `viewBox`) — deliberately not
   * reverse-engineered into a synthesized path string the way legacy's
   * `vector()` does; the eventual renderer re-emits real markup instead. */
  svgGeometry?: Record<string, string>
  control?: { type: 'text' | 'email' | 'password' | 'number' | 'range' | 'checkbox' | 'radio' | 'date' | 'time' | 'select' | 'textarea'; appearance?:string; options?:{value:string;label:string;disabled?:boolean}[]; placeholder?:string; placeholderColor?:string; placeholderOpacity?:number; value?: string; checked?: boolean; disabled?: boolean; min?: string; max?: string; step?: string }
}

/** Spec §10/§11: store both the raw browser value and the resolved
 * repository token. Stage 2 populates `.value` only — `.token` stays
 * `undefined` on every node until a later stage's repository style index
 * exists. Fixed, bounded property set, matching spec §9's "fixed capture
 * property set" instruction rather than every CSS property. */
export type TokenBindableProperty =
  | 'backgroundColor'
  | 'color'
  | 'borderColor'
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'padding'
  | 'margin'
  | 'gap'
  | 'borderRadius'
  | 'boxShadow'

export interface StructuredTokenBinding {
  value: string
  /** Deliberately never set by Stage 2's compiler. */
  token?: string
}

export type StructuredTokenBindings = Partial<Record<TokenBindableProperty, StructuredTokenBinding>>

/** Spec §30 — never populated by Stage 2's compiler (still true: `compile.ts`
 * always leaves this `undefined`). As of Stage 8 sub-slice 3, populated by a
 * post-compile resolution pass (`resolveComponents.ts`, mirroring how
 * `tokenBindings[x].token` is filled in by `resolveTokens.ts`) — an exact
 * match against the project's component index, the same algorithm
 * `designIde.handlers.ts`'s legacy pass already used to enrich
 * `VisualObject.source.file`. Always confidence `1` (exact match) or absent
 * entirely — no fuzzy/partial tiers exist. */
export interface StructuredComponentBinding {
  componentId: string
  variant?: Record<string, string>
  confidence: number
}

/** Spec §31 — left entirely undefined by Stage 2's compiler. Rather than one
 * atomic "confidence" stage, Stage 8 ended up populating this field-by-field
 * across its own sub-slices (per this rebuild's standing "small bounded
 * slices" rule): `componentConfidence` is set by Stage 8 sub-slice 3
 * (`resolveComponents.ts`). `layoutConfidence`/`assetConfidence` remain
 * fully unpopulated. `fontConfidence`/`tokenConfidence` are ALSO still
 * unpopulated even though sub-slices 1-2 already resolve fonts/tokens
 * elsewhere on the node (`tokenBindings[x].token`, `StructuredFrame.fonts`)
 * — neither of those passes writes back to this per-node confidence bag.
 * Known, explicitly flagged gap, not fixed by sub-slice 3. */
export interface StructuredCaptureConfidence {
  layoutConfidence?: number
  componentConfidence?: number
  assetConfidence?: number
  fontConfidence?: number
  tokenConfidence?: number
}

export interface StructuredNode {
  /** A fresh `crypto.randomUUID()` per compile, not derived from any stable
   * browser identifier — `CapturedElement` carries no CDP backendNodeId
   * anywhere today. Fine for Stage 2 (nothing needs cross-recapture
   * identity yet); a later incremental-recapture stage will need its own
   * correlation key, most likely `source.selector`. */
  id: string
  type: StructuredNodeType
  name: string
  parentId: string | null
  children: StructuredNode[]
  bounds: { x: number; y: number; width: number; height: number }
  layout: StructuredLayout
  appearance: StructuredAppearance
  /** Text nodes only. */
  typography?: StructuredTypography
  source: StructuredSource
  tokenBindings?: StructuredTokenBindings
  /** Always `undefined` in Stage 2. */
  designProposal?: { kind:'new'|'variant'; reason:string; componentId?:string }
  componentBinding?: StructuredComponentBinding
  constraints: StructuredConstraints
  /** Always `true` — invisible nodes are dropped at compile time entirely,
   * the same way `normalizeVisual` already drops them, so there is no
   * dead-but-present node to represent `false`. */
  visibility: boolean
  /** Always `false` in Stage 2 — locking is an editor concept and nothing
   * is editable yet. */
  locked: boolean
  /** Always `undefined` in Stage 2. */
  captureConfidence?: StructuredCaptureConfidence
}

export interface StructuredCaptureMetadata {
  capturedAt: string
  /** Which capture technique produced this frame — always `'domSnapshot'`
   * today, room for a future alternative technique without a schema change. */
  engine: 'domSnapshot' | 'design'
  structuredNodeCount: number
  durationMs: number
  /** Stage 4 (spec §20) — populated asynchronously, after the rest of this
   * document is already on disk, by a fire-and-forget render+Pixelmatch
   * follow-up; stays `undefined` until that completes (or forever, if it
   * fails). A high `diffPercent` is not necessarily "the renderer is
   * wrong" — Stage 2 deliberately leaves fonts unembedded (stage 8's job),
   * so any page using a real web font will show a real, expected diff here
   * purely from the font-fallback mismatch. */
  visualMatch?: { diffPixels: number; totalPixels: number; diffPercent: number }
}

/** Stage 8 (spec §13) — same shape as legacy `VisualPage['fonts']` entries,
 * defined independently rather than imported (visualDesign.ts already
 * imports `StructuredFrame` from this file; importing back would be
 * circular, and duplicating a 4-field shape matches this rebuild's
 * standing "legacy and V2 independent" rule anyway). `data` is always a
 * `data:` URI — the same already-fetched bytes `captureResources()`
 * downloads for the legacy pipeline, not a live/unstable browser URL. */
export interface StructuredFont {
  unicodeRange?: string
  stretch?: string
  family: string
  weight: string
  style: string
  data: string
}

export interface StructuredFrame {
  id: string
  name: string
  /** e.g. "1440x1024" */
  viewport: string
  sourceRoute: string
  /** Spec §4's multi-state concept — no state input exists at the Stage 2
   * call sites yet, so this is always left `undefined`. */
  sourceState?: string
  width: number
  height: number
  children: StructuredNode[]
  captureMetadata: StructuredCaptureMetadata
  fonts?: StructuredFont[]
}

export interface StructuredDesignDocument {
  version: 1
  projectId: string
  /** Synthesized (`crypto.randomUUID()`) in Stage 2 — there is no real
   * open-design context available at the main-process capture call sites
   * without extending the IPC contract, which Stage 2 deliberately leaves
   * untouched. Not tied to any real saved `VisualDocument.id`. */
  designId: string
  frames: StructuredFrame[]
  /** Deliberately empty in Stage 2 — spec §12's asset resolver (mapping a
   * captured asset back to a stable repository-relative record) is later
   * stage work, not this one. */
  assets: []
  /** Deliberately empty in Stage 2 — spec §13's font resolver is later
   * stage work. Raw font bytes are already available via
   * `captureResources()` at both call sites, but conflating "bytes already
   * on hand" with "a resolved Font record" blurs the boundary the later
   * stage is meant to own. */
  fonts: []
  tokens: []
  sources: []
}
