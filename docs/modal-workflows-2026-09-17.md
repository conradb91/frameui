# Modal workflow refinement — 17 September 2026

Project setup now uses a persistent Connect / Prepare / Ready rail, compact IDE typography, and a consistent task body/footer. Indexing shows an accessible indeterminate progress bar, actual stage states and activity text. Completion shows 100% only after indexing resolves, with compact pages/components/tokens result rows. Error states stop the preparation indicator and provide retry. The React lifecycle guard now resets correctly when effects remount.

Shared dialogs now have denser headings, smaller icons and buttons, tighter spacing and restrained corners. Onboarding is explicitly excluded from the shared dialog restyling. The generic activity dialog has a cleaner operation/step layout; export working/completion states use the accessible shared progress component. Indeterminate operations do not invent a percentage.

Validation:
- Production build and TypeScript passed.
- Source and packaged Intel setup workflow: confirmation, visible working state, failure/retry, real fixture indexing, accurate result counts, completion progress, light/dark, small-window containment, project opening. Test-only IPC delay made the transient working state inspectable; production operations were not delayed.
- Modal focus, focus restoration, Escape/backdrop behavior, validation and small-window tests passed.
- Six project sections, editor/inspector, settings/export/commands, presentation and minimum-width UI tests passed.
- Packaged onboarding check preserves all four steps and completion/Help behavior.
- Both DMG checksums and packaged renderer assets verified, with separate fresh review profiles. Intel executable tested; Apple Silicon execution not tested on this Intel machine.

Screenshots: `docs/verification/modal-workflows/`. Existing source projects and user databases preserved. Only the latest verified review release remains in `release/`. No commits, pushes or publishing.
