# Adobe XD export: implementation and compatibility

## Implemented route

Use **File → Export → Adobe XD · Sketch Bridge** or choose Adobe XD in the canvas Export dialog. Choose the current artboard, a prototype flow, or all saved designs in the connected project. Save the resulting **`.sketch`** document through the OS Save dialog. Open it in Adobe XD, review its layers and compatibility report, then save as `.xd`.

**Direct `.xd` generation is not implemented or advertised. Adobe XD and Sketch are not installed in this development environment. Adobe XD open/save/reopen, target rendering, visual comparison and interactive editing remain unverified.** Schema validation is not a substitute for these checks.

All conversion remains local. It uses the current in-memory design, including approved AI changes and unsaved canvas edits; other project designs are loaded from local saves. It does not ask AI to recreate the design, fetch the running website, install an XD plugin, or upload repository data. Font binaries are not exported.

## Repository assessment

The Electron entry is `src/main/index.ts`, window/menu setup lives in `src/main/windows`, IPC handlers in `src/main/ipc/handlers`, and the typed context-isolated bridge in `src/preload/index.ts` and `src/shared/ipc-contract.ts`. `src/core/visual/schema.ts` validates saved `VisualDocument` projects; `designIde.handlers.ts` handles local save/load and capture orchestration. `DesignIde.tsx` owns editable state and history.

There are persisted legacy `VisualObject` trees and native `StructuredFrame`/`StructuredNode` trees inside `VisualPage`. Captured browser DOM and computed styles enter through `cdp/domSnapshot.ts`, `reconstructSnapshotTree.ts`, `captureResources.ts`, and the capture compiler. `StructuredFrameView.tsx` and `renderStructuredFrameToHtml.ts` render the native tree. Visual-only overlay edits remain in `page.objects` with `designOnly`.

Repository scanning and component extraction are in the core indexer/adapters; captured bindings identify repository components and design tokens. Native text includes font metrics and optional rich ranges/measured line fragments. Images are embedded source data URIs. SVG geometry is retained on structured sources. Components reference masters/instances; the prototype model stores flows, states and interactions separately. AI draft approval imports editable pages into these same document structures.

The existing export coordinator is `ExportWorkspace.tsx`; the existing canonical export representation and asset collection are in `frameuiPackage.ts`/`frameuiExport.ts`. Existing SVG, PNG, PDF, Figma and developer handoff workflows remain. The old Adobe XD choice only produced `.frameui` importer data. It now uses an actual Sketch writer.

Data limitations: a previously rasterized layer cannot recover its original DOM from pixels. Capture drops non-visible source elements before serialization, so export cannot resurrect them. Captured native hidden layers still stored in the project are preserved. Computed geometry represents a particular captured state, not responsive application logic. Font family/weight data does not guarantee the font is installed on another machine. Unsupported browser effects and complex transforms need conversion review. No exporter can restore data already lost during an older capture.

The canonical package previously used a 5% visual-diff gate to choose between native and legacy data. It now always uses an available native tree plus designer overlays, matching the canvas. This prevents export of stale flattened screenshots over an edited design. Selection traversal also now collects all selected siblings.

## Format research and decision

- [Sketch file format](https://developer.sketch.com/file-format/) documents the ZIP-based format: `document.json`, `meta.json`, `user.json`, `pages/*.json`, original image resources, and optional previews.
- [Official schemas and types](https://github.com/sketch-hq/sketch-document) are pinned through `@sketch-hq/sketch-file-format` and `@sketch-hq/sketch-file-format-ts` 6.5.0. The writer targets schema document version 121, compatibility version 99. JSON is validated against the official page/document/meta/user schemas before saving.
- [Adobe’s Sketch import matrix](https://helpx.adobe.com/xd/desktop/troubleshooting/import-export-and-working-with-other-apps/open-sketch-files-in-xd.html) documents native layers and artboards, but partial support for typography metrics, shadows, masks and components. These are warnings, not claimed guarantees.
- [Adobe XD’s scenegraph API](https://developer.adobe.com/xd/uxp/develop/reference/scenegraph) can create native objects in the application. [Prototype interaction APIs are read-only](https://developer.adobe.com/xd/uxp/develop/reference/interactions). A plugin route cannot be assumed to author the complete prototype.
- The supplied [community XD scenegraph toolkit](https://github.com/dilitirio/xd-scenegraph-toolkit) is useful reverse-engineering evidence, not an official writer specification or interoperability test. XD packages use metadata/manifests, artwork scenegraphs (`graphicContent.agc`), shared resources, images, interactions and renditions; archive entries resembling those structures do not establish valid document semantics. No genuine XD application-saved fixtures or XD installation were available to establish version requirements, identifiers, resource links, component semantics, interactions or save/reopen compatibility. Therefore a direct writer was not selected.

No ZIP is relabelled as `.xd`. A `.sketch` is itself a specified ZIP document, and this implementation writes its native object model and validates its contents.

## Conversion architecture

`sketchDocument.ts` adapts the existing typed canonical export model into official Sketch TypeScript objects. `sketchProject.ts` combines saved designs as separate Sketch pages, preserving their artboard coordinates. `sketchGeometry.ts` converts SVG paths, arcs, quadratics and primitives into editable Bezier contours. `sketchStyles.ts` converts colours, supported gradients, borders, shadows and blur. `sketchFonts.ts` resolves actual local face names when available; the macOS worker reads the OS font inventory without copying fonts. `sketchSvgResources.ts` expands saved local SVG symbols to editable paths where supported.

`sketchWorker.ts` performs conversion, validation, asset deduplication and ZIP generation outside the renderer/main UI threads. The existing ZIP writer is reused. Main-process IPC owns the Save dialog, job ownership, cancellation, temporary output, atomic replacement and cleanup. A window can have only one running export. The renderer displays actual stage messages, not invented percentages.

Every document includes `frameui/compatibility.json`, a stable source-ID mapping, canonical design metadata, and prototype definitions. Additional designs retain their individual companion metadata under `frameui/designs/`. Original image bytes are content-hash deduplicated. No network requests are necessary to open the export.

## Editable content and limits

| Feature | Implementation / limit |
| --- | --- |
| Artboards | Exact sizes, names, order, stored canvas positions, separate pages for separate designs |
| Groups | Nested editable groups; rectangle masks implement stored clipping |
| Text | Native text layers, content, bounds, colour, size, line height, letter spacing and rich range colour/face references; no outlines or text screenshots |
| Browser line fragments | Separate editable text layers preserve measured line positions; reported because editing is no longer a single paragraph |
| Fonts | Actual PostScript face names resolved from available macOS fonts; unresolved faces and all target font checks are reported; no licensed font binaries embedded |
| Forms | Background and editable hint/value text; native control rendering differences reported |
| Vectors | Paths, lines, rectangles, ellipses, polygons, cubic/quadratic curves, arcs, compound contours and available local SVG symbol contents remain editable |
| SVG effects | Referenced gradient paints, filters, arbitrary SVG masks/clips and unsupported references may require manual correction in Sketch/XD; warnings retain source geometry/effects |
| Images | Original bytes preserved; dimensions used for cover/contain crops and clipping; non-PNG/JPEG formats flagged for target codec review |
| Fills | sRGB conversion including supported CSS Color 4, solid colours, supported linear and circular radial gradients |
| Effects | Supported borders, per-corner radii, parsed drop/inner shadows and blur; Adobe-specific losses such as spread, group/multiple shadows reported |
| Unsupported CSS | Complex/multiple backgrounds, elliptical/conic gradients, blend modes, CSS masks/clips, backdrop filters and affine matrices are retained in companion metadata and reported; no whole-screen flattening |
| Components | Expand to editable instance layers when available; reusable native master/instance relationships and constraints are not guaranteed and are explicitly reported |
| Prototypes | Simple click-navigation writes Sketch wires; target behaviour unverified. Other triggers/actions/overlays/states/transition differences are reported and preserved in the companion manifest for reconnection |
| Previews / effect fallback | No target-rendered preview or new raster effect overlay is generated. Existing raster layers stay images. Unsupported effects may visibly differ; a warning is not a visual fallback |

## Validation and evidence

Automated fixtures in `scripts/generate-sketch-fixtures.ts` generate basic, dashboard, gradient-heavy, mobile/multi-state, component, and real captured MapMyMaintenance documents. Evidence is in `docs/verification/sketch-export-2026-10-16/`. Unit tests cover official schemas, editable object classes, exact artboard geometry, image byte preservation, compound paths, invalid paths, stable IDs, native-tree priority, form text, scopes, flow warnings, project page references, colours and font face lookup.

`smoke-sketch-export.cjs` exercises the native menu, UI options, OS-dialog result, real worker, saved archive/report, cancellation, wrong-extension rejection, and unchanged source design. ZIP integrity is checked independently. These tests prove local conversion and structural editability fields, **not editability or pixel accuracy inside Adobe XD**.

Required target validation remains: open each fixture in Adobe XD; inspect/select/edit text, vectors, groups and images; compare target screenshots against saved FrameUI artboards; inspect fonts and wire actions; save as `.xd`, close, reopen and repeat. Do not classify direct/native XD compatibility as verified until that succeeds.

## Files introduced or changed for export

- New: `src/core/export/sketchDocument.ts`, `sketchProject.ts`, `sketchGeometry.ts`, `sketchStyles.ts`, `sketchFonts.ts`, `sketchSvgResources.ts`, `sketchDocument.test.ts`.
- New: `src/main/export/sketchWorker.ts`, `localFonts.ts`; `src/shared/types/sketchExport.ts`.
- Updated: `frameuiPackage.ts`, `frameuiExport.ts`, `export.handlers.ts`, `ipc-contract.ts`, `preload/index.ts`, `ExportWorkspace.tsx`, `DesignIde.tsx`, `designMenu.ts`, `vite.config.ts`, `package.json`, `bun.lock`.
- New verification: `scripts/generate-sketch-fixtures.ts`, `scripts/smoke-sketch-export.cjs`, generated `.sketch` documents, reports and UI screenshots.

Separate capture improvements in this change retain scoped safe SVG definitions and recover supported standalone affine border boxes; their evidence and limitations are in `docs/verification/svg-transforms-2026-10-16/`.
