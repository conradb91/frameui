# IDE interface refinement — 17 September 2026

The main application surfaces now use one shared light/dark palette: editor, project home, native window background, dialogs and onboarding. Editor token aliases point at the shared theme instead of maintaining a separate colour system.

Updated surfaces:
- Editor header, document name, search, Export action, save status, panel tabs and searches.
- Canvas toolbar, including all zoom controls at the minimum supported window width.
- Inspector artboard identity, object name/kind, property groups, fields and focus states.
- Project Designs, Pages, Components, Styles, Assets and Archive: consistent headings, descriptions, navigation identity, labeled secondary navigation, metrics, cards and empty states.
- Application map and design-system overview.
- Capture browser controls and session sidebar.
- Shared modal headings, spacing, actions, notices, settings rows, export format/scope cards, command palette and context menus.

Also fixed stretched export radio controls, missing feedback for component/style searches, missing page capture guidance and accessible navigation names that previously changed with the count. Captured content and canvas geometry were not restyled. No ongoing animation or background work was introduced.

Validation passed:
- Production build and TypeScript checks.
- `smoke-ui-polish.cjs` against source and packaged Intel app: six project sections in light/dark themes, empty searches, collapsed navigation, editor/inspector, settings/export/commands, application map/design system, presentation and minimum-width layout. No renderer exceptions.
- `smoke-modal-system.cjs`: focus trapping/restoration, Escape/backdrop behavior, validation, destructive confirmation and compact containment.
- `smoke-editor-sidebar.cjs`: page/device/route filters, assets/components, narrow sidebar and no horizontal overflow.
- `smoke-design-workflows.cjs`: drawing, styling, frame presets/resize, layout grids, commands, components, offline prototype, panel resize and save flush.
- Packaged `smoke-capture-editability.cjs`: interactive capture, structured content, rendering, inline text editing and reduced motion.
- Packaged `smoke-first-run-onboarding.cjs`: all four steps, equal split, persistence and Help reopening.
- Both DMGs passed disk-image checksum validation. Packaged assets match the current build. Separate fresh review profiles verified and test profiles removed.

Screenshots: `docs/verification/ide-polish/` (25 views).

Intel package executed locally. Apple Silicon package integrity checked; execution requires an Apple Silicon machine. The latest verified release replaces the previous artifacts in `release/`. Source projects and user databases are preserved. No commits, pushes, publication or GitHub workflows.
