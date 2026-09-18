# Budget capture corrections — 17 September 2026

The missing sections were reproduced against http://budget.localhost:4180/.
Electron 33 resets `Emulation.setEmulatedMedia` on debugger detach: querying
`prefers-reduced-motion` returned true while attached and false immediately
after detach. The old interactive guard detached before the page loaded;
Budget consequently initialized its GSAP scroll animations and left 20 reveal
sections at opacity zero. Interactive capture also omitted the scrolling pass.

Changes:

- Retain a capture-owned CDP session for reduced motion across navigation and
  reuse it for snapshots/screenshots without taking over unrelated debuggers.
- Settle interactive pages through the same full-page scroll traversal as batch
  capture. Use instant scrolling even on smooth-scroll pages and wait for fonts,
  visible images, finite Web Animations and finite active GSAP tweens.
- Preserve animation fill styles when freezing CSS, and restore temporary CSS
  and the original scroll position in `finally`. Use one DOMSnapshot tree for
  both editable representations rather than two differing observations.
- Flatten positive uniform CSS scales into typography, borders and spacing,
  since Chromium has already scaled the captured rectangles. Preserve fixed
  header layer order, italic styles and single-line text wrapping through save.
- Keep the legacy canvas marquee away from structured node pointer gestures.
- Limit reference screenshots to 8192 pixels per side / 16 megapixels to avoid
  oversized Retina GPU targets. Editable geometry is not downscaled.

Validation includes real Electron hidden windows and interactive webviews,
Budget desktop (1440px) and mobile (390px), full-page reference and editable
HTML renderer screenshots, capture compiler/schema tests, and the capture
registry integration suite. Budget has zero hidden reveal sections and zero
pin spacers after preparation; the editable frames contain 693 desktop and
740 mobile text nodes, including FAQ/footer content.

Useful commands:

```
bun test tests/main/cdp src/core/capture-compiler
FRAMEUI_BUDGET_URL=http://budget.localhost:4180/ node scripts/smoke-capture-motion.cjs
FRAMEUI_BUDGET_URL=http://budget.localhost:4180/ node scripts/smoke-capture-editability.cjs
node scripts/smoke-capture-registry.cjs
```

Scope: this fixes the reproduced page and shared capture/rendering defects.
It does not invent alternate layouts for custom scroll-pinned scenes that do
not support reduced motion, nor expand horizontally scrollable tracks into
additional pages. Nonuniform/skewed transforms keep their existing handling.
The older `smoke-new-design-capture.cjs` still assumes SVG text elements in the
canvas and fails that assertion against the structured HTML renderer; the new
editability smoke exercises the actual structured renderer.

Final verification: production build/typecheck passed; 117 compiler/CDP tests
passed; capture registry smoke passed. The packaged Intel app captured Budget
and successfully edited a heading on the saved canvas. Both DMGs passed
`hdiutil verify`, and their bundled capture code matches the verified build.
Apple Silicon packaging and profile metadata were checked; ARM execution was
not tested on this Intel machine. Only this verified release remains in
`release/`. No commits, pushes, publishing, or source-project/database edits.
