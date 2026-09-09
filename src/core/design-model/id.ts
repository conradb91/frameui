/**
 * Permanent, deterministic object ids (Design Model spec §0) — derived from
 * a human-readable name rather than a file path or route, so an id survives
 * refactors and comes back identical across repeated scans of the same
 * project. Never random: later phases (Features referencing pages,
 * incremental indexing, version history) depend on the same inputs always
 * producing the same id.
 */

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'untitled'
}

/**
 * Same composed-id shape as `IdRegistry` (`kind.part1.part2`), but for
 * Feature-authored objects created one-at-a-time across many sessions
 * rather than regenerated in one `buildProjectModel` pass — so collision
 * checking reads from the caller's already-persisted id list instead of an
 * in-memory `Set` built during a single scan. Used for every Phase 16-25
 * object (`FeaturePage`, `DesignState`, `Alternative`, `Journey`,
 * `JourneyConnection`, `SharePreview`) so they get stable, human-readable
 * ids ready for later SVG/Figma export — e.g. `page.payment_overview`,
 * `state.add_bill.validation`. Deliberately NOT used for `Feature`/
 * `ConceptComponent`/`Flow`/`ScreenDraft`, which already shipped with
 * `crypto.randomUUID()` ids and a `.uuid()` zod contract — changing their
 * id scheme now would break already-persisted data for no benefit, since
 * the spec's stable-id examples are all about pages/states/journeys, not
 * Features themselves.
 */
export function makeStableId(kind: string, parts: string[], existingIds: Iterable<string>): string {
  const base = [kind, ...parts.map(slugify)].join('.')
  const used = existingIds instanceof Set ? existingIds : new Set(existingIds)
  if (!used.has(base)) return base
  let attempt = 2
  let id = `${base}-${attempt}`
  while (used.has(id)) {
    attempt++
    id = `${base}-${attempt}`
  }
  return id
}

/**
 * Tracks ids already issued within one build run so same-named objects
 * (two "Settings" pages in different areas) don't collide. Scoped to one
 * instance per `buildProjectModel` call, never global, so repeated builds
 * of the same project stay pure and reproducible.
 */
export class IdRegistry {
  private used = new Set<string>()

  private compose(kind: string, parts: string[]): string {
    return [kind, ...parts.map(slugify)].join('.')
  }

  /** True if this exact (kind, parts) id is already taken — callers can use
   * this to decide whether to add a disambiguating part (e.g. an area name)
   * *before* falling back to an opaque numeric suffix. */
  wouldCollide(kind: string, parts: string[]): boolean {
    return this.used.has(this.compose(kind, parts))
  }

  /** Registers and returns the id for (kind, parts), numeric-suffixing on
   * collision as the last resort so every id stays unique. */
  make(kind: string, parts: string[]): string {
    const base = this.compose(kind, parts)
    if (!this.used.has(base)) {
      this.used.add(base)
      return base
    }
    let attempt = 2
    let id = `${base}_${attempt}`
    while (this.used.has(id)) {
      attempt++
      id = `${base}_${attempt}`
    }
    this.used.add(id)
    return id
  }
}
