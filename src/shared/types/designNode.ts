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
}

export interface StackNode extends DesignNodeBase {
  kind: 'stack'
  direction: 'row' | 'column'
  gap: number
  align: 'start' | 'center' | 'end' | 'stretch'
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
  /** Source file the placeholder was detected in, relative to the project
   * root — shown in the inspector so the designer can find the real code. */
  sourceFilePath?: string
}

export type DesignNode = StackNode | TextNode | ButtonNode | ContainerNode | DividerNode | ImageNode | PlaceholderNode

/** Only the kinds a designer can insert from the Insert panel — placeholder
 * nodes are indexer-generated only, never user-created. */
export type PrimitiveKind = Exclude<DesignNode['kind'], 'placeholder'>
