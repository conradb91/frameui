# Project setup and IDE review

Local verification on macOS, September 10, 2026. No release was packaged or published.

The setup confirmation detects database files and migration folders before preparing a private workspace. Database provisioning, import or migrations, and application-table verification precede application startup. Persisted checkpoints support retry and reopening. Source projects are preserved.

Verified executable cases:

- Budget / CodeIgniter with MariaDB migrations: initial setup and reopening; original environment unchanged.
- Budget / CodeIgniter with an SQL export: import into a separate local database and rendered application.
- Node with PostgreSQL SQL: first setup, reopening without reimport, rejected malformed SQL, and successful corrected retry.
- Node with Prisma / PostgreSQL: first setup, reopening, and applying a new migration.
- PHP with an existing SQLite database: setup and reopening.
- Static application without a database: setup and reopening.
- Interrupted prerequisites: missing runtime, dependency failure, and migration failure exercised using isolated audit fixtures.

Automation lives in `scripts/audit-preflight-engine.cjs`, `scripts/smoke-preflight-budget.cjs`, and `scripts/audit-preflight-budget-reopen.cjs`. These use temporary private profiles; the Budget audits require the local reference project and cached runtimes.

The IDE visual audit checks light and dark appearance, setup, canvas, features, pages, components, design system, journeys, review, and settings for renderer errors and window overflow. Screenshots are in `docs/visual-audit/`; setup confirmation screenshots are `docs/preflight-light.png` and `docs/preflight-dark.png`.

The reference-inspired styling uses a near-black dotted canvas, charcoal panels, fine outlines, and compact empty states and dialogs. Sidebar page titles omit trailing route paths; selected-page details retain route and source information.

Platform scope: executable and visual audits ran on macOS. Windows and newly packaged DMGs were not verified in this update. Custom migration folders require a supported framework adapter or an existing project migration command; unsupported arbitrary migration layouts request a database file instead.
