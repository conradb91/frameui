# Onboarding and project home review — 17 September 2026

All four introduction steps now use an equal text/artwork split. The right half is static SVG/CSS artwork in FrameUI blue, inspired by the supplied reference's circular forms and translucent icon tiles. No product screenshot or simulated editor appears in the artwork. Navigation, completion persistence, and Help reopening are preserved.

The opening screen now has an application header, project collection sidebar, Open Codebase and blank-design actions, search, name/date sorting, and grid/list views. The collection combines registered source projects with independent saved design files, including codebases that have not completed setup. Cancelling setup refreshes the collection. Unavailable source folders provide a recovery message.

Validation:
- Production build and TypeScript checks passed.
- Packaged Intel app: four onboarding steps, equal widths, nonoverlapping content/navigation, completion persistence, Help reopening.
- Packaged Intel app: registered projects, independent designs, search/filter/sort, grid/list, light/dark modes, source opening, missing-folder recovery, setup cancellation refresh, compact onboarding, blank design creation; no renderer errors.
- Capture regression from source: interactive capture, saved structured content, canvas rendering, inline text editing, reduced motion passed.
- Both DMGs passed `hdiutil verify`; packaged renderer/preload match the built files.
- Each architecture has a distinct fresh review profile. Test profiles were removed after checking; user databases and source projects were preserved.
- ARM app execution was not tested on this Intel machine.

Review screenshots are in `docs/verification/onboarding-step-*.png`, `onboarding-compact-*.png`, and `project-home-*.png`. Only the latest verified packages and associated bundles remain in `release/`. No commit, push, publication, or GitHub workflow was performed.
