import type { SourceReference } from './model/sourceReference'
import type { Provenance } from './model/featureModel'

export type { Provenance }

/**
 * `editable`: fully understood — full visual editing.
 * `limited`: outer shape + an allowlisted safe-prop set understood,
 *   internals opaque — move/resize-as-unit/change exposed props/hide/
 *   duplicate/swap only.
 * `locked`: can't be safely mapped — view in context only.
 * Every primitive we insert ourselves is 'editable' by construction; the
 * other two levels come into play once real project components are
 * imported (existing-page drafts, a later phase).
 */
export type Editability = 'editable' | 'limited' | 'locked'

export type Breakpoint = 'desktop' | 'tablet' | 'mobile'

interface DesignNodeBase {
  id: string
  editability: Editability
  children: DesignNode[]
  /** Layers-panel hide (LAY-04) — hidden everywhere, all breakpoints. */
  hidden?: boolean
  /** Layers-panel lock (LAY-04) — blocks edits from the canvas/inspector. */
  locked?: boolean
  /** Per-breakpoint visibility override (RSP-03's "visibility" property),
   * inheriting from the base/desktop definition until explicitly set
   * (RSP-04) — absent means "same as desktop." This is the one responsive
   * override property implemented in this build; layout/spacing/typography
   * overrides per breakpoint are a documented later-phase extension of the
   * same mechanism. */
  responsiveHidden?: Partial<Record<Exclude<Breakpoint, 'desktop'>, boolean>>
  /** Where this node came from, shown throughout the Feature workspace
   * (spec Phase 15) — 'existing' for an untouched placeholder imported from
   * a real page, 'existing-modified' once a command mutates it,
   * 'new' for anything the designer inserted from scratch. Optional only
   * for backward compatibility with drafts persisted before this field
   * existed; every node created going forward sets it explicitly. */
  provenance?: Provenance
  /** Placement within a `GridNode` parent — ignored under any other parent
   * kind. 1-based, matching CSS grid-line numbering so values map directly
   * onto `grid-column`/`grid-row`. */
  gridPlacement?: {
    columnStart?: number
    columnSpan?: number
    rowStart?: number
    rowSpan?: number
  }
  /** Visual/box/typography overrides layered on top of each kind's fixed
   * rendering (spec Phase 10-12) — a single optional nested object rather
   * than dozens of top-level fields so the Layout Inspector (which reads
   * this) and the editor commands (which write it, via `SetStyle`) share
   * one contract. Every field absent means "use this kind's built-in
   * default," never a guessed value. Sizing/color/typography fields apply
   * loosely depending on `kind` — e.g. `fontSize` only visibly affects
   * text/heading/button — the Inspector decides which fields are relevant
   * to show for a given selection (spec Phase 12: "no generic property
   * list that shows irrelevant fields for every element"). */
  style?: NodeStyle
  /** Per-breakpoint layout/style overrides (spec Phase 18), generalizing
   * `responsiveHidden`'s existing "absent means inherit desktop" pattern to
   * every other layout-aware property instead of duplicating the whole
   * subtree per breakpoint. `responsiveHidden` stays separate/unchanged —
   * it's a narrower, already-working mechanism nothing here needs to
   * touch. Only the fields present in a breakpoint's override are applied;
   * everything else keeps inheriting from the base/desktop value. Fields
   * are a subset spanning every node kind (`gap`/`direction`/`align`/
   * `justify`/`wrap` for stacks, `columns`/`columnGap`/`rowGap` for grids,
   * `style` for anything) — a renderer only reads the ones relevant to the
   * node's own kind, same principle as `NodeStyle`. */
  responsiveOverrides?: Partial<Record<Exclude<Breakpoint, 'desktop'>, ResponsiveOverride>>
  /** Format-neutral intent retained for future exporters. Renderers may use
   * only a subset; it is deliberately not expressed in Figma terms. */
  layoutIntent?: {
    positioning?: 'flow' | 'absolute' | 'free'
    widthMode?: 'fixed' | 'content' | 'fill'
    heightMode?: 'fixed' | 'content' | 'fill'
    horizontalConstraint?: 'start' | 'center' | 'end' | 'stretch' | 'scale'
    verticalConstraint?: 'start' | 'center' | 'end' | 'stretch' | 'scale'
  }
  /** Definition/instance identity and property overrides, independent of
   * any target design tool's component node representation. */
  componentDefinitionId?: string
  componentInstanceProperties?: Record<string, string | number | boolean>
  /** Semantic or observed token references used by this node's properties. */
  tokenBindings?: Record<string, string>
}

export interface ResponsiveOverride {
  style?: Partial<NodeStyle>
  gap?: number
  direction?: 'row' | 'column'
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'space-between'
  wrap?: boolean
  columns?: number
  columnGap?: number
  rowGap?: number
}

export interface NodeStyle {
  position?: 'relative' | 'absolute'
  left?: number
  top?: number
  width?: number | 'auto' | 'fill'
  height?: number | 'auto' | 'fill'
  minWidth?: number
  maxWidth?: number
  padding?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  boxShadow?: string
  opacity?: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  letterSpacing?: number
  color?: string
  textAlign?: 'left' | 'center' | 'right'
}

export interface StackNode extends DesignNodeBase {
  kind: 'stack'
  direction: 'row' | 'column'
  gap: number
  align: 'start' | 'center' | 'end' | 'stretch'
  wrap?: boolean
  justify?: 'start' | 'center' | 'end' | 'space-between'
}

export interface TextNode extends DesignNodeBase {
  kind: 'text' | 'heading'
  content: string
}

export interface ButtonNode extends DesignNodeBase {
  kind: 'button'
  label: string
  variant: 'primary' | 'secondary'
}

export interface ContainerNode extends DesignNodeBase {
  kind: 'container'
}

export interface DividerNode extends DesignNodeBase {
  kind: 'divider'
}

export interface ImageNode extends DesignNodeBase {
  kind: 'image'
  alt: string
  /** Portable image content for design/export. Local file paths are never
   * emitted into exported SVG. */
  src?: string
  objectFit?: 'cover' | 'contain' | 'fill'
  vector?: { viewBox: string; paths: { id: string; d: string; fill?: string; stroke?: string; opacity?: number }[] }
}

/**
 * Represents a real element found in an existing project page that we
 * cannot safely reconstruct as one of our own primitives — a detected
 * project component (`limited`: move/hide/duplicate only) or an
 * unrecognized/native element (`locked`: view in context only). This is
 * what makes Existing Page drafts honest rather than either fabricating a
 * full editable tree from someone else's JSX or silently dropping content
 * (spec §26, CMP-03).
 */
export interface PlaceholderNode extends DesignNodeBase {
  kind: 'placeholder'
  label: string
  /** @deprecated use `sourceReference` — kept so drafts persisted before
   * the Design Model rebuild keep loading without a migration step. */
  sourceFilePath?: string
  /** @deprecated use `sourceReference` — see above. */
  sourceLine?: number
  /** Where this placeholder was detected, relative to the project root —
   * shown in the inspector so the designer can find the real code. */
  sourceReference?: SourceReference
  attributes?: Record<string, string>
  /** Short static-text preview from the source element, display-only
   * (never editable — that would imply we understood/could rewrite it). */
  textPreview?: string
}

/** CSS-Grid-backed layout container (spec Phase 10/11) — children snap to
 * grid cells via their own `gridPlacement` rather than stack order. */
export interface GridNode extends DesignNodeBase {
  kind: 'grid'
  columns: number
  /** `undefined`/`'auto'` means rows grow implicitly with content — the
   * common case; an explicit count is only needed once a designer wants
   * fixed-height rows independent of content. */
  rows?: number | 'auto'
  columnGap: number
  rowGap: number
}

/** An instance of a Feature-scoped `ConceptComponent` (spec Phase 14) — a
 * component the designer invented that has no source in the codebase.
 * Rendered generically (name/variant/property preview) since, honestly,
 * there is no real implementation to render — never disguised as a fully
 * resolved component. */
export interface ConceptNode extends DesignNodeBase {
  kind: 'concept'
  conceptComponentId: string
  variantId: string | null
  propertyValues: Record<string, string>
}

export type DesignNode = StackNode | TextNode | ButtonNode | ContainerNode | DividerNode | ImageNode | PlaceholderNode | GridNode | ConceptNode

/** Only the kinds a designer can insert from the Insert panel —
 * placeholders are indexer-generated only and concept components are
 * inserted from the Concept Component library, neither ever user-created
 * as a bare primitive. */
export type PrimitiveKind = Exclude<DesignNode['kind'], 'placeholder' | 'concept'>
