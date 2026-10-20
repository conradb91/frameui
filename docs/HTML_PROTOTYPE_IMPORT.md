# Local HTML prototype import

The welcome screen offers **Import HTML prototype**, before repository setup. It accepts a standalone `.html` / `.htm` artifact or a `.zip` containing runnable HTML and assets. Files can come from ChatGPT, Claude or other tools. A repository and AI account are not required to import a prototype.

FrameUI copies the source into a managed project, serves it on loopback, explores its visible controls, and uses the existing Chromium DOM capture pipeline to create editable artboards. The original file is unchanged. Dependencies, installation scripts and build commands are never run. Source-only React/Vite archives must first be exported as runnable HTML or opened as a running application.

Each HTML file is included, even if it is not linked from the entry page. Internal links and observed visible changes from buttons, tabs and disclosure controls become native prototype connections. Dialogs and drawers are represented as full-screen state captures, with observed opening/closing connections rather than an inferred overlay implementation. Input controls remain native editable layers. The resulting project and design are saved locally; the loopback server restarts when the project is reopened.

## Coverage and limits

- Automatic capture uses the desktop viewport (1440 px). Additional sizes and states can be added through **Capture page**.
- HTML-only imports need to be self-contained. Use a ZIP for relative CSS, scripts, fonts and image files. Remote resources still require a network connection and may be restricted by their server.
- Automatic exploration is bounded to the first 40 screens, 60 control attempts, 16 visible controls per screen, and four actions from a starting page. Up to 100 HTML files can be captured. Limit and replay warnings are retained on the imported design.
- It does not invent pages or connections from source code. API-dependent screens, form submissions, authentication, drag gestures, canvas applications, controls without observable text/state changes, and interactions beyond those limits may need a manual capture. Destructive-looking actions and external links are not followed.
- Native import preserves captured DOM styles and editability using the same supported CSS/SVG feature set as normal capture. It is not a JavaScript interpreter inside the design canvas. Playback uses the detected native connections and local input simulation.
- ZIP imports reject traversal, symbolic links, duplicate entries, CRC failures, more than 2,000 entries, or more than 128 MB compressed/unpacked. Files are served read-only, from the imported prototype directory only, on `127.0.0.1`.

## Verification

`bun test tests/main/artifactImport.test.ts` checks ZIP extraction, relative assets, read-only serving, traversal rejection, and validated flow construction. `node scripts/smoke-artifact-import.cjs` exercises the actual welcome action, HTML and ZIP file dialogs, editable native layers, dialog/dashboard discovery, prototype playback, saving and reopening. Set `FRAMEUI_PACKAGED_APP` to run the same smoke check against a review application.

## Import progress and stopping

The import dialog displays the selected filename and separate stages for reading files, discovering screens/connections, and creating editable screens. File extraction and capture report measured counts; discovery uses an activity bar because its final screen count is not known in advance. The current file or interaction, discovered screen/connection counts, and elapsed time remain visible.

Stop import cancels the same owner-scoped job across extraction, browser loading, interaction replay and capture. Cancellation closes hidden capture browsers, stops ZIP streaming, and prevents unfinished designs from being published. A copied source project may remain available; the original HTML/ZIP is unchanged. Late events and stop requests from an older job cannot cancel a replacement import.

`node scripts/smoke-artifact-progress.cjs` checks progress visibility, cancellation of an intentionally non-responsive page, cancellation during capture, browser cleanup, prevention of unfinished design publication, and a successful subsequent import. The main-process cancellation and extraction cases are also covered by `tests/main/artifactImportJob.test.ts` and `tests/main/artifactImport.test.ts`.

## Page bounds, journey layout and canvas performance

New captures use the document's measured content height rather than a 1024 px minimum. Visible dialog/drawer bounds are included. Large application scroll panels in imported artifacts are expanded before full-page capture; small widgets and textareas are left alone. CSS viewport/min-height layouts can still legitimately occupy the viewport. Reimport older captures to measure their source again; their original scroll layout cannot always be recovered from saved layers alone.

Observed connections lay out journeys from left to right, with branch rows sized to the actual artboard heights. Unlinked screens get a separate grid; FrameUI does not invent transitions. The canvas shows connection arrows, and the same membership and connections are available in Flows. Older imports without explicit canvas positions receive journey placement on opening.

Unedited inactive artboards use bounded full-page previews; offscreen page contents are culled. At overview scales the active page also uses its preview, and clicking a page focuses it and restores native editable layers. Edited artboards retain live rendering so previews cannot hide subsequent edits. Original layers, screenshots and flow data remain in the saved design. Frame dragging updates page positions without copying the other screens and saves at the end of the drag.

Camera navigation paints once per animation frame. Wheel gestures, keyboard shortcuts and toolbar zoom use a consistent anchor; switching directly from wheel navigation to dragging reads the current camera rather than a delayed React state snapshot. Overview labels shrink at low zoom to avoid colliding with nearby artboards.

`node scripts/smoke-import-canvas.cjs` validates a 12-page connected ZIP with short, long and internally scrolling pages, measured bounds, native editing, overview DOM counts, cursor-anchored zoom, wheel pan, immediate wheel-to-drag navigation and Flow builder connections. Unit tests cover graph layout and low-scale zoom invariants.

Captured controls use one shared style function for the canvas, native prototype player and standalone rendering. Their box sizing, minimum dimensions, backgrounds, borders, padding, typography and placeholder paint are isolated from FrameUI modal/form CSS. Prototype values remain interactive without changing the design geometry.

## Lightweight documents and responsive storage

New design saves use a self-contained version 2 envelope: repeated long media/font payloads are stored once in a resource table, and the table and model are compressed losslessly. Readers still accept version 1 designs. Export and developer handoff receive the complete, hydrated native model; they do not depend on a profile-specific asset URL. Older FrameUI builds cannot read version 2 designs, so keep the current build when reopening a newly saved file.

Only generated screenshot references/thumbnails are optimized as JPEG. Imported images, SVG paths/symbols, embedded font bytes, editable text and design geometry are retained. The canvas preview remains separate from editable content. Do not treat file size as a fidelity score or delete native layers merely to reduce bytes.

Design listing caches lightweight summaries by file timestamp/size. Reading, validation, resource decoding, serialization and atomic saves run in a dedicated worker, keeping them off Electron's main event loop. Repeated media is also pooled across IPC. The component library is loaded only when its Pages, Components or Assets panel is needed, and stable canvas callbacks keep camera changes from re-rendering the active native frame.

HTML SVG sprites retain inherited fill/stroke/colour from their visible instance, without inheriting default paint from a hidden symbol sheet. Pseudo-elements replay in CSS order (`::before`, content, `::after`) so image overlays stay above the image. Used loaded web-font faces are embedded with weight/style/stretch/unicode descriptors; unloaded font names without supplied bytes continue to use the source browser's fallback.

`node scripts/smoke-academy-performance.cjs` accepts `FRAMEUI_HTML_FIXTURE` and exercises the real Academy prototype, including full discovery, sprite definitions, compact storage, camera frame times, stable native DOM, playback and reopening. `scripts/audit-capture-fidelity.cjs` accepts `FRAMEUI_GENERAL_AUDIT=1` with a custom HTML fixture to report desktop/mobile visual differences without applying the specialized SVG/text fixture assertions. Visual difference percentages are diagnostics, not a claim of universal pixel-perfect import.

Routine editor saves send a revisioned page/property patch rather than copying the whole design across the context bridge. Frame moves/renames send only their changed fields; native text/style changes send the affected frame. Disk serialization remains in the worker, and the atomic on-disk document stays self-contained. New documents and revisions already persisted by approval/import retain the complete-save path.

### Discovery and completion safeguards (20 October 2026)

Automatic interaction discovery is a bounded sample, not a guarantee that every application state has been captured. It examines up to 32 eligible controls per screen, 40 explored screens, 60 attempts and four replay steps. Navigational links are prioritized. Form-associated controls, submit/reset controls, disabled controls and destructive accessible names are excluded. Generic buttons require a recognizable navigation/disclosure name or explicit disclosure/tab semantics. Skipped controls and limits produce **Partial discovery** notices with a manual Capture continuation path. This reduces unintended actions; it is not a security proof for arbitrary JavaScript handlers. The existing network guard remains necessary.

Router hashes (`#/…` and `#!/…`) and sorted query parameters distinguish state. Ordinary fragment anchors do not. A bounded visible structural/style signature supplements copy and selected/expanded state. `frameui-discovery-report.json` in the managed imported project records fingerprint decisions and applicable limits for inspection. The signature is a heuristic; virtualized content, delayed states and unsupported interactions still require manual review.

The importer labels four stages and reports desktop capture at 1440 px explicitly. Completion follows the save queue acknowledgement. A persistent in-session summary exposes partial discovery and Capture review, while captured-page notes retain warnings after reopening. Stopping preserves an import-owned draft project; it does not delete source files or promise rollback of already acknowledged saves. Linked HTML resources may contact remote servers; local file storage does not imply offline execution.

DOM snapshot debugger operations and supplementary scripts share the job cancellation signal and a 30-second snapshot-stage deadline. Capture screenshot calls race the job signal. Synthetic never-resolving debugger/script checks verify prompt cancellation and recapture; they do not substitute for every platform/browser failure mode.

### Editable list markers and canvas flow guides (20 October 2026)

CDP `::marker` layout nodes are retained as positioned editable text, including browser-resolved unordered symbols, nested list styles and ordered counters. This avoids guessing numbering from DOM sibling order (which fails for `start`, reversed lists and CSS counters). Marker colour and font metrics follow the browser snapshot. Native XD serialization retains these text layers. Earlier captures must be recaptured to recover markers that were previously omitted; no bullets are invented in existing documents.

New HTML/ZIP imports group observed action branches into journeys. Each journey receives an editable white introduction frame, numbered `Flow 1…`, with its action and starting-screen description, followed by its captured screens. Shared screens retain one source artboard rather than duplicating large captured trees. Each flow graph still includes its shared starting screen. Guide frames are saved with `flowIntroductionFor`, exported as design content, and excluded from playable flow membership; original starting screens and interactions remain intact. Unconnected screens receive their own guide. Approved AI flow imports also add guides alongside newly imported work without moving existing artboards.

`scripts/smoke-artifact-import.cjs` checks HTML and ZIP imports, editable bullets, saved guide metadata, prototype navigation and reopening. `FRAMEUI_LIST_AUDIT=1` with the list fixture in `scripts/audit-capture-fidelity.cjs` checks mobile/desktop visual replay and editable marker text in generated XD data. `tests/main/flowIntroductions.test.ts` covers branch grouping, non-overlap, persistence, native XD guide text and preservation of existing canvas work.

### Import progress and discovery efficiency (20 October 2026)

The import dialog uses FrameUI theme tokens in light/dark modes. It reports the real four stages, discovered screen/connection counts, elapsed time, determinate capture progress and the latest completed screen thumbnail. Unknown-length discovery stays indeterminate. Hiding the dialog runs the import in the background; completion offers **Open design** without replacing current work. Stopping remains available from the dialog or background status. The elapsed clock updates inside the dialog, avoiding a full editor render every second.

Each synchronous discovery inspection caches per-element style, bounds and selector reads, indexes sibling positions once, and stops visual sampling after the same first 500 visible elements. All candidate controls still contribute to eligibility/skip counts; existing 32-control/40-screen/60-attempt/four-step bounds are unchanged. Already inspected observed states reuse their immutable inspection data when traversed, while each interaction still starts from a fresh browser for replay isolation. Font/image readiness, full-page scrolling, 1440px capture, editable-layer conversion and asset quality remain unchanged.

`node scripts/benchmark-artifact-inspection.cjs` compares the optimized inspection with an uncached full-DOM reference on a dense fixture and checks identical inspection output. The recorded reduction applies to that DOM-inspection step, not total import duration. `scripts/smoke-artifact-progress.cjs` verifies indeterminate/determinate progress, hide/reopen, cancellation, clean retry and background completion without workspace navigation. `scripts/preview-artifact-import.cjs` renders representative progress states for light/dark and narrow-width visual review; its progress values are explicit QA fixtures, not captured runtime telemetry.
