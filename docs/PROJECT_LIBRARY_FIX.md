# Project library and capture performance fix

Captured projects now open as project libraries. Existing project captures also open in this view without deleting or rewriting their screens. The library lists screens and components in batches of 40, with search; it does not mount imported SVG screens on an editor canvas.

Create design file creates a separate saved document linked to its project library. The new file starts blank. Add from library copies explicitly selected screens/components into that file, including component definitions needed by selected screens. Imported originals remain in the library. Multiple design files can belong to one project and reopen offline.

The recent-page effect previously set a new recent-page array on every render, triggering itself again. It now updates only when the active page changes. This removes an idle render loop; separating files from the captured library also prevents each design edit from cloning the entire imported project.

Capture now detects login URLs even when there is no password input, covering passkey-only sign-in pages. Such pages are reported as requiring sign-in rather than saved under the requested application route.

Validation: renderer/main type checks, targeted ESLint, 14 visual-model tests, and the Electron capture workflow. The workflow checks library-first completion, a blank new design, explicit screen selection, preservation of imported originals, idle preference-write stability, and offline file reopening. The auth fixture also exercises login without a visible password field.

Known boundary: this removes a confirmed render loop and avoids loading all imported screens on the canvas. It does not establish smooth rendering for every arbitrarily complex individual screen. Existing incorrectly captured login screens remain preserved in old libraries; recapture after sign-in is required to replace those with valid screens.

The packaged Intel macOS app passed the same workflow with a fresh build-specific profile. The DMG checksum is valid. The previous release was removed only after verification. Current package: `release/library-review/FrameUI-0.1.0.dmg`.
