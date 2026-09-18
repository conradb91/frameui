# Canvas navigation — 17 September 2026

Wheel zoom, wheel pan and hand-tool dragging now update the camera transform
once per animation frame, without reconciling the whole editor on every input.
The final camera commits after 120ms of idle time, or immediately before pointer
editing. Toolbar/fit camera changes cancel pending navigation. Zoom stays anchored
to the pointer; line/page wheel deltas are normalized and Shift-wheel pans sideways.

Screen-space structured resize handles hide during movement and remeasure at
settle. Native text editors share the live camera transform. Document geometry,
undo history and persistence are unaffected by navigation.

A production Electron comparison used the same 1,209-element captured fixture
(904 editable text nodes), with 60 alternating pan events and two animation
frames per sample. Median was 33.4ms before and 33.3ms after; p95 was 34.3ms and
34.7ms. This benchmark has a roughly 33ms floor and does **not** establish a
frame-rate improvement. The sampling profiler recorded 109 non-idle/non-program
samples before and 13 after (including GC), supporting reduced JavaScript work.
These are diagnostic samples, not universal speedup estimates. The Budget URL
returned HTTP 404 during this pass, so this measurement uses the local fixture.

Regression coverage:

- Build and TypeScript checks.
- Large editable capture: cursor anchor, no settle jump, normalized Shift-wheel,
  camera changes followed by fresh navigation, immediate pointer synchronization,
  text editing, resize, undo, redo, persistence.
- Native text editing during pan and hand-tool drag coordinate accuracy.
- Existing design workflow: drawing, styling, presets, commands, components,
  prototype, panel resizing, presentation and saving.

Commands:

```sh
bun run build
FRAMEUI_CANVAS_STRESS=1 FRAMEUI_CAMERA_GESTURES=1 FRAMEUI_CANVAS_PROFILE=/tmp/frameui-camera.json node scripts/smoke-capture-editability.cjs
node scripts/smoke-camera-text.cjs
FRAMEUI_ELECTRON="$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" node scripts/smoke-design-workflows.cjs
```

The final packaged Intel build passed the large-capture checks (pan median
33.4ms, p95 34.7ms). Both DMGs passed checksum verification; both app bundles
match the verified renderer assets and have unique fresh review profiles.
ARM execution was not tested on this Intel host. Only the latest verified
release remains in `release/`; intermediate builds were removed. User projects
and databases were preserved. No commits, pushes or publishing.
