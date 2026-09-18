# Canvas interaction and workspace usability — 17 September 2026

## Changes

- Captured objects select and drag on the first press. A native pointer interaction layer uses browser hit testing and one DOM preview per animation frame, then commits the model and undo entry once on release. It no longer routes gestures through Moveable/Selecto. Initial canvas references are populated after mount, with a direct lookup fallback for the first interaction.
- Small selections expose one square resize handle outside the object instead of eight crowded handles and a transform origin. Clicking an SVG path selects its containing icon. Shift-click, marquee selection, Escape cancellation, resize, text editing, undo and redo remain available.
- Vector gestures coalesce pointer events per frame. Vector movement previews the SVG and snapping guides without rendering the whole editor on each sample. Frame resize shares unchanged document data instead of cloning embedded captures on every input.
- Captured Layers and the position/size inspector now address the same structured nodes that are rendered on the canvas. The selection opens its ancestor path in Layers. Text can be edited inline or through the inspector entry point.
- User-drawn vector overlays now render over structured captures. Their design-only marker survives validated persistence, and interchange export includes those overlays without duplicating the legacy capture representation.
- Pages uses a single searchable list with All pages, Captured, Not captured and Needs attention filters. Connection setup is a disclosure; example paths appear only for selected dynamic routes. Group selection, device sizes, progress, cancellation, retry and sign-in/resume remain supported. Captured variants can be selected from their route row.
- Projects, designs and page rows have direct archive actions and restore flows. Archive is reached from the relevant workspace rather than occupying the project navigation rail.
- Designs has search, sorting, direct Open/Archive actions and compact entry points to pages/components. Framework, source folder and preview-update metadata live in Project details.

## Validation

- Production TypeScript/Vite build.
- 128 capture compiler, visual model and interchange export tests.
- Real Electron smoke tests cover first-press drag, stable release geometry, Escape, Shift-deselect, tiny SVG selection, matching layer/inspector selection, drawing and moving overlays, validated save/load, inline text editing, resize, undo and redo.
- Pages smoke covers direct capture, grouped multi-size capture, concrete dynamic paths, HTTP failures, credential and manual sign-in/resume, separate sessions, cancellation and narrow layouts.
- UI smoke covers light/dark workspaces, search, project/design/page archive and restore, inspector/settings/export, presentation and minimum window width. Native drawing/layout/prototype workflow smoke also passes.

The synthetic large-canvas fixture has 1,211 structured nodes and 904 text nodes. A 40-sample direct drag, one animation frame per sample, measured median 16.6 ms, p95 18.4 ms, max 20 ms on this Intel Mac. Pan tests deliberately wait two frames per sample and have an approximately 33 ms floor. These are controlled regression measurements, not a universal latency or frame-rate guarantee.

## Reproduction

```sh
PATH="/Users/leadsprint/.bun/bin:$PATH" bun run build
PATH="/Users/leadsprint/.bun/bin:$PATH" bun test src/core/capture-compiler src/core/visual src/core/export/frameuiPackage.test.ts
FRAMEUI_DIRECT_DRAG=1 FRAMEUI_CANVAS_STRESS=1 FRAMEUI_CANVAS_PROFILE=/tmp/frameui-canvas-profile.json FRAMEUI_CAMERA_GESTURES=1 node scripts/smoke-capture-editability.cjs
node scripts/smoke-pages-workflow.cjs
node scripts/smoke-ui-polish.cjs
```

All work stays local. Source projects and user databases are preserved. Each new review package uses the existing build-specific fresh-profile hook.

## Final review packages

The final Intel review app passed the complete Pages capture workflow and the real Budget home-page canvas test at `http://budget.localhost:4180/`: 2,351 structured elements, 693 editable text nodes, and a 14,348px capture. Direct-drag samples measured median 16.9 ms, p95 18.7 ms, max 19.4 ms. Pan samples measured median 33.5 ms, p95 35.2 ms, max 40.4 ms with the two-frame test floor described above. No renderer errors occurred.

Both DMGs passed `hdiutil verify`; all seven bundled renderer files match the final production build. Both use distinct fresh review profiles. The ARM executable has the correct arm64 architecture; ARM execution could not be tested on this Intel host. The latest verified x64/arm64 DMGs, blockmaps, app bundles and packaging metadata are the only release artifacts retained in `release/`. No commits, pushes, publishing or GitHub workflows were performed.
