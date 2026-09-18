# Capture system improvements — 11 September 2026

Work remains local. No commits, publication, release packaging, source-project changes or database changes were performed for this task. Existing workspace changes were preserved.

## Findings and implementation

- **Missing routes:** React previously enumerated a conventional pages folder, returning null routes. Literal JSX and object router declarations now supply nested paths and imported component sources, including Profile, Settings and admin screens outside that folder. Vue object routes use the same syntax reader; Nuxt retains its file-routing adapter. Next App and Pages routes are combined. Route groups do not enter URLs; private folders, parallel slots and intercepted views do not become invented standalone URLs.
- **Basic capture failures:** A password input was treated as proof of a logged-out screen, incorrectly rejecting account/security settings. That check is removed. Login redirects still produce a sign-in message; a directly requested login screen can be captured. Main-document HTTP errors now include the status code. Background network activity gets a bounded settling period; rendered-content readiness remains checked. Browser content dimensions now match requested viewport sizes.
- **Exclusions:** Added the `ignore` package as a direct dependency. Root and nested `.gitignore` rules are applied before parsing in shared walks and page discovery, including directory pruning and negation. Archives/backups join default exclusions. App discovery and stylesheet scans share the path-aware rules. Documentation and binary file extensions do not qualify as route sources. Custom path patterns are supported by the engine; there is not yet a settings editor for them.
- **Names:** Navigation labels and source-route names remain distinct from routes. Static markup uses literal headings/titles before filenames. A shared name resolver normalizes whitespace and rejects loading placeholders. Runtime discovery reads main headings and navigation labels. Source associations are retained when runtime links match known routes.
- **Dynamic routes:** The matcher handles colon, brace, Next bracket, catch-all and optional catch-all formats and prefers static matches. Unresolved patterns remain visible as needing a sample address. Existing internal links or an explicitly entered example provide real IDs. Unknown numeric links are no longer generalized into invented parameter patterns by capture discovery.
- **Selection, retry and persistence:** The capture dialog selects up to five ready pages initially, supports individual selection/select-all, and saves discovered registry entries with the design document before capture. Entries include route, source, area, profile and discovery/capture status. Capture consumes only selected ready routes and unique viewport widths. The approved plan remains available for retries; failed-page retry no longer needs a new scan. Existing merge logic protects designer edits.
- **Cancellation:** A main-process AbortController stops queued capture jobs, aborts asset requests and closes active capture windows. Completed variants return through the normal save/merge path. The dialog has Cancel and a continuation action. It does not simply hide the processing UI.
- **States:** The interactive embedded browser exposes a named Capture Current State action. Users can open menus, notifications, tabs, accordions, dialogs, drawers and other runtime states themselves. They are saved as variants associated with a route and profile. The page browser groups responsive and named states together and labels the variants. Automatic overlay capture only observes visible overlays; the old forced display/position/opacity changes were removed because they fabricated appearances.
- **Authentication:** Standard User, Admin and Super Admin have separate persistent Electron session partitions per project. Both manual sign-in and the existing transient credential path use the selected profile. Captured variants retain profile identity so merging cannot overwrite a different role's capture. No password persistence was added.
- **Performance:** Expensive pseudo-control-state extraction is opt-in in the capture API. Discovery hashes are cached within the operation and image fetch/encoding promises are shared across capture jobs. Capture remains bounded to three workers. Timings and completion/cancellation counts are emitted locally. Hidden DOM branches are pruned before traversing their descendants.
- **Additional view content:** Open shadow roots, assigned element slots and `display: contents` wrappers are handled. Readable canvas content uses an image fallback. Capture import no longer automatically creates prototype click interactions from route links.

## Verification

Baseline: 176 tests passed, 0 failed, 22.33 seconds. Expanded suite: see final verification log; tests cover nested React/Vue route declarations, Next groups/private paths, dynamic formats, name resolution, state grouping and nested ignore rules in a fixture with 2,000 irrelevant HTML files. That fixture initially completed its filtered walk in 2.3 ms and returned only its two intended pages.

Production build includes both renderer and main-process TypeScript checks.

`scripts/smoke-capture-registry.cjs` exercises the built Electron app with a disposable local project, profile and HTTP server. It checks a Settings page with a password field, a visible notification dialog, a 404 reason, reuse of a capture plan, cancellation that keeps a completed capture, Standard/Super Admin session isolation and responsive capture. It also checks content from open shadow roots, `display: contents`, and canvas image fallback.

Initial Electron measurement: 1,560 ms with control-state extraction versus 1,402 ms for default capture. Cancellation returned in 12.7 ms and retained one completed page. These are a small synthetic comparison within the updated pipeline, **not a complete original-versus-replacement capture benchmark**. No original browser timing was recorded before edits. Final Electron run: 1,480 ms with control states, 1,167 ms by default; cancellation returned in 7.3 ms and retained one completed page. Shadow-root, wrapper and canvas assertions also passed. Results are stored in `docs/verification/capture-registry/`. The final unit run passed all 183 tests in 23.22 seconds.

The installed Electron binary was arm64 on an x64 host. Verification uses the already cached x64 Electron 33.4.11 in a temporary directory; it does not alter the verified release.

## Remaining limitations and next work

This does not guarantee capture of every possible application view or implement every item in the supplied guide.

- Computed/runtime route configurations, lazy import patterns and custom router DSLs can still require runtime links or a supplied address. Parallel/intercepted Next views are state candidates, not automatically navigated pages.
- Closed shadow roots, cross-origin frames, tainted canvases, video/WebGL internals and native OS widgets cannot be reconstructed as editable DOM objects by this converter. Follow-up: visible embedded frames now receive a compositor image fallback in both manual and batch captures. Canvas fallback is flattened; screenshot previews preserve more than the editable tree in unsupported cases.
- Follow-up: manual and batch captures now share authenticated image/font embedding, including blob and data images. Resource failures are reported in capture notices. Opaque cross-origin stylesheets and unsupported resource formats can still limit font embedding.
- The registry is stored in the existing design document. A unified uncaptured-page browser with status/area filtering and click-to-capture remains unfinished. Sample mappings added to a live plan are not yet durably restored into later discovery sessions.
- Profile selection is explicit per capture connection. Automatic role detection, profile-to-route assignment, configurable login URLs and cross-role capture in a single batch are not implemented.
- Batch capture cancellation is verified. The discovery/sign-in and post-capture renderer conversion phases do not yet share a cancellable task controller. Capture progress remains per-job rather than reporting every internal conversion stage.
- Each viewport job still creates its own BrowserWindow, while Chromium and session/cache infrastructure are shared. A bounded reusable-window pool needs further measurement. Full large real-project before/after profiling is still required.
- Read-only automatic capture still blocks non-GET requests. Applications that load view data through POST/GraphQL may need an explicit read-operation policy; automatically allowing arbitrary POST requests would change the current safety contract.
- Gitignore changes are recognized on a fresh scan; comprehensive live watcher invalidation and an exclusions settings UI remain to be integrated.

The next priority is to unify interactive and batch capture resource handling, then expose the saved registry as the complete uncaptured-page browser with durable sample mappings and task-wide cancellation.


## Coverage follow-up

Computed-route discovery now folds constant string concatenation, template expressions, object-property lookups, imported named constants and local child-array spreads. Lazy import expressions retain the referenced view file. Cycles and shadowed function parameters are rejected, and unknown runtime expressions no longer generate an invented root route. This is bounded static analysis; application code is never executed during discovery. Environment-dependent factories, mutation, arbitrary mapping functions and custom router DSLs still need runtime links or explicit examples.

`src/main/ipc/handlers/captureResources.ts` replaces the duplicated resource pass. The new `design:captureCurrentState` IPC captures only a webview owned by the requesting FrameUI renderer. It fetches images and fonts through that webview's authenticated session, reads blob URLs in their owning guest, preserves existing data images, and embeds font URLs relative to their stylesheet. Manual capture now saves the returned fonts. Resource notices are persisted on captured pages and shown in the page preview.

Visible frames are copied from Chromium's compositor into image objects. Cross-origin DOM protections remain enabled. These objects are flattened images, not editable frame internals; offscreen frames require scrolling into view and a separate state capture. No attempt is made to bypass DRM or extract inaccessible source content.

The Electron fixture now checks authenticated manual images, blob images, fonts, cross-origin frame image fallback, and rejection of unowned guest IDs, in addition to the existing capture/cancellation/authentication checks. These checks passed in the development run. Final logs are stored under `docs/verification/capture-coverage/`.

Final follow-up verification: 188 tests passed, 0 failed; production build and both TypeScript checks passed. Electron checks passed, including a frame-pixel assertion with tolerance for macOS compositor color management. The fixture captured in 1,235 ms by default; cancellation returned in 7.3 ms and preserved the completed page.
