import type { SourceReference } from './sourceReference'
import type { Viewport } from './projectModel'

/**
 * The user-authored "Feature Model" (Design Model spec §0, Layer B) —
 * scoped design work that references, but never duplicates, the Project
 * Model. Type definitions only in this phase: no producers, no on-disk
 * persistence, no workspace UI wired up yet. Locking down these shapes now
 * means the Feature workspace (spec Phases 6-7), Journeys (21-23),
 * annotations (26) and version history (28-29) don't each need their own
 * schema rewrite later.
 */

/** Where an object in a Feature came from — shown throughout design,
 * review and handoff (spec Phase 15). */
export type Provenance = 'existing' | 'existing-modified' | 'new' | 'reference-only'

export type FeatureStatus =
  | 'concept'
  | 'designing'
  | 'review'
  | 'approved'
  | 'ready-for-development'
  | 'implemented'
  | 'verified'

export interface Feature {
  id: string
  projectId: string
  name: string
  description: string
  status: FeatureStatus
  owner: string | null
  reviewers: string[]
  dueDate: string | null
  externalTicketRef: string | null
  /** Existing Project Model pages pulled into this Feature via "Add
   * Existing Page" — the mechanism that keeps a Feature focused instead of
   * becoming a copy of the whole application. */
  pageIds: string[]
  /** Existing pages added as "Reference Only" (spec Phase 8) — participate
   * in Journeys for context but never become editable design work and never
   * get a screen draft of their own. Disjoint from `pageIds`. */
  referenceOnlyPageIds: string[]
  /** Pages invented inside this Feature that don't exist in the codebase
   * (spec Phase 16) — ids into the separate `FeaturePage` store, kept out
   * of `pageIds` since those are real `ProjectModel.Page` ids. */
  newPageIds: string[]
  createdAt: string
  updatedAt: string
}

/** Disambiguates which page collection an id resolves against — a real,
 * auto-derived `ProjectModel.Page` (read-only, recomputed every scan) or a
 * Feature-invented `FeaturePage` (persisted, user-authored). Threaded
 * through Design States, Alternatives, and Journey steps so none of them
 * need their own copy of "which kind of page is this" logic (spec
 * Integration Requirements: "Do not create duplicate models for Pages"). */
export type PageRefKind = 'existing' | 'new'

export interface PageRef {
  kind: PageRefKind
  /** `ProjectModel.Page.id` when kind === 'existing', `FeaturePage.id` when
   * kind === 'new'. */
  pageId: string
}

/** Phase 16 — a page the designer creates that has no source in the
 * codebase yet. Provenance is always 'new' by construction (never stored —
 * callers building a `ProvenanceBadge` for a FeaturePage just pass the
 * literal 'new'). `basedOnPageId` is clone/pattern *lineage*, not source
 * ownership: a cloned page is still fully 'new' — the app's page it was
 * cloned from is never mutated and the clone never becomes "the same page."
 */
export type NewPageLayoutSource = 'blank' | 'project-layout' | 'clone' | 'pattern'

export interface FeaturePage {
  /** Stable, human-readable id (spec Phase 16-25: "prepare all objects for
   * later SVG and Figma export") — e.g. `page.payment_overview`, built via
   * `makeStableId('page', [name], existingIds)`. Never a random UUID. */
  id: string
  featureId: string
  name: string
  description: string
  /** Design metadata only (spec: "Suggested routes are design metadata
   * only. Do not modify the application's route files.") — never written
   * back to the project's real routing. */
  suggestedRoute: string | null
  initialViewport: Viewport
  layoutSource: NewPageLayoutSource
  /** Set when `layoutSource` is 'clone' or a pattern seeded from one
   * specific real page — the real `ProjectModel.Page.id` it started from. */
  basedOnPageId: string | null
  /** Set when `layoutSource === 'project-layout'` — the name of the
   * detected structural pattern used (e.g. "AppShell"). */
  basedOnPatternName: string | null
  status: FeatureStatus
  createdAt: string
  updatedAt: string
}

/** Phase 17 — a page (existing or Feature-invented) can render as more than
 * one visual outcome. `DesignState` is the metadata; its design tree is
 * stored separately (see `designTreeStore` — one generic tree store shared
 * with `Alternative`, rather than a third near-identical draft table). */
export type DesignStateOrigin = 'captured' | 'design'

export interface DesignState {
  id: string
  featureId: string
  pageRef: PageRef
  name: string
  origin: DesignStateOrigin
  /** Set when `origin === 'captured'` — the runtime `CapturedPage` this
   * state was captured from (spec Phase 3's capture system, not a new
   * capture mechanism). */
  capturedPageId: string | null
  /** Set when this state was duplicated from another (spec Phase 17:
   * "Duplicate an existing state into a design state") — lineage only, the
   * duplicate's design tree is an independent copy from that point on. */
  duplicatedFromStateId: string | null
  /** Manual sort order for the states list/tabs — spec's "Reorder states". */
  order: number
  provenance: Provenance
  createdAt: string
  updatedAt: string
}

/** Phase 19 — a named, fully independent design alternative for one
 * `DesignState` (spec: "Current / Concept A / Concept B / Approved").
 * Alternatives intentionally hold full independent design trees (not
 * diffed deltas) — unlike responsive overrides, which the spec explicitly
 * asks to keep as deltas, alternatives are meant to diverge freely. */
export interface Alternative {
  id: string
  featureId: string
  designStateId: string
  name: string
  isPreferred: boolean
  isApproved: boolean
  createdAt: string
  updatedAt: string
}

/** Phase 25 — the review-safe data a Share Preview package is built from.
 * `packagePath` is set once `sharePreviewStore`'s packaging step has
 * actually written a bundle to disk — never a placeholder/fake URL (spec:
 * "Do not build a fake Share button that does nothing"). */
export type SharePreviewScope = 'feature' | 'journey' | 'page'

export interface SharePreview {
  id: string
  featureId: string
  name: string
  scope: SharePreviewScope
  journeyId: string | null
  pageRef: PageRef | null
  viewports: Viewport[]
  includeCurrentComparison: boolean
  /** The explicit, designer-confirmed inclusion gate for anything sourced
   * from a runtime capture (spec Phase 25 Security requirement) — defaults
   * to false; a share package built with this false must contain zero
   * `CapturedPage`-derived content. */
  includeCapturedStates: boolean
  createdAt: string
  updatedAt: string
  packagePath: string | null
}

/** A designer-invented component that doesn't exist in the codebase yet
 * (spec Phase 14) — e.g. "PaymentProgress". Scoped to one Feature; only
 * promoted into the real Project Model by a later, explicit action outside
 * this phase's scope. */
export interface ConceptComponentVariant {
  id: string
  name: string
}

export type ConceptComponentPropertyType = 'text' | 'number' | 'boolean' | 'select'

export interface ConceptComponentProperty {
  id: string
  name: string
  type: ConceptComponentPropertyType
  defaultValue: string
  /** Only meaningful when `type === 'select'`. */
  options?: string[]
}

export interface ConceptComponent {
  id: string
  featureId: string
  name: string
  description: string
  variants: ConceptComponentVariant[]
  properties: ConceptComponentProperty[]
  createdAt: string
  updatedAt: string
}

/** Phase 21 — a Journey node. `referenceOnly === true` means this step
 * exists purely for context (spec: "A page must not need to become
 * editable design work merely because it appears in a Journey") — such a
 * step never resolves a `designStateId`/design tree, only shows a static
 * preview of the real page's current structure. */
export interface JourneyStep {
  id: string
  pageRef: PageRef
  /** Which of that page's states this step represents — null shows the
   * page itself with no particular state selected (or is meaningless when
   * `referenceOnly`). */
  designStateId: string | null
  alternativeId: string | null
  referenceOnly: boolean
  provenance: Provenance
  position: { x: number; y: number }
}

export type JourneyInteractionTrigger =
  | 'click'
  | 'hover'
  | 'submit'
  | 'back'
  | 'close'
  | 'open-modal'
  | 'open-drawer'
  | 'change-tab'
  | 'change-state'
  | 'navigate'
  | 'external-link'

/** Phase 23 — a full interaction definition, not an anonymous arrow (spec:
 * "Do not reduce interactions to anonymous arrows between pages"). Source
 * page/state are implicit via `fromStepId` (every step already carries a
 * `PageRef` + state) — `elementId`/`elementLabel` name the actual trigger
 * element so the interaction editor can show e.g. "Click PrimaryButton
 * (Save Bill)" instead of a bare line. */
export interface JourneyConnection {
  id: string
  fromStepId: string
  toStepId: string
  trigger: JourneyInteractionTrigger
  /** A `DesignNode.id` within the source step's design tree, when the
   * trigger element is known (recorded or manually picked). */
  elementId: string | null
  /** Display name of that element — a component name, button label, etc. —
   * kept alongside `elementId` so the interaction still reads sensibly if
   * the source tree changes and `elementId` no longer resolves. */
  elementLabel: string | null
  label: string
  /** Free-form transition metadata (e.g. a note on timing/animation) — kept
   * as an open string map rather than named fields until a concrete need
   * narrows it, consistent with how `Style`/`Asset` were left type-only in
   * `projectModel.ts` until an adapter earned them. */
  transitionMeta: Record<string, string>
}

export interface Journey {
  id: string
  featureId: string
  name: string
  description: string
  steps: JourneyStep[]
  connections: JourneyConnection[]
  createdAt: string
  updatedAt: string
}

export interface Annotation {
  id: string
  featureId: string
  pageId: string
  pageStateId: string | null
  viewport: Viewport
  elementId: string | null
  componentId: string | null
  versionId: string | null
  screenshotAssetId: string | null
  sourceReference: SourceReference | null
  body: string
  createdAt: string
  createdBy: string
}

/** Design intent, not flattened pixels (spec Phase 29) — e.g. "move
 * component after input" or "padding 16 -> 24", not an x/y delta. */
export interface DesignChange {
  id: string
  featureId: string
  pageId: string
  summary: string
  createdAt: string
}

export interface Version {
  id: string
  featureId: string
  label: string
  createdAt: string
  designChangeIds: string[]
}
