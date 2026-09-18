# Canvas editing and performance — 17 September 2026

Reproduced on the live Budget home page captured at 1440px: 2,351 structured
canvas elements and 693 editable text nodes.

The dashed selection was the old constrained-layout overlay. The renderer now
uses absolute captured geometry even for source flex/grid children, so that
restriction was obsolete. Unlocked text and other captured boxes now receive
normal Moveable resize handles. Remaining non-resizable selections use a solid
outline. Inline text editing still suspends selection/resize overlays.

Performance changes:

- Memoize frame rendering, embedded font definitions, object lookup maps, and
  the Layers sidebar. Stable callbacks let unchanged content skip React work
  when the camera moves.
- Preserve unchanged subtree references during text/bounds edits. Structured
  edits copy the affected page and ancestor path instead of cloning the full
  document, embedded assets, and unrelated pages. Undo retains the old snapshot.
- Use native hit testing for direct clicks. Selecto measures nodes only for
  marquee gestures, scoped to the active frame.
- Remove temporary drag transforms after committing geometry, retaining any
  captured rotation, so a move is not applied twice.

Measurement uses a production build in Electron on this Intel Mac, the same
Budget capture, 60 alternating wheel-pan inputs, and two animation frames per
sample, with the Chromium sampling profiler enabled. The two-frame wait gives
this test an approximately 33ms lower bound on a 60Hz display; these values are
not frame-rate claims or universal latency guarantees.

| Pan benchmark | Before | After |
|---|---:|---:|
| Median update | 127.3ms | 33.3ms |
| 95th percentile | 166.7ms | 36.9ms |
| Worst sample | 183.8ms | 41.7ms |

An earlier optimized run showed the sampled React work falling from 2,516 to 41 samples; icon rendering from 1,111
to 7; garbage collection from 598 to 18. Different run durations mean sample
counts are supporting diagnostics rather than directly comparable CPU shares.

Regression commands:

```
bun test src/core/capture-compiler
FRAMEUI_CANVAS_PROFILE=/tmp/canvas-profile.json FRAMEUI_BUDGET_URL=http://budget.localhost:4180/ node scripts/smoke-capture-editability.cjs
```

Final verification: production build/typecheck passed; 119 compiler/CDP tests
passed. The packaged Intel app captured Budget and passed text editing, solid
resize selection, resizing, undo, redo, and save checks. Its measured pan median
was 33.3ms and p95 37.2ms. Both DMGs passed integrity checks; bundled renderer
files match the verified build and both use fresh build-specific review
profiles. ARM execution was not tested on this Intel machine. Only the latest
verified release remains in `release/`. Source projects and user databases were
preserved; nothing was committed, pushed, or published.
