# FrameUI design IDE rebuild

The desktop entry point is now `DesignIde`. The former runtime workspace is no longer mounted, hosting IPC handlers are not registered, preview compatibility handlers cannot launch processes, and the hosting engine is excluded from review packages. Existing repository folders, databases, and prior workspace data are not deleted by this change.

## Implemented path

Open repository → source index → connect to an existing localhost application → optional sign-in webview → source/browser page discovery → explicit capture approval → at most three read-only capture workers → visual normalization → persisted design document → editable SVG canvas.

Design documents are atomically written below the Electron profile's `design-files` directory. Captured images and downloadable font faces are embedded in those documents. The model, rather than SVG or the captured DOM, is authoritative. Opening a saved design does not contact localhost.

The editor provides Pages, Layers and Assets; Design, Prototype and Inspect tabs; selection and marquee selection; trackpad pan/pinch zoom; drawing, moving, resizing and rotation; nested duplicate/group/ungroup/ordering; alignment/distribution; guides and grid snapping; text editing; radius and opacity controls; components, instances, saved variants and overrides; variable collections; page states; and editable SVG export.

Capture records actual geometry, computed styles, text ranges, image data, vector paths and accessible/component labels. Structural wrappers collapse. Repeated matching controls and explicit source component hints can become component instances. Parameterized record URLs are deduplicated. Refresh compares source dependency hashes; a property-level three-way merge preserves designer edits and exposes conflicting app changes in Inspect.

## Verification

- The complete suite passed: 172 tests across 41 files, including visual-model and three-way refresh tests.
- TypeScript checks for renderer and main process passed.
- ESLint passed for the new visual core, editor, and IPC implementation.
- `scripts/smoke-design-ide.cjs` exercises real Electron drawing and persistence, explicit capture approval, duplicate record routes, semantic objects, exclusion of logout navigation, and offline reopening.
- `docs/verification/design-ide.png` records the captured fixture opened in the new editor.

## Fidelity boundaries

SVG export preserves editable geometry, text, groups and embedded assets. It does not produce native Figma component definitions or Figma variable collections. Saved click interactions support offline page navigation with Instant, Dissolve and Slide transitions.

Browser capture cannot reproduce every CSS feature as a native vector property. Pseudo-element placement is estimated when the browser does not expose a box; complex SVG transforms, filters, masks, advanced gradients, virtualized content and canvas/WebGL content require further fidelity work. Cross-origin stylesheets whose font rules cannot be inspected may fall back to system fonts.

Observed disabled/focus/pressed states are retained. Up to 24 controls per page are sampled with Chromium CSS hover/focus/active forcing, without dispatching interaction events; changed appearances become selectable variants. Framework prop combinations are not synthesized. Variants can also be saved and selected manually. Source relationships are reliable when adapters or explicit component hints provide them; inferred identical visual patterns are design components, not proof of shared source implementation.

Automatic discovery deliberately excludes action-looking routes and query URLs. Unlinked parameterized pages accept a representative live address on the capture confirmation screen. Automated sessions block non-read HTTP methods, so applications requiring POST-based read queries may need a more specific read-only integration. There is no guarantee that a poorly designed application's GET routes have no server-side effects.

Layout direction, gap, padding, alignment, distribution and simple grids update child geometry. Resize handles and inspector dimensions apply left/right/center/stretch/scale constraints. Vector paths are directly editable; advanced Bezier handle tooling is outside this implementation.

The architecture rebuild was verified before the queued product-refinement pass began. The resulting review package is now `release/navigation-review/FrameUI-0.1.0.dmg`; packaged Electron smoke checks and DMG checksum verification passed. The profile is fresh per build. See `PRODUCT_AUDIT.md` for refinement evidence and boundaries.
