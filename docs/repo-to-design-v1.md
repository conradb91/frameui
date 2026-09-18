# Repository-to-design migration

The September 2026 source-only specification supersedes runtime capture as the normal import workflow. The full SVG editor remains the design surface; the limited workspace canvas is not the application entry point.

## Implemented path

Repository selection → existing background project index → analysis summary → project library → on-demand Design IR → isolated visual resolution → editable vector document.

- Import does not start hosting, request an address, ask for credentials, select routes, or render every page.
- Page and component entries come from the repository index. Source documents are generated when opened. Previously saved editable documents reopen without replacing edits.
- `src/core/repo-design/compiler.ts` produces a framework-independent, non-executable IR. It reads bounded local dependencies, not project build scripts.
- HTML and CSS use syntax trees. React/TSX uses a bounded TypeScript AST interpreter for native elements, local components, props, literals, static arrays, conditional returns, mapped lists, and Next app layouts.
- Vue supports template/script constants, basic bindings, conditionals and lists. PHP supports basic presentation AST nodes, includes, literal arrays, conditionals and foreach. Neither engine executes repository code.
- Supported unresolved lists receive deterministic local preview rows. Existing literal content/arrays and supported component fixtures take precedence. Relevant TypeScript interface fields are recorded in the IR.
- Local images, background images and fonts are embedded. Supported Tailwind utilities resolve project tokens first. CSS is measured using Chromium inside FrameUI, without an HTTP server.
- Internal WebContents have a fresh nonpersistent session, sandboxing, no Node integration, no preload or webview, denied permissions/popups/navigation, and a request gate allowing data URLs only. Generated HTML also denies scripts, connections, frames, objects and forms through CSP.
- Dependencies and their content fingerprints key the IR/visual cache. Source references and editable designs are stored separately under the review profile. Refresh/state/viewport changes create editable versions instead of replacing designer edits.
- SVG export uses the native Save dialog. Imported text and shapes remain editable vector objects, not a page-sized image.

## Not yet complete

This is an incremental implementation, not full compliance with all 92 specification sections.

- General-purpose JavaScript execution is intentionally unsupported. Hooks, contexts, complex computed components, package components, styled-components, CSS Modules, arbitrary Tailwind plugins and server-only logic need further adapters.
- Full schema ingestion and the complete fixture/Storybook/seeder/factory/API/model priority resolver remain incomplete. Generated values currently use supported literal data, component fixtures, inferred binding names and a limited type inventory.
- Vue slots, complete CodeIgniter/Blade layout semantics, advanced variants, charts, maps and other complex widgets need dedicated adapters. Unsupported parts must be reported rather than presented as accurately reconstructed.
- Responsive source reconstruction recalculates layout, but editable variants do not yet share a complete constraint-solving model. Non-destructive refresh currently preserves separate versions; semantic three-way source merging remains future work.
- Design-system audits, full global semantic search, comprehensive state discovery, and pixel-difference accuracy thresholds across real production repositories remain outstanding acceptance work.
- Legacy capture/hosting modules are retained for compatibility, but are not called by the new import/editor workflow.

## Verification

`bun test src/core/repo-design` covers source parsing, local components, preview rows, conditions, Vue, PHP, layouts, custom spacing/breakpoints, blocked external assets, symlink containment and source-cache invalidation.

`node scripts/smoke-vector-editor.cjs` runs the packaged editor with server creation and project-command execution disabled. It verifies progressive import, actual source text editing, drawing, persistence, native SVG export and unchanged repository files. `FRAMEUI_PACKAGED_APP` selects a mounted review installer executable.

The packaged fixture tests do not establish complete fidelity for every imported application. Apple Silicon execution must be verified on an Apple Silicon machine.
