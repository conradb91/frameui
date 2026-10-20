# Native Adobe XD export

The Adobe XD choice previously called `export.saveSketch`, generated a `.sketch` archive, and required opening and resaving it in XD. It now calls a separate `export.saveXd` endpoint that writes `.xd` directly. The existing Sketch serializer and IPC are retained. There is no plugin, importer, converter service, bundled Adobe application or Sketch intermediate in this path.

## Implementation

`src/core/export/xdDocument.ts` uses the same FrameUI model normalizer as other exporters (`buildFrameUiPackage`), then serializes the normalized design directly into XD AGC nodes. It never calls the Sketch document builder. Small existing font-resolution, SVG-resource and geometry helpers are reused; they do not generate Sketch documents.

The renderer lets a user choose all artboards, a checkbox selection of artboards, or the current artboard. All requested artboards go into one document. Saved canvas coordinates, artboard sizes and names are retained.

`src/main/export/xdWorker.ts` runs serialization off the Electron main thread, checks the archive in memory, writes a temporary file exclusively, re-reads and validates it, then returns its report. The main process atomically renames the output only after these checks. Cancellation terminates the worker and removes temporary output. The source design and existing destination remain untouched until validation completes.

The archive uses an uncompressed, first-entry `mimetype`, DCX manifest format 6, AGC version 1.5.0, per-artboard scenegraphs under `artwork/artboard-<id>/graphics/graphicContent.agc`, a pasteboard scenegraph, centralized artboard/gradient resources, content-deduplicated image resources, interactions and XMP metadata. Optional bitmap previews are archive metadata only; they do not replace editable layers. `frameui/design.json` preserves the normalized source and component definitions for diagnostic fidelity. `frameui/compatibility.json` records all reported differences.

Editable output includes text and UTF-16 range formatting; font family, installed PostScript face identifiers, size, character spacing and alignment; rectangle corner radii; paths/ellipses/lines; gradients; strokes; opacity; native image pattern fills; nested groups; affine CSS transforms; and supported click navigation/back actions. Source images are embedded once by content hash and retain intrinsic dimensions. Form controls become editable design geometry and text rather than runtime inputs.

## Evidence and honest compatibility status

Two **genuine Adobe-authored native documents** were downloaded and inspected:

- [Adobe XD to Flutter test suite](https://github.com/AdobeXD/xd-to-flutter-plugin/blob/master/test_suite/tests_suite.xd): 12 artboards, nested groups, text, components, gradients and images; XD serialization version 2.27.
- [Adobe XD plugin sample banner](https://github.com/AdobeXD/plugin-samples/blob/master/e2e-customize-banner/banner.xd): pasteboard objects, native paths, image pattern fills and a centralized gradient; XD serialization version 0.48.

Exact commits, SHA-256 digests, archive paths, schema versions and node counts are recorded in [references.json](verification/native-xd-2026-10-19/references.json). No third-party fixture artwork is bundled in FrameUI. Adobe's [Creative Cloud representation documentation](https://developer.adobe.com/creative-cloud-libraries/docs/integrate/guides/working-with-elements/accessing-file-formats/) identifies AGC JSON as an XD representation; this is not a published complete native-file writer specification.

Automated checks cover one/multiple/selected artboards, nested groups, large designs, native text ranges, gradients, vector paths, deduplicated images, navigation, source immutability, manifest references and checksum-corruption rejection.

**Adobe XD is not installed in this environment. Opening, editing, saving and reopening the generated document has not been tested in Adobe XD. A valid ZIP/DCX archive alone does not establish application compatibility.** The UI and every export report explicitly retain `applicationValidation: unverified`; they do not certify the file as XD-tested. Acceptance criterion “Adobe XD opens without an invalid-document error” remains unverified.

## Limitations that remain visible in reports

- Unchanged, same-size component instances now link to centralized native XD symbol definitions using `symbolId`, `syncMap` and `syncRef`. Locally overridden, resized and variant instances retain editable expanded groups and report that linking difference. Circular or missing definitions are explicitly reported.
- Nested rounded overflow, polygon/circle/ellipse/inset/path CSS clips and supported SVG clip definitions now use centralized native editable `clipPath` resources. Intersecting regions remain nested. One-axis overflow currently approximates both axes and is reported. CSS alpha/luminance masks, unsupported compound clip syntax and unsupported SVG clipping need review.
- Drop shadows, inner shadows, object blur and background blur now use native XD effect structures. CSS box shadows are attached to native background graphics, matching genuine XD GraphicNode encoding; Group nodes never receive unsupported filters. True group-composite object blur is reported rather than emitting an unsupported effect. Backdrop blur remains attached to its background geometry. Blur values over Adobe’s documented 50 limit are clamped with a warning. CSS/XD blur kernel parity, shadow spread, arbitrary CSS filter functions and blend modes still require review. Elliptical radial gradients use a circular editable approximation; gradient text geometry, multiple paints and unsupported SVG paints remain reported.
- Font files are not embedded or installed. Receiving machines need the original faces. Locally available font identifiers are resolved; missing faces are reported rather than silently certified.
- SVG paths and common symbols are editable, but unsupported SVG resource/filter behavior is reported. No artboard is rasterized to hide incompatibilities.
- PNG, JPEG and GIF image resources are supported. Other source image formats are reported; unsupported source images are not claimed to be preserved.
- Only supported click navigation/back actions are translated. Other runtime actions, overlays, conditions and non-click triggers need reconnecting in XD.
- Captured line positions are retained where available. XD font metrics, baseline placement and reflow require application-level comparison; exact typographic equivalence is not yet certified.

The writer is a concrete direct native serialization path, not a renamed Sketch archive. The remaining compatibility work must be driven by actual Adobe XD open/render/edit tests rather than claims based on archive integrity alone.

## Component, nested clipping and effects follow-up — 20 October 2026

The [Adobe plugin sticker-sheet document](https://github.com/AdobeXD/plugin-design-assets/blob/master/Sticker_sheet_XD_plugins.xd) contains 22 actual centralized clip resources and mask groups referencing them through `style.clipPath.ref`. These native structures now drive the clipping writer. The previously inspected Adobe XD to Flutter test document supplies genuine component definitions, symbol identifiers, sync references and nested-symbol metadata.

Two additional creator-authored `.xd` documents were inspected for native effect structures: [Glassmorphism website](https://github.com/Vignajith/Glassmorphism-website-in-adobe-xd) and [Shadow button effect](https://github.com/abdul-uiux/shadow-button-effect-adobe-xd). Their archives contain `uxdesign#blur`, `uxdesign#innerShadow` and `dropShadow` filters. Their exact source commits, archive hashes and small effect-structure projections are recorded in [follow-up references](verification/native-xd-2026-10-20/references.json). No sample artwork or binary documents are redistributed. Adobe’s [Blur API](https://developer.adobe.com/xd/uxp/develop/reference/blur) confirms the 0–50 blur amount range and background/object semantics.

These improvements remove the blanket component/nested-clipping/effect exclusions, while the specific differences above remain visible in every affected export report. They do **not** replace Adobe XD application-level open, edit, render, save and reopen testing; that status remains unverified.

## Layered HTML background export correction — 20 October 2026

A real Academy export failed because a greedy single-gradient parser consumed `linear-gradient(...), url(...)` as one gradient, then attempted to parse the URL payload as a colour stop. The exporter now splits CSS layers while respecting function nesting, quotes and escapes. Each background becomes its own editable native layer, with the first CSS layer painted on top. Embedded photos are deduplicated native resources; cover/contain/explicit sizes and common percentage/pixel positions are represented by editable image rectangles inside rounded native clipping groups. Unsupported individual paints produce bounded, redacted warnings rather than aborting all artboards.

Captured control typography no longer replaces the entire field with a text layer: field geometry is retained, text keeps captured font properties, and selects export the selected display label rather than the underlying option value.

The original 22-screen Academy capture and the user's current 40-screen design were both exported read-only from their saved sources. Independent ZIP CRC validation passed; all 18 and 19 respectively observed image-plus-gradient groups retained image-below-overlay order. The 40-screen native archive is approximately 42.2 MB. Detailed archive sizes, hashes, measured writer times, warning bounds and native layer counts are recorded in [22-screen evidence](verification/native-xd-2026-10-20/academy-background-export.json) and [40-screen evidence](verification/native-xd-2026-10-20/academy-current40-export.json). Adobe XD application open/edit/render validation remains unverified.

## Native style/paint correction after Adobe XD 61 report — 20 October 2026

The user's actual XD 61 rendering exposed failures that ZIP validation had not detected. Three separate encoding/normalization defects were identified and corrected:

1. Chromium exposes computed SVG `fill` even on ordinary HTML containers. The shared export normalizer incorrectly used that default black fill when an HTML background was transparent. It also painted inherited SVG fill as a bounding rectangle around `svg`/`g` wrappers. HTML containers now use CSS backgrounds only; SVG leaf geometry retains SVG paint. `background-image: none` correctly allows a real background colour. This shared correction also applies to the Figma and Sketch normalized models.
2. A serialization 2.27 native document was using legacy external gradient references from an older fixture. Gradient styles now use the exact inline `gradient.meta.ux.gradientResources` structure observed in Adobe's genuine 2.27 test document. Opaque RGB colours omit redundant alpha 1 as native documents do; semitransparent colours retain native alpha.
3. Filters had been attached to Group nodes, although native graphic effects in the genuine fixtures are encoded on shapes/text. CSS card shadows now belong to native card/background geometry. Validation explicitly rejects Group filters. True composite group blur remains a reported limitation.

A small independent projection extracted from the genuine Adobe document is checked in at `tests/fixtures/xd/adobe-native-style-projection.json`. Regression tests compare generated opaque-white paints, inline gradient definitions and font fields against these independent native structures. The current 40-screen archive audit found 1,985 opaque black background rectangles and 532 Group filters in the earlier file, versus zero of each in the corrected archive. All 101 gradient placements now use the native inline encoding. Full evidence and archive hashes are in [native-style-correction.json](verification/native-xd-2026-10-20/native-style-correction.json).

The synthetic outer export frame has also been removed. Each native artboard keeps the source dimensions; actual source layers are emitted directly and the saved canvas origin is applied once. Nonzero-origin tests verify a 1440px artboard stays 1440px without padding, scaling or duplicate root frames. Legitimate CSS layout groups are retained.

Font resolution now accepts actual browser-rendered family/PostScript faces keyed by CSS stack, weight and style, before falling back to the first available CSS family and nearest installed weight. It does not invent a `PublicSans-Bold` PostScript face when that font is absent. Optional browser-measured `baselineBySize` values position text using the captured line-box midpoint plus the measured baseline delta; missing measurements remain explicitly reported.

These are concrete source/structure corrections, not a claim of destination pixel parity. Actual Adobe XD 61 open/render/edit comparison is still required; `applicationValidation` remains `unverified`.

## Final root projection and image-only colour effects

A captured `frameui-root` is synthetic, separate from the real HTML body. The native writer now removes that additional wrapper only when its measured origin/transform, dimensions, opacity and effects prove it safe, and no direct interaction references its identity. A single opaque solid wrapper background is transferred to the native artboard; nontrivial paints/effects are retained as layers. Real source body/layout groups are preserved. An independent ID audit of all 40 current source screens confirms zero artificial capture wrappers and all 40 real body groups remain, with 1440px artboards. See [root-projection evidence](verification/native-xd-2026-10-20/academy-current40-root-fix.json).

The writer also accepts browser-rendered image-only CSS colour adjustments through a fifth `renderedImages` argument. Substitution requires one embedded background source, no text/controls/children, and an exact source/filter mapping. Only supported colour-only operations qualify. The resulting image remains an editable native image fill with independent crop geometry; the colour adjustment is baked into pixels, not an editable XD filter control. Original image data remains in the companion model. Compound group effects are still reported, and invalid processed image data preserves the original.

Measured font fallback messages now describe matching the current browser-rendered face, rather than suggesting installation of a different first-declared font. Installing that different font could change the current browser appearance. The destination still needs the matching face.

### Referenced icons and destination canvas bounds (20 October)

The user-opened candidate exposed two additional defects. SVG `<use>` expansion discarded inherited strokes, producing native paths with both fill and stroke disabled. Expansion now inherits source and symbol/group paint styles, width and `currentColor`, while keeping geometry attributes local. The current 40-screen source audit now finds visible strokes on all 1,698 referenced icon shapes (previous candidate: 40 of 1,698).

The same candidate placed screens down to y=47,642, outside XD's visible canvas. Adobe's developer forum describes its 50,000-by-50,000 GUI canvas ([reference](https://forums.creativeclouddeveloper.com/t/rootnode-width-and-height/2387/2)). Existing placements inside ±25,000 remain unchanged; out-of-range collections are packed and centered without scaling any artboard or child geometry. The current source now occupies x=−5,760…5,760 and y=−8,857.5…8,857.5, retaining all 40 artboards at 1,440 pixels wide and their source heights. Oversized collections fail explicitly instead of silently scaling or clipping screens.

Evidence: `verification/native-xd-2026-10-20/svg-canvas-correction.json`. This audits emitted native data and CRCs; actual XD 61 visual parity still requires destination review. Private dynamically named macOS UI fonts remain an application interoperability concern addressed by the browser font preparation layer, separately from the writer.

### CSS stacking, image crops and text units (20 October follow-up)

The original hero stored its positioned text (`z-index:1`) before a later zero-index pseudo-element gradient. Raw DOM serialization placed that gradient over the text. Native child emission now uses stable sibling CSS z-index order, leaving parent backgrounds behind all children. The actual first Academy hero now emits background, image, gradient, then text container. This handles the captured sibling stacking levels; unsupported complex browser compositing still requires destination visual review.

Replaced image elements now use an explicit native image rectangle and rounded crop mask for CSS `object-fit` and `object-position`, instead of relying on an approximate destination crop hint. Single-line controls center their editable text line vertically; multiline controls retain their padding. Stroke descriptors are omitted for unpainted objects, SVG strokes use centered alignment with captured caps/joins, and flattened SVG viewport scaling also scales stroke widths.

XD tracking uses thousandths of font size, whereas CSS letter spacing is in pixels. Ranged text now converts using each run's font size: −2.43px at 54px becomes −45 XD tracking units ([Adobe Text reference](https://adobexdplatform.com/plugin-docs/reference/scenegraph.html)). Regression coverage checks ordering, tracking, absent strokes, asymmetric control padding and image fit/position geometry. These corrections do not constitute an XD rendering parity certification.

### Referenced symbol viewports and native radio rings (20 October, v4)

A 15px outer SVG can omit its own `viewBox` while its referenced `<symbol>` declares `0 0 24 24`. Previously, the symbol path remained in 24px coordinates and its right/bottom edges were cut off by the correct 15px viewport clip. The writer now maps the symbol viewBox into the SVG viewport's user coordinates before the existing outer mapping. It uses the enclosing viewport rather than the `<use>` element's tight painted bounds. Regression tests cover both an absent outer viewBox and matching outer/symbol viewBoxes, preventing double scaling: the source circle spans 1.875…13.125px, and its 1.8-unit stroke becomes 1.125px.

Browser-default radio controls can have no computed CSS border or background while still painting a native UI ring. For native appearance, the export now creates an editable ellipse and explicit ring, including unchecked radios; custom `appearance:none` controls retain their own styles. The report identifies this as a platform styling approximation. Native clip resource coordinates were checked against genuine Adobe fixtures; they remain local to their clipping group.

### HTML border containing-block coordinates (20 October)

FrameUI's HTML renderer places captured children absolutely inside bordered divs. Their CSS containing-block origin is the padding edge, adding the parent's border width to `left`/`top`; native groups have no such implicit border box. Neutral export now explicitly adds an effective HTML parent border inset to each immediate child. It does not add padding or alter SVG geometry coordinates. An independent Chromium fixture confirmed nested global bounds against the normalized local coordinates. In the actual 40-screen source, 887 bordered parents affected 5,373 descendants, with at most 2px cumulative drift. This is a small verified placement correction, not an explanation for every observed spacing difference. Evidence: `verification/native-xd-2026-10-20/border-containing-block.json`.
