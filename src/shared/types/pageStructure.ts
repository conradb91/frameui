export interface PageStructureItem {
  tagName: string
  isKnownComponent: boolean
  /** Real indexed component/partial path when this element resolves to one. */
  sourceFilePath?: string
  /** One-based source location when the parser can determine it. */
  sourceLine?: number
  /** Static, display-only attributes useful to the visual inspector. */
  attributes?: Record<string, string>
  /** Nested source markup — a real (capped) tree, not just the outermost
   * level, so JSX, HTML and server-template hierarchy survives into the
   * design tree instead of being flattened to one level. */
  children: PageStructureItem[]
  /** A short text preview when this element's only meaningful child is a
   * string — lets a `locked`/`limited` placeholder show real content
   * ("h1: Welcome back") instead of just its tag name. Never used for
   * editing, only display. */
  textPreview?: string
}
