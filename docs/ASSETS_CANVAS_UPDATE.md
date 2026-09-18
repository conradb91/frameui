# Assets, canvas editing, sign-in and responsive overlays

## Workflow

Open a project library, create a design file, then open Assets. Screens and components have previews, plus buttons and drag-to-canvas support. Clicking opens a preview beside the sidebar with the route or source location. Adding a screen creates a frame containing cloned visual objects and text, with captured font definitions. The image used by the library thumbnail is never used as the inserted screen's canvas content.

Double-click captured text to edit it; the Typography inspector edits its font and other text properties. Cmd/Ctrl-click selects a nested object directly. Selected containers move independently. Alignment feedback uses edges and centres, including the parent's coordinate offset. Holding Alt temporarily bypasses snapping. Pointer capture starts on actual movement rather than swallowing text double-clicks. Selection-only clicks no longer create redundant history/save entries. Undo snapshots retain immutable documents; pending saves coalesce per file instead of queuing every intermediate value.

Imported component names are preserved. Previews expose Normal, Hover, Focus and Active CSS variants when captured. CSS transitions are temporarily disabled in the isolated capture window so state snapshots are not transition intermediates. Components created in a design also use the visual asset browser.

Variable rows open an editor modal with name, collection, type and value, colour controls, validation, Save, Cancel and Escape. Cancelling leaves the saved variable unchanged.

## Capture identity and authentication

Discovery follows the actual connected URL and prefers visible navigation labels. Source-only login routes are excluded. If a requested page redirects to another path, capture reports the redirect instead of storing that destination under the wrong page name. URL structure provides page folders. Already saved mislabelled captures are not silently rewritten; recapture is needed.

Connection offers manual sign-in or login details for capture. The assisted option supports same-origin POST forms with username/email and password fields. Passkeys, MFA and custom/multi-step forms fall back to the embedded browser. Credentials are not written to design files or preferences; fields are cleared after the attempt. The application's session cookies and saved design files remain local. Automated capture workers continue to block non-read requests.

## Dialogs and responsive states

Include dialogs, drawers and popovers inspects DOM-resident dialog, menu, popover and drawer elements in the isolated capture browser. Each is revealed in turn, captured as editable visual objects with a separate state name, then restored. Selecting tablet and mobile produces Desktop, Tablet and Mobile overlay states as well as the base pages. No action buttons are automatically clicked. Source scanning also identifies named overlay-component candidates.

An overlay rendered only after application interaction cannot be synthesized from a component name. Showing hidden DOM can differ from a framework's full open-state behaviour or transition; these snapshots represent the available DOM and CSS, not an executed interaction flow. Native OS popups and unmounted components are outside automatic overlay capture. CSS state sampling currently covers up to 24 eligible controls per page/state; framework prop combinations are not synthesized.

The existing CSS/vector fidelity boundaries remain: bitmap photos stay images; unsupported browser-specific effects and canvas/WebGL do not become native vector editing primitives. SVG geometry and text remain editable, but this is not a native Figma component/variable export.

## Verification

Renderer/main type checks, targeted ESLint and 14 visual-core tests passed. Electron workflows cover:

- Manual and credentials-assisted local sign-in; no credentials in saved design data.
- Asset preview without insertion, plus insertion, and screen drag-to-canvas.
- Real captured text content/font edits, independent nested-container movement and component Active-state preview.
- Variable modal Save/Cancel, native commands, drawing, file persistence and offline reopening.
- A hidden dialog captured as separate editable Desktop, Tablet and Mobile states, with read-only automated requests.

Screenshots are in `docs/verification`: `asset-screen-preview.png`, `component-state-preview.png`, `editable-canvas.png` and `variable-modal.png`.

The Intel macOS package `release/navigation-review/FrameUI-0.1.0.dmg` passed the credentials/editing workflow and the three-viewport hidden-dialog workflow using fresh build-specific review profiles. `hdiutil verify` reported a valid checksum. Disposable test profiles and the superseded release were removed after verification.

The final sign-in selector uses accessible full-card radio choices with icons, descriptions, selected/focus states and conditional credential fields. The replacement designer-review package passed the credentials/editing smoke and checksum verification after this refinement. Screenshot: `docs/verification/login-method-cards.png`.
