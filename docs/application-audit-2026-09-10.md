# FrameUI application audit — 10 September 2026

## Scope and result

Audited the current working tree, preserving the framework-support updates that were already uncommitted. Used the built Electron application on macOS, isolated test profiles and disposable repositories. Also opened and indexed FrameUI's actual repository and tested an unsigned packaged macOS application.

The tested workflows pass after the fixes below. This is not certification that every possible repository, operating system or interaction is defect-free. Native Windows execution, Windows installer testing, macOS signing/notarization and a long-duration memory soak remain unverified.

## Confirmed issues corrected

- **Lost or stale saves:** flow/journey navigation canceled pending saves or allowed an older response to overwrite a newer edit. A shared queue captures each document and revision, serializes writes per document, waits for in-flight saves and retains failed revisions for retry.
- **Quit/reload data loss:** closing or reloading within the autosave debounce interval could lose the last edit. Reload waits for pending writes; Electron window close waits for successful persistence and keeps the window open on save failure.
- **Snapshot and deletion ordering:** duplication, version restoration, export/share snapshots and destructive workspace actions now flush queued changes first. This prevents stale snapshots and pending saves recreating deleted objects or overwriting restored versions.
- **Project and document state:** late index results and old-project file notices no longer replace the current project. Project entry clears stale design selection. Entering a legacy flow clears feature context so its export cannot select the wrong workspace.
- **File tabs:** deleted/archived files no longer remain in the open-tab list, and persisted tab references are reconciled with available files. A duplication finishing after a project switch cannot create its file in another project.
- **File naming:** the inline rename field now receives focus and selects its name.
- **Blank-canvas insertion:** basic primitives were implemented in the model but inaccessible from the main canvas, and the advertised Text shortcut had no action. The component panel now exposes the existing primitives and Text works with T.
- **Canvas editing:** arrow keys move the selected element rather than its containing frame. Already-handled panel/dialog key events do not also edit the canvas. Changing a frame's responsive viewport no longer reloads its design and clears undo history.
- **Canvas rendering:** stack justification, responsive alignment/wrapping, responsive grid gaps, grid rows/placement and visible border styles now reflect inspector changes.
- **Invalid nesting:** moving a container into itself or its descendants is rejected without detaching or losing the subtree.
- **Component previews:** per-response effect cleanup could discard other in-flight thumbnail results. Both component-library views now load bounded batches and invalidate source caches when the index changes. Project visual styles refresh after reindexing.
- **Component deletion:** the editor's Delete action opened state for a confirmation dialog that was not mounted in editor mode. The dialog now renders, supports cancel, and deletes on confirmation.
- **Repository scan overhead:** component discovery loaded dependency/standard-library type information unnecessarily. An isolated in-memory declaration scan preserves the 61 components found in FrameUI's repository while reducing the observed scan from about 16.6 seconds to 1.6–1.9 seconds.
- **Preview lifecycle:** project/application switching stops the old preview; stopped processes cannot later clear a newly started process's state. Shutdown targets the spawned process group on macOS and the process tree on Windows, and clears the published URL/status.
- **Windows command resolution:** executable lookup includes `.exe`/`.com` and the `Path` environment key. Recognized package-manager JavaScript entry points run through Node with literal arguments rather than trying to execute shell shims directly. Native Windows validation is still required.
- **macOS window lifecycle:** closing the last window stops the active watcher/preview, and a second launch no longer attempts to focus a destroyed window.
- **Watcher failures:** watcher errors report a warning instead of becoming unhandled EventEmitter errors; symlinks are not followed outside the scanner's scope.
- **Malformed workspace envelopes:** missing/null/non-array collection data falls back safely instead of crashing collection readers.

## Verification

| Area | Evidence |
| --- | --- |
| Automated checks | 79 tests across 21 files; TypeScript checks for renderer and main/preload; ESLint with zero warnings; production Vite build |
| First launch and themes | Choose first-launch appearance; light/dark settings; theme and welcome completion survive a full process restart |
| Project import | Native directory-dialog flow against a temporary PHP repository; direct main/preload IPC checks against the real FrameUI repository, an empty directory and a nested React application |
| Project lifecycle | Missing paths; recent-history removal; unregistering preserves repository files; explicit name-confirmed disk deletion removes only the disposable fixture |
| Repository changes | Real filesystem edits trigger watcher notices and refresh the indexed page content |
| Repository edge cases | 400 HTML pages plus 400 ignored generated files; malformed package JSON; spaces/Unicode in paths; symlink loop; nested application discovery; cache-hit reopening |
| Canvas | Create a two-page flow and blank design; render the actual PHP preview; duplicate source into an editable design; insert an existing project pattern; add/edit/duplicate/delete/undo/move text; change frame position/dimensions; create responsive copies |
| File organization | Rename; duplicate saved canvas content; create folder; move; archive; restore; delete; tab-state regression tests |
| Application navigation | Open Features, Application, Pages, Components, Design System, Journeys, Review, Problems and Project Settings through command search |
| Feature authoring | Create a feature and concept component; cancel/confirm component deletion from its editor; create a blank feature page; verify persisted feature membership |
| Export | Generate an SVG using the feature export UI and native save-dialog boundary; validate written SVG. Existing tests cover structured packages, handoff, responsive export and journeys |
| Persistence | Reload and full quit/relaunch; edits made immediately before reload/quit survive; panel width/focus preferences survive; queue tests cover delayed writes, failures, retries and owner changes |
| Runtime failures | Missing preview executable returns a failed operation; stopped/restarted process regression; no renderer exceptions or console errors in the main workspace audit run |
| Packaging | Unsigned macOS arm64 app built with electron-builder; packaged executable passes the full workspace UI suite (canvas, files, themes, immediate reload/quit, restart) plus real-repository import, watcher, failure and project-lifecycle checks |

## Reproduction

Use a current Node runtime and Bun. Tests create temporary repositories and isolated Electron profiles; they do not delete or modify the user's real repository. The repository test reads FrameUI itself. PHP must be available for the workspace preview test.

```sh
bun test
bun run typecheck
bun run lint
bun run build
node scripts/audit-workspace.cjs
node scripts/audit-authoring.cjs
node scripts/audit-repositories.cjs
```

The audit scripts accept `FRAMEUI_EXECUTABLE` to exercise a packaged executable. They substitute temporary paths at native file-dialog boundaries; canvas, navigation, theme, file and authoring actions use the rendered UI. Repository edge cases additionally use the real preload/IPC API.

## Remaining verification limits

- No native Windows host was available. Windows process launch/termination and installer behavior need a Windows run; macOS results do not prove those paths.
- The macOS package is unsigned by the existing configuration. Successful packaging/launch here does not establish a signed, notarized first-install experience on another Mac.
- The 400-page stress fixture and repeated workflow runs are bounded tests, not an exhaustive repository corpus or a long-duration memory leak test.
- The full set of pointer gestures, every property/control permutation, live authentication/backend flows and every combination of framework/runtime dependencies was not individually exercised.
- Concept components remain the existing design-model feature, not generated production components. Static source previews cannot guarantee runtime-only props, states or application dependencies. No unsupported source-generation behavior was added during this audit.
- Production build still reports a large renderer chunk. Packager reports optional/unresolved dependency warnings; the packaged app's tested startup and indexing paths nevertheless pass.
