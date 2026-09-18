# FrameUI desktop visual system audit

## Implementation

`src/shared/theme.ts` is the sole source of colour values and native font stacks. It supplies the renderer, native window background and standalone export defaults. `src/renderer/styles/theme.css` maps those values into Tailwind utilities and CSS aliases; it contains no separate palette. `globals.css` defines inheritance and shared workspace controls.

Both appearances use neutral application, panel, toolbar and canvas surfaces. Blue is reserved for controls, focus, selection and interaction indicators. Main text is 12–13px; supporting labels are at least 11px. Technical displays use the native monospace stack. Controls have 4–6px radii, and ordinary information uses flat separators rather than elevated cards.

Removed duplicate home styles, purple gradients, literal Tailwind colour palettes, dark-only white overlays, oversized chrome typography, miniature labels, decorative onboarding artwork and heavy shadows. Project previews and file objects retain their useful containment. React Flow controls, labels, handles, minimap and selection now use the same tokens.

## Scope and deliberate exceptions

Audited all renderer views, workspace sections, designer/project/shell components, global CSS, inline styling, native window setup and export defaults. There are no app SCSS files or standalone Tailwind configuration files. FrameUI does not load external or bundled fonts for its interface.

Imported project styles, design-node styles, swatches, typography samples, capture data and inspector-editable shadow values remain project data. Overriding these would change the designer's work. White artboard backing is a shared token that preserves transparent source documents. Canvas dots and column guides remain functional design aids, not decorative application backgrounds. SVG text needs explicit native font attributes because exports are standalone documents.

## Validation

- TypeScript checking and ESLint.
- Production renderer, main and preload builds.
- Existing export suite: 9 tests, 39 assertions, passing.
- Existing Electron workspace smoke test: opening a PHP project, editing/saving, responsive frames, resizing, focus restoration, appearance changes and session reload.
- `node scripts/audit-visual-system.cjs`: isolated Electron fixture, screenshots and checks for inherited native fonts, minimum chrome text size, active appearance, blue accent and window overflow. Covers onboarding, project library, application settings dialog and nine workspace sections in both appearances.

To reproduce, build with `npx vite build`, then run the two Electron scripts. The visual audit prints its temporary screenshot directory; set `FRAMEUI_VISUAL_OUTPUT` to choose another destination.

Validation is on macOS. The Windows font stack is configured, but native Windows rendering has not been visually inspected. The production build retains its existing large-chunk advisory. UI review also exposed an existing same-name radio-group collision when application settings overlays the project Appearance picker; that unrelated behavior is not changed here.
