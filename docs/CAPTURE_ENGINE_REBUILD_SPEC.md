# FrameUI capture engine rebuild

Companion spec to `docs/PROJECT_WORKSPACE_CAPTURE_CANVAS_REBUILD_SPEC.md`. This one replaces the *capture pipeline itself* — what happens between "user presses Capture" and "editable layers exist" — not the surrounding workspace UX. Read together: the workspace spec's §5–10 (canvas interaction engine, text editing, grouping) are subsumed and superseded by this document's §14–18 and §6, since the rendering technology those depend on (HTML/CSS vs SVG) changes here.

## Final verdict

Do not replace FrameUI's current capture system with another HTML screenshot library. Keep the work already in place around Chromium, localhost, repository analysis and CDP. Replace the weak middle section that currently turns DOM information into an editable SVG.

New pipeline:

```
Running application
→ Chromium screenshot (visual reference)
→ CDP DOMSnapshot (actual browser layout)
→ Matched CSS and repository CSS
→ rrweb state snapshot
→ Asset and font resolver
→ FrameUI Design Model
→ HTML/CSS design renderer
→ Pixel comparison
→ Automatic repair or selective image fallback
→ Editable FrameUI canvas
```

**SVG becomes an export format. It is no longer the core editable format.** That is the main decision.

## 1. What we keep

Do not throw the current system away. Keep: project creation, local repository connection, local runtime connection, the Chromium capture browser, the existing CDP connection, route discovery, component discovery, style/token discovery, asset discovery, Desktop/Tablet/Mobile viewports, existing project structure, the existing design-canvas concept, SVG export, future Figma export. The current browser capture already solves the hardest problem (seeing the real running product) — the issue is only what happens after Capture is pressed.

## 2. Replace the DOM capture pipeline

Current logic relies too heavily on plain DOM traversal + computed styles + rebuild. Switch the capture source to Chrome's `DOMSnapshot.captureSnapshot()` — it returns DOM, layout and style information, including layout rectangles and paint order, with Shadow DOM flattened into the result.

Request: `includePaintOrder: true`, `includeDOMRects: true`, `includeBlendedBackgroundColors: true` and `includeTextColorOpacities: true` where supported, plus the specific CSS properties FrameUI needs.

**Implementation note:** don't target CDP tip-of-tree definitions — they aren't guaranteed backwards compatible. Use the protocol version the bundled Electron's Chromium actually supports, and feature-detect optional fields.

## 3. Capture three sources at exactly the same moment

On "Capture screen," collect all three before the page can change:

- **A. Visual reference** — Chromium's own screenshot. This is the truth. Store it internally (`original.png`); never recreate the page without keeping it.
- **B. Browser layout snapshot** — DOM, layout bounds, text boxes, computed styles, paint order, scroll info, element relationships (via DOMSnapshot).
- **C. State snapshot** — via `rrweb-snapshot` (MIT), which serializes the current DOM into a stateful representation, preserving things like input values and handling stylesheets for reconstruction.

Together: what the browser looks like, what it calculated, and what state the app is in.

## 4. Capture state, not merely URL

A capture record becomes:

```
name, route, viewport, scroll {x,y}, state,
browserSnapshot, domSnapshot, screenshot, assets, fonts,
repositoryMappings, timestamp
```

Because `/users` can mean "Users list," "Users with filters open," "Users with search entered," "Users with dropdown open," "Users with edit modal open," "Users permissions tab selected" — all different design screens sharing one URL.

## 5. Stop generating the editable SVG immediately

Current: Browser → DOM → SVG → editor. New: Browser → FrameUI Design Model → editor, with FrameUI Design Model → SVG as a separate export step.

A captured button should not internally be `<rect><text>`. It should become something like:

```
Button { x, y, width, height,
  layout: { direction: horizontal, gap: 8, align: center },
  padding: { top: 12, right: 16, bottom: 12, left: 16 },
  background: { token: 'primary-600', rendered: '#...' },
  radius: { token: 'radius-md', rendered: 6 },
  children: [Icon, Text] }
```

## 6. Proper FrameUI layer types

At least: Frame, Section, Container, Group, Component instance, Text, Image, SVG, Icon, Shape, Input, Button, Unknown web element, Raster fallback. Do not translate every `div` into a Group — that produces hundreds of useless nested groups. Add a normalization stage: DOM wrappers that exist only for structure with no meaningful visual/layout behaviour collapse away (e.g. `div>div>div>h1` with no visual purpose becomes `Container > Heading`). This keeps the Layers panel clean.

## 7. Preserve layout information

Don't immediately flatten everything to x/y. `display:flex; flex-direction:column; gap:24px` → `layout: vertical, gap: 24`. `display:grid` → store the grid definition. Absolute positioning is preserved as such. FrameUI should distinguish free positioning, stack layout, grid layout, and component-internal layout — editing a captured design must not destroy the relationships that made the page work.

## 8. Use real browser geometry

Don't recalculate text/element positioning if Chromium already did. Capture actual browser bounds per visible element; for text, capture the actual text boxes/line-wrapping info from the browser snapshot rather than estimating wrap points from width heuristics. This directly targets the broken-heading-wrap class of bug.

## 9. Improve CSS collection

Capture computed values needed for rendering — display, position, inset, width/height incl. min/max, margin, padding, gap, box-sizing, flex/grid properties, overflow, visibility, z-index, font family/size/weight/style, line-height, letter-spacing, text-align, text-decoration, white-space, word-break, text colour, background colour/image, borders, radius, shadows, opacity, transforms, object-fit/position, clipping. Not every CSS property in existence — define a fixed FrameUI capture property set to keep payloads bounded.

## 10. Map computed CSS back to the repository

The browser says `padding: 16px`; the repository says `--space-4: 16px`. Store both: `padding: 16, token: --space-4`. Same for font-size → a typography token, colour hex → a colour token. Use **CSS Tree** (MIT) to parse and walk project CSS instead of regex. Build an indexed `StyleIndex` at project-analysis time: variables, selectors, media queries, font-faces, keyframes, source files, detected Tailwind-generated values, token mappings. Use that index during capture.

## 11. Repository values never override the browser

Chromium output is the truth for appearance; the repository supplies meaning. Store both `16px` (browser) and `var(--space-md)` (repository) — never decide the page "should" use a different value because a source parser resolved a class differently. The live rendered result always wins.

## 12. Proper asset resolver

One central asset collection service resolving: `img src`, `srcset`, `picture`, CSS `background-image`, inline SVG, SVG `<use>` references, data URLs, local repository images, generated blob URLs, icons, pseudo-element images, masks, CSS gradients. Map each back to the repository where possible (`blob:http://...` → `src/assets/dashboard/phone.png` → FrameUI asset `asset_3928`). The design references the stable FrameUI asset record, never an unstable browser URL.

## 13. Fonts

Detect fonts actually used on-screen via the browser, then map to `@font-face` declarations / local font files / repository font files / system fonts. Use **Fontkit** (MIT) for inspection/metrics/export. Store family, style, weight, source, metrics. Never silently substitute a font during capture — flag unresolved fonts internally instead.

## 14. Render captured pages as HTML/CSS, not SVG

Second major architectural recommendation. Render inside the editor as: FrameUI canvas → Design frame → **HTML/CSS design renderer** → FrameUI interaction overlay. This reuses the same rendering technology as the original site (real text rendering/line-wrapping, flex, grid, shadows, borders, radius, background images, SVG, image fit, CSS transforms), which should sharply reduce visual drift versus SVG reconstruction.

## 15. Live app and design stay independent

Do not embed the original running page after capture (that would make it impossible to edit independently). Capture produces a FrameUI Design Model; the FrameUI renderer generates its *own* DOM/CSS from that model. `Live localhost → capture → FrameUI model → independent editable HTML/CSS representation`. Editing the design never touches localhost.

## 16. Moveable for canvas manipulation

Use **Moveable** (MIT) instead of hand-building drag/resize/scale/rotate/group/snap. Moveable is the interaction layer around FrameUI objects — it never becomes the document model. FrameUI owns the data.

## 17. Selecto for selection

Use **Selecto** (MIT) for click / shift-click / drag-marquee / multi-selection / select-group / select-children. Moveable then handles transforms for the resulting selection.

## 18. Text editing is separate from Moveable

Dedicated inline text-editing layer, not Moveable. Double-click a Text node → enter text-edit mode; the real design text stays exactly where it is; caret appears inside it; no white input, no duplicate text, no giant bounding rectangle, no ghost copy; edits update the FrameUI model; ending edit mode returns to normal selection. Needs its own implementation (this is the same requirement as the workspace spec's §7, now scoped against an HTML/CSS-rendered text node instead of an SVG `foreignObject`).

## 19. BuilderIO `figma-html` as reference only

Useful because its purpose is specifically HTML→editable-design conversion (MIT). Study it for HTML-to-design conversion, text treatment, borders, images, SVG handling, layer construction, Figma-compatible concepts — pull ideas/code selectively. Do not shape FrameUI around its full implementation; FrameUI's Chromium+repository+editor combination can do more.

## 20. Automatic visual verification

After the design model builds: render it at the captured dimensions, screenshot it, and compare against the original Chromium screenshot using **Pixelmatch** (ISC). Produce `capture-original.png`, `frameui-render.png`, `capture-diff.png`, and compute different-pixel count / total pixels / difference percentage. This gives an objective capture test.

## 21. Per-capture quality score

E.g. visual match 98.4%, editable coverage 96.8%, mapped assets 100%, mapped fonts 100%, raster fallback 1.3%. Not necessarily shown to every designer yet — visible in a development/debug view first, so capture-engine changes can be measured as better or worse over time.

## 22. Selective raster fallback

Not every web technology becomes an editable object (canvas, WebGL, video, maps, complex charts, cross-origin iframes, unusual masks, third-party widgets, unusual browser effects). When a subtree can't be recreated accurately, rasterize *only that subtree* — never flatten the whole page. E.g. a dashboard frame keeps Header/Sidebar/Cards/Footer editable while a complex WebGL graph becomes an image fallback.

## 23. Automatic fallback decision

Reconstruct element subtree → diff against target via the comparison engine → if diff exceeds threshold, attempt correction → if still poor, rasterize that subtree → re-render → compare again. Visual validation becomes part of the capture pipeline itself, not a manual afterthought.

## 24. Stricter policy for text

Incorrect text is highly noticeable and destroys editability. Resolve font, weight, size, line-height, letter-spacing, width, white-space, text-transform, and wrapping fully before ever considering a text fallback.

## 25. Pseudo-elements

Capture `::before`/`::after` — common for icons, decorative lines, badges, background shapes, bullets, buttons. The normal DOM tree doesn't treat these as elements, but visually they matter; generate child design nodes for them where appropriate.

## 26. Respect clipping

Correctly capture `overflow: hidden`, border-radius clipping, `clip-path`, masks where feasible, and scroll containers — otherwise designs look wrong even when child positions are individually correct.

## 27. Fixed and sticky elements

Store both their original layout behaviour *and* their actual captured position — a FrameUI design represents a visual state, and must initially look exactly like the state that was captured.

## 28. Page scroll / capture scope

Distinguish viewport capture, full-page capture, section capture, and current-state capture. Default "Capture screen" to the **viewport**, not the whole document. Offer: Capture visible screen / Capture full page / Capture selected area.

## 29. Full-page capture assembly

Capture complete document dimensions, preserve sticky/fixed behaviour carefully, avoid duplicating fixed headers during stitched screenshots, build one tall FrameUI frame. On open: fit width, start at the top — never zoom to fit the full height of a very tall page (this is the same requirement as workspace spec §22).

## 30. Component matching after visual capture

Use existing repository analysis after capture, not instead of it. E.g. `<button class="btn btn-primary">` known from source analysis to originate from `PrimaryButton` → mark the design node `type: ComponentInstance, source: src/components/PrimaryButton..., variant: primary`. Only when confidence is strong — never incorrectly promote generic DOM into a component instance.

## 31. Capture confidence

Every generated node can carry `layoutConfidence`, `componentConfidence`, `assetConfidence`, `fontConfidence`, `tokenConfidence` — used to decide what to auto-link (e.g. a 98% button match gets linked; a 54% "maybe Card" match stays a plain container).

## 32. The new capture pipeline (end to end)

```
User navigates localhost
→ Selects Desktop/Tablet/Mobile/Custom
→ Clicks Capture screen
→ Freeze current browser state temporarily
→ Capture Chromium screenshot
→ Capture DOMSnapshot
→ Capture rrweb snapshot
→ Collect browser CSS data
→ Resolve fonts
→ Resolve assets
→ Map CSS back to repository styles/tokens
→ Normalize DOM structure
→ Create FrameUI Design Model
→ Render editable FrameUI version
→ Screenshot FrameUI rendering
→ Pixelmatch against Chromium
→ Correct major differences
→ Apply selective fallback where required
→ Save design frame
→ Display capture in Capture sidebar
→ User keeps browsing and capturing
→ Done
→ Frames already exist on design canvas
```

## 33. Capture loader — real stages

```
Creating editable design
Budget homepage · Desktop · 1440 × 1024

Capturing rendered page          Complete
Reading browser layout           Complete
Collecting styles                Complete
Resolving fonts and images       Complete
Building editable layers         Complete
Checking visual accuracy         Running
```

Then: "Capture ready — 98.6% visual match, 143 editable layers, 32 project components matched, 61 project styles linked, 2 elements preserved as images" with **Add another capture** / **Done**. Hide the percentage/technical counts for normal users eventually; keep them visible during development.

## 34. Dependencies to add

- **CDP `DOMSnapshot`** — core capture source, likely no separate package (existing CDP connection can call it).
- **rrweb / rrweb-snapshot** (MIT) — state preservation.
- **CSS Tree** (MIT) — repository CSS parsing / style-token index.
- **Fontkit** (MIT) — font inspection, metrics, export support.
- **Moveable** (MIT) — drag/resize/snap/transform interaction layer.
- **Selecto** (MIT) — canvas selection/multi-selection.
- **Pixelmatch** (ISC) — automated visual comparison.
- **BuilderIO `figma-html`** (MIT) — reference/selective reuse only, not a dependency.

## 35. What NOT to add as the core

Do not make `html2canvas` the capture engine. Do not make `html-to-image` the editable-conversion engine. Do not make Fabric.js the primary renderer yet. Do not introduce another browser (Electron's Chromium already suffices). Do not immediately convert captures to SVG. Do not rasterize whole pages. Do not use screenshots as editable layers. Do not replace the repository scanner. Do not create hundreds of one-to-one DOM wrapper layers.

## 36. Versioned design schema

```
FrameUIDocument { version, projectId, designId, frames[], assets[], fonts[], tokens[], sources[] }
Frame { id, name, viewport, sourceRoute, sourceState, width, height, children[], captureMetadata }
Node { id, type, name, parentId, children[], bounds, layout, appearance, typography,
       source, tokenBindings, componentBinding, constraints, visibility, locked, captureConfidence }
```

This becomes FrameUI's internal format.

## 37. Don't bind the editor to captured DOM nodes

Captured browser nodes disappear on navigation. Generate stable FrameUI IDs (`backendNodeId 9381` → `node_01J...`), keeping source metadata for debugging/source-matching. The editor works entirely from the FrameUI model after capture.

## 38. Migration for existing designs

Don't break current users or existing test designs. Support **Legacy SVG Design** and **Structured Design V2** side by side — old designs keep rendering through the legacy route; new captures use V2. A later "Convert legacy design" action can be added; do not attempt to auto-migrate every old SVG design in this change.

## 39. Build in stages

1. Add DOMSnapshot capture beside the existing scanner. Don't remove anything. Log both outputs, compare results.
2. Build the new FrameUI Design Model. Create captured documents without showing them to users yet.
3. Build the HTML/CSS design renderer. Render captured models beside the existing SVG output.
4. Add screenshot comparison + Pixelmatch. Measure which renderer is more accurate.
5. Make the new renderer the default for new captures. Keep the old SVG route as fallback.
6. Add Moveable and Selecto. Replace current canvas manipulation.
7. Implement correct inline text editing.
8. Add token, component, font and repository mappings.
9. Add selective raster fallback.
10. Remove obsolete capture and SVG-generation paths once the new engine consistently passes tests.

## 40. Do not do one massive rewrite

Do not rewrite FrameUI from scratch. Do not remove the current capture implementation until the new pipeline is proven. Introduce the new capture engine behind an internal feature flag — `captureEngine: 'legacy' | 'structured-v2'` — switchable during development, so the same page can be compared directly across both engines.

## 41. Capture regression suite

Local test pages covering: simple text, multiline heading, nested flex, CSS grid, responsive navigation, cards, images, SVGs, icons, custom fonts, gradients, shadows, border radius, absolute positioning, sticky header, fixed button, modal, dropdown, form values, pseudo-elements, overflow clipping, long page, mobile breakpoint, tablet breakpoint, canvas element. Every capture-engine change runs this suite.

## 42. Real-world fixture

Use the Budget project as a permanent capture fixture — it already exposes problems with large heading text, responsive layout, images, large page heights, and positioning. Capture at 1440 desktop / 768 tablet / 390 mobile and keep expected screenshots for all three.

## 43. Measurable quality targets

- Standard HTML/CSS screen: ≥98% pixel similarity.
- Text: no obvious wrapping mismatch.
- Fonts: 100% of locally-available captured fonts resolved.
- Images: 100% of accessible local assets resolved.
- Common layouts: no raster fallback for normal flex/grid content.
- Canvas/WebGL/unsupported content: selective fallback permitted.
- Basic capture: should not require manual repair of positioning.

## 44. Performance targets

Don't block capture for 30s chasing the final 0.1%. Targets for a standard page: initial browser data <1s where practical, model conversion 1–3s, initial editable design ~3–5s. Visual verification can continue a short step beyond that. Show real progress for very large pages; never freeze the whole Electron interface — use workers/background processes for expensive parsing/comparison where the app structure permits.

## 45. Final architecture — five layers

1. **Repository Intelligence** — components, CSS, tokens, fonts, assets, routes.
2. **Runtime Capture** — Chromium, CDP, DOMSnapshot, screenshot, rrweb.
3. **Capture Compiler** — normalize, resolve, match, build FrameUI nodes, handle fallbacks.
4. **FrameUI Design Engine** — structured design model, HTML/CSS renderer, layers, properties, Moveable, Selecto, text editor.
5. **Export** — SVG, PDF, copy, Figma V1, future Figma integration.

## 46. The key change

Today FrameUI effectively translates a webpage into a drawing. That's the wrong target. FrameUI should translate a running web interface into a structured editable representation of that web interface — preserving layout, typography, components, tokens, assets, relationships, rendered appearance, and browser state. That's what makes a captured page useful after it looks accurate.

## 47. Acceptance criteria

- Captured desktop page visually matches localhost closely.
- Mobile capture uses the real mobile breakpoint; tablet capture uses the real tablet breakpoint.
- Large text wraps exactly or extremely closely to Chromium.
- Images resolve from the actual project; local fonts render correctly; SVG icons remain crisp.
- Flex layouts remain structured; grid layouts remain structured where practical.
- Normal DOM wrappers do not clutter Layers.
- Captured elements can be individually selected; elements drag naturally; multi-selection works; groups can be entered and ungrouped; elements resize correctly.
- Text edits directly in place.
- Project tokens are linked where confidently identified; components are linked only when confidently matched.
- Capture records current UI state, not only URL; modal and dropdown states can be captured.
- Long pages open at fit-width.
- Pixel comparison runs automatically; unsupported content falls back only at subtree level.
- SVG export still works; existing legacy designs still open; new captures use Structured Design V2.
- Capture does not require a manual repair pass before being useful.

This is the committed direction for FrameUI's capture engine. Do not keep tuning the existing DOM-to-SVG converter — keep the scanning/capture infrastructure, add DOMSnapshot and state capture underneath it, add the structured FrameUI document in the middle, and change the design canvas to render that model with browser-native HTML/CSS. That is what addresses the core reason captured output keeps drifting from the localhost version.
