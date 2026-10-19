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
