/**
 * Where a Design Model object came from in the real codebase — the one
 * shared shape every object with provenance uses, replacing the ad hoc
 * `sourceFilePath`/`sourceLine` pairs previously redeclared on several
 * unrelated types. Read-only: the file it points at is never opened for
 * write by FrameUI.
 */
export interface SourceReference {
  /** Relative to the project root. */
  filePath: string
  /** One-based, when the parser/adapter can determine it. */
  line?: number
  /** The route this object was reached through, when relevant (a page,
   * not an arbitrary element). */
  route?: string
}
