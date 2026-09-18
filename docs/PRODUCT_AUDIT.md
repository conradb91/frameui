# Product audit — before the refinement pass

Audited the running Electron application and current entry point, project import, capture handler, sidebar modes, shape inspector, variable/component controls, export, saved-document reopening, keyboard handlers and main-window lifecycle. Baseline screenshots are under `docs/verification/audit-before`.

| Area | Finding | Change required |
| --- | --- | --- |
| Welcome | Marketing-sized heading, purple gradient, no empty-recent guidance | Compact product introduction, five-step visual workflow, useful file browser, theme choice |
| Capture | Legacy `.ide-dialog` CSS overrides the new dialog; technical route details compete with primary actions | Scope design-system styles, progressive disclosure, clear progress and success/failure states |
| Inspector | Long form, truncated floating-point values, text-only colour fields, mixed values unmarked | Compact contextual sections, rounded display precision, one colour editor, mixed-value handling |
| Assets | Empty headings with no explanation or action | Teaching zero states, component/variable creation, visual design-system browse |
| Navigation | No command palette, context menu or recent-page recall | Unified commands/search, native menu integration, contextual actions |
| Canvas | Single click targets deepest child; Space pan missing; no visible smart guides | Meaningful selection levels, breadcrumbs, Space pan, alignment feedback and measurement |
| Save | Main-window close flushes legacy workspace saves, not new design queue | Register new save queue and surface failures without closing the document |
| Themes | Dark editor ignores preference; dialog uses conflicting light theme | Complete scoped light/dark tokens and persistent appearance setting |
| Desktop | Generic titlebar, fixed-width panels, symbol/emoji icons | Native window integration, resizable/collapsible panels, one Lucide icon family |
| Present | Sidebars hide, but no offline prototype navigation | Clean review mode, page/state switching and saved prototype links |
| Refresh | Preserves edited pages by copying whole page | Property-level three-way merge with explicit conflicts |
| Export | Immediate SVG download with no preparation/options | Purposeful export dialog and accurate Figma handoff explanation |

The capture architecture is retained: existing localhost applications only, explicit approval, read-only automated sessions, persisted visual objects, embedded image/font assets and source metadata confined to Inspect.

## Refinement delivered

The running editor now has a guided welcome and capture flow, persistent light/dark/system appearance, shared tooltips and colour editing, contextual empty states, native menus, command search, context menus, inline naming/text editing, panel resizing/collapse, recent page recall, meaningful selection levels, Space pan, smart guides and Alt measurement. Numeric multi-selection fields show Mixed. Overall opacity is adjustable with a slider.

Assets supports components and variables; a separate visual design-system browser exposes repeated colours, typography, radii and components. Application Map and Present use saved page relationships offline. Click interactions support Instant, Dissolve and Slide transitions. Export explains SVG handoff accurately.

Save-on-close now flushes the current design queue. Refresh uses a captured baseline to merge individual properties, preserves designer changes, and exposes conflicts with Keep design / Use app change actions. Capture success and failures have explicit result screens and retry actions.

## Validation

- 172 tests passed across 41 files; renderer/main TypeScript and targeted ESLint checks passed.
- Real Electron capture smoke checks approval, route deduplication, read-only requests, semantic layers, capture variants, persistence and offline reopening.
- Separate Electron workflow checks cover both themes, drawing, colour/radius editing, native command search, component/variable/page creation, design-system browsing, offline prototype navigation, panel resize/collapse, and save flushing.
- Screenshots of welcome, editor, design-system and command search are in `docs/verification/refinement`.
- A 10,000-object model benchmark performed 120 selective movement updates in 117 ms on this machine, preserving identity for 9,999 unchanged objects. SVG object rendering is memoized. This measures model updates, not a guarantee of browser frame rate for every imported page.

## Remaining boundaries

The capture fidelity and SVG/Figma limitations in `DESIGN_IDE_REBUILD.md` still apply. Application Map displays a bounded overview of 24 pages. Prototype authoring currently covers click navigation, not arbitrary application logic or hover-triggered flows. Source change indicators update during capture/refresh rather than continuously monitoring a running application's visual state. The audit does not establish pixel-perfect conversion for every CSS feature or crash-proof operation on every project.

## Verified review package

`release/navigation-review/FrameUI-0.1.0.dmg` is the local Intel macOS review build. The packaged executable passed capture and offline reopening checks, confirmed an empty build-specific review profile, and removed the disposable test profile afterward. `hdiutil verify` reported a valid checksum. The superseded release was removed after these checks; source projects and user databases were preserved. This is an unsigned local review package.
