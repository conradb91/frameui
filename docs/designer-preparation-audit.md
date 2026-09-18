# Designer preparation audit — 2026-09-10

This pass implements the main private-copy preparation and canvas journey. It does not certify every requirement in the requested cross-platform/framework matrix.

## Implemented

- Compact preparation entry, one Prepare project action, shared modal progress and shared lifecycle state; previously authorized projects can resume.
- Private source copies, source synchronization on preparation, retained local settings/dependencies, and cancellable bounded repository discovery.
- Declarative framework recipes and discovery of separate frontend/backend applications, including ASP.NET Core and Blazor SDK projects.
- Verified archive download/cache/extraction with retries, transport-encoding handling, integrity checks and executable validation; private Microsoft .NET SDK installation.
- Friendly failure summaries, Advanced diagnostics with secret redaction, private environment overrides and explicit database actions.
- Public GitHub default-branch archive import.
- Pointer-focused zoom, normalized wheel input, iframe wheel/pan forwarding, keyboard zoom, artboard context menus, inline rename, close/undo, route examples, and editing captured text in design copies.

## Verification

Latest local-only check: 148 tests / 420 assertions pass, lint and production build pass. The real Intel macOS mixed pnpm workspace journey passed fresh managed Node preparation, login, private SQLite access, Restart, editing/undo, zoom and full quit/reopen. The Windows blank-preview failure remains open; the smoke harness now includes the guest URL, readiness and HTML in its authentication timeout diagnostic.

Production build and lint pass. All 148 tests pass (420 assertions across 37 files). The regression suite covers corrupt/truncated/HTML archives, redirects, interrupted downloads, transport compression, checksums, cache recovery, architecture rejection, occupied ports, adapter discovery, source isolation and camera invariants. See the test command below for current totals.

Real Electron journeys on Intel macOS passed for static HTML, plain PHP, React/Vite, Vue/Vite, Next.js, ASP.NET Core, CodeIgniter and Laravel: fresh import, preparation, actual rendered content, restart and artboard close/undo. Static and PHP journeys additionally passed captured text editing, undo and wheel zoom from inside the editable iframe. The static journey also passed full application quit/reopen, automatic authorized preparation and restored artboards. The smoke script checks window widths 1280, 1440, 1920 and 2560. Real PHP 8.4.20 and .NET SDK 8.0.425 archives were downloaded, verified, extracted and launched.

An ASP.NET Core test identified macOS AirPlay occupying port 5000. The previous readiness probe accepted its empty HTTP 403 response as an application. Startup now rejects occupied ports and empty 403 responses; the real .NET journey passed after the fix.

The original reported gzip failure was not conclusively reproduced against the current upstream archive. Both misleading gzip headers and actual transport gzip are covered by tests; do not treat double decompression as a proven explanation for the original incident.

Commands:

```sh
bun test
bun run lint
bun run build
ELECTRON_RUN_AS_NODE=1 <compatible-electron> scripts/smoke-designer-preparation.cjs
```

The smoke script accepts `FRAMEUI_ELECTRON_PATH`, `FRAMEUI_SMOKE_PHP=1`, `FRAMEUI_SMOKE_DOTNET=1`, `FRAMEUI_SMOKE_VITE=react|vue`, `FRAMEUI_SMOKE_NEXT=1`, or `FRAMEUI_SMOKE_FRAMEWORK=codeigniter|laravel`, `FRAMEUI_SMOKE_BLAZOR=1`, or `FRAMEUI_SMOKE_MIXED=1`. Add `FRAMEUI_SMOKE_WORKSPACE=1` to the mixed fixture for pnpm workspace and shared-package coverage. It uses isolated temporary projects and profiles. `designer-preparation-smoke.png` records the final canvas at 1440×900.

## Follow-up implementation

Restart now uses one serialized preparation operation: stop the previous service set, rediscover services, synchronize source into the private copy, recheck/install dependencies, start and verify. This also handles newly added or removed services. The preparation marker retains the selected database mode for Start and automatic resume.

The Node catalog retains all compatible LTS releases instead of truncating the complete list at 16, which could hide an older major or exact version required by a project. Cached Node executables are checked for platform and architecture, and extracted versions are checked before registration. Release availability is based on the [official Node distribution catalog](https://nodejs.org/dist/index.json).

.NET SDK matching now distinguishes an exact three-component pin from a two-component channel. A request for `8.0.408` cannot match `8.0.4080`, and `8.0` cannot match `8.01`. Repository discovery also checks cancellation while inspecting individual services.

The desktop smoke script now supports `FRAMEUI_SMOKE_NEXT=1`, with an App Router fixture based on the [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation). The Next.js journey passed preparation, actual rendering, changed source plus a newly added dependency across Restart, captured-text editing and undo, iframe zoom, and full application quit/reopen with restored artboards. ASP.NET Core also passed the expanded editing, restart and quit/reopen journey using the private SDK.

## PHP framework follow-up

PHP runtime selection now respects patch-level requirements, AND/OR precedence, exact versions, exclusions, wildcards, caret/tilde ranges and hyphen ranges for stable runtime versions. The regression cases follow [Composer's documented version constraints](https://getcomposer.org/doc/articles/versions.md); unknown constraint syntax is rejected instead of treated as compatible.

Composer installation now has bounded downloads and execution, retries, unique staging files, checksum verification and executable validation before publication. Failed replacement attempts retain the previous installed file and remove temporary files. Preparation probes cached Composer and replaces a broken copy before installing project dependencies. A real Composer 2.10.3 download, verification and launch passed on this machine.

The first artboard now prefers the application's root route, then a concrete non-error route, rather than blindly selecting the alphabetically first page. This fixes CodeIgniter opening its Error 400 template before its Home screen. The full CodeIgniter Electron journey passed preparation, live rendering, restart, editing and undo, iframe zoom and quit/reopen.

Laravel preparation creates a missing encryption key only in the local override file. Existing keys remain unchanged, generated keys persist across restart, and keys are marked secret in the environment editor and redacted from diagnostics. Tests cover generation, preservation and secrecy. The Laravel smoke fixture starts with a deliberately corrupt Composer cache to exercise recovery. Its full journey passed preparation, live rendering, restart, editing and undo, iframe zoom and quit/reopen; source environment settings remained unchanged. These PHP fixtures use freshly downloaded official application skeletons, an already verified managed PHP runtime, and dependency installation through FrameUI. They exercise the default home route without application-specific databases or frontend asset builds.

Laravel startup uses `artisan serve --no-reload` so FrameUI's local environment overrides survive into the child web server. Laravel's default reload mode filters those values, as shown in its [ServeCommand implementation](https://github.com/laravel/framework/blob/13.x/src/Illuminate/Foundation/Console/ServeCommand.php). FrameUI manages environment changes through Restart. Health checks now merge base and local environment values so a value present in the base file is not incorrectly reported missing.

## Completed remaining macOS implementation work

- TAR/GZIP and ZIP verification/extraction now use portable JavaScript libraries, with path, entry-count, expanded-size, ZIP CRC and link checks. The official MySQL package exposed a safe library symlink chain that node-tar rejected. Files are extracted first and links are resolved within the final extraction root; tests also reject links that escape after wrapper stripping. No system tar/unzip command is required by the application.
- Node catalog/install/launch paths now select Windows ZIPs and Linux/macOS archives appropriately. Package-manager commands invoke their JavaScript entry points directly on Windows. Runtime selection respects actual semver ranges.
- Official Windows PHP metadata, SHA-256 verification, ZIP extraction, PE architecture checks, configuration and executable probes are implemented. PHP 8.5.10 x64 was downloaded and extracted on this Mac and its PE architecture verified; subsequent native Windows CI passed PHP preparation and the complete desktop journey.
- Portable credential storage uses Electron safeStorage outside macOS, with no plaintext fallback. Tests cover encryption boundaries, account isolation, replacement, deletion, unreadable credentials and unavailable encryption. Native OS integration still requires target-platform testing.
- Blazor WebAssembly now passes the actual Electron preparation, rendering, Restart, capture/edit/undo, zoom and quit/reopen journey. Capture waits for hydration and a settled DOM rather than copying the initial loading message; screens consisting of images, SVG or canvas are also eligible.
- Mixed repositories default to their runnable frontend. Namespaced nested-application page IDs now pass workspace IPC validation, including root applications, while traversal-shaped IDs remain rejected. Explicit saved application selection is retained.
- Explicit local API/backend URL settings are connected to matching supporting services through the frontend origin. Proxy tests cover active-port forwarding, path/query preservation, stopped services and unrelated-project rejection. Remote and ambiguous URLs are unchanged.
- A real React/Vite frontend plus a separate Node API passed login, HTTP-only cookie use, private SQLite access, Restart, captured editing/undo, zoom and quit/reopen. The original repository did not receive the SQLite database.
- Workspace members inherit the root package manager and dependency-install directory. Root lockfile changes invalidate member dependency preparation. Parent workspace launchers are not started alongside their children. Compatible Corepack is installed in private runtime storage when pnpm/Yarn needs it. The mixed journey also passed with pnpm and an actual shared workspace package required by the backend.
- PHP projects with a frontend build script now prepare their Node tooling, install frontend dependencies and build assets. Laravel's expanded smoke uses its actual Vite CSS/JavaScript includes and passed the complete journey. Frontend lockfiles no longer invalidate unrelated Composer setup, and stale Laravel development-server markers are removed only from the private copy.
- Real PostgreSQL 17.11 and MySQL Community Server 8.4.11 downloads passed installation, initialization, SQL queries, stop, restart and further queries on Intel macOS. Database installation now probes cached versions and validates staging before replacing installed binaries. Run `scripts/audit-managed-databases.cjs` with a compatible Node/Electron executable to repeat this isolated lifecycle check.

## Packaged application verification

An unsigned Intel macOS application was built into `/tmp/frameui-package-audit/mac/FrameUI.app`. Its bundled archive, runtime, workspace and proxy modules loaded successfully from `app.asar`. The packaged application's complete static-project smoke passed preparation, real rendering, Restart, capture/edit/undo, iframe zoom and full quit/reopen with restored artboards. This is packaging/runtime validation, not signing or notarization validation.

## Remaining release blockers and support boundaries

The Intel macOS journeys above are verified. **The complete cross-platform audit is not signed off.**

- Native Windows CI passed static and PHP desktop journeys, PostgreSQL/MySQL initialization, queries and restart, CRT staging and the packaged static journey. ASP.NET Core passed after fixing detached Windows console handles. The mixed pnpm workspace passed an earlier run but failed later runs with a blank preview before login; its cause is unresolved. Native encrypted-credential integration and clean end-user installation remain release checks. GitHub execution has stopped at the user’s request; further work is local only.
- Native Apple Silicon CI passed static, PHP, ASP.NET Core and mixed-workspace journeys, the full unit suite, database lifecycle and packaged static journey. Physical MacBook/Magic Trackpad/Windows precision-trackpad input remains untested. Automated pointer/wheel tests are not a substitute for those checks.
- Arbitrary application-specific service endpoints, custom workspace build ordering, computed routes, schema/seed data and authentication cannot be inferred universally. The tested paths now cover explicit local API URLs, package-manager workspaces, PHP frontend build scripts, login and local database access. Migrations/restores remain explicit operations.
- Classic ASP.NET/IIS and managed Bun remain outside the implemented runtime recipes; modern ASP.NET Core and Blazor WebAssembly are tested.
- GitHub import supports public default-branch snapshots; private-repository authentication and Git history are not implemented.

These boundaries must not be represented as full clean-machine Windows support or universal repository compatibility. UI styling can proceed with the local checks green, while the Windows mixed-workspace failure and target-device checks remain explicitly open; this is not full cross-platform sign-off.

## Windows continuation

Process-tree shutdown now waits for `taskkill` completion on Windows. Setup cancellation and shutdown also terminate action child processes. Tests cover asynchronous completion, invalid process identifiers and failed termination. .NET discovery now handles Windows' case-insensitive PATH naming. The Intel macOS static desktop journey passed again after the shutdown change.

Windows builds stage the installed Visual Studio toolchain's redistributable CRT DLLs using `scripts/stage-windows-crt.cjs`. The package carries these in `windows-crt`; PHP preparation checks all payload hashes and PE architectures before copying them next to `php.exe`. This implements app-local provisioning without changing system runtime installations. See [Microsoft's deployment guidance](https://learn.microsoft.com/en-us/cpp/windows/determining-which-dlls-to-redistribute?view=msvc-170) and [PHP's Windows requirements](https://www.php.net/manual/en/install.windows.manual.php). Subsequent native Windows CI passed staging, packaging and PHP execution.

`.github/workflows/windows-audit.yml` covers Windows and Apple Silicon static, PHP, ASP.NET Core and mixed pnpm-workspace desktop journeys, native databases and packaged smoke testing. It was run on an isolated GitHub CI branch before the user requested local-only work; main was not changed. The local workflow now has only a manual trigger. No further commits, pushes or hosted runs are authorized. Hosted Windows runners include Visual C++ build tools and are not evidence of a clean end-user installation.

Windows x64 database catalogs now pin PostgreSQL 17.11 and MySQL Community Server 8.4.11 ZIPs. The PostgreSQL URL was resolved through [EDB's official binary download page](https://www.enterprisedb.com/download-postgresql-binaries); MySQL uses its official CDN and [documented no-install ZIP format](https://dev.mysql.com/doc/refman/8.4/en/windows-choosing-package.html). The SHA-256 pins were computed from the official HTTPS downloads during this audit; they are not claimed as separately published vendor SHA-256 values. Both complete archives were downloaded, checked, extracted under Electron and their server PE architectures verified on this Mac. No Windows executable was launched here.

PostgreSQL's bundled pgAdmin exposed an Electron `.asar` filesystem interception error during extraction. Portable ZIP writes now use Electron's original filesystem so nested `.asar` files are written as archive payload bytes. The same real PostgreSQL archive passed after the fix. Windows database installations use an isolated platform directory, require all declared executables, provision app-local CRT DLLs, probe the server version and publish only verified staging. Database command lookup adds `.exe` on Windows; MySQL startup omits Unix socket arguments there. The manual Windows workflow now includes the real database lifecycle audit.

## Budget import follow-up

Budget reproduced a native `ngtcp2_settingslen_version` abort in managed PHP 8.2.32 during Composer installation. Managed macOS Composer invocations now disable only `curl_multi_exec` for that CLI process, selecting Composer’s TLS stream downloader without changing the application's curl extension or bypassing certificate verification. Composer's downloader feature detection is documented in its upstream `HttpDownloader.php`.

Runtime discovery now includes PHP constraints from locked production and development dependencies, plus lockfile platform requirements. Budget's manifest allowed PHP 8.2, but its locked Symfony packages required PHP >=8.4.1. A regression test rejects incompatible versions on either side of the locked requirements. Installing Budget's actual locked dependencies in FrameUI's private copy passed with PHP 8.4.20. Its subsequent HTTP request failed because the configured local MySQL server refused connections; database selection/data provisioning remain pending user input. Source files and database schemas were not changed.

Local validation: 149 tests, 424 assertions, lint and production build passed. Updated branding uses a transparent exterior around the supplied logo and regenerated app/installer assets.

The database choice is now presented in a styled modal during preparation, with existing-local and new-private options. A desktop check verifies selection gating, cancellation, Escape and reset on reopening; a store regression verifies no preparation runs before choice or after cancellation/project reset. Separate app profiles now select an available proxy port when 4181 is occupied. Final validation: 151 tests / 435 assertions, lint and build passed; the packaged Intel PHP journey passed including full quit/reopen. The review DMG was verified to open onboarding in a fresh isolated profile without local application data. Each future packaged review receives a new profile identifier through the build hook.

### 10 September — desktop workspace and actual Budget verification

The earlier database blocker is resolved for a private local database. The actual `/Users/leadsprint/Desktop/New-App/Budget` application was copied into an isolated test workspace, installed with PHP 8.4.20 and Composer, provisioned with private MySQL 8.4.11, and migrated through its real setup files. After reopening FrameUI, the application resumed as Ready and its actual public home page rendered inside the designer. The original `.env` remained byte-for-byte unchanged. This validates FrameUI's import/runtime/database/rendering integration; it does not claim to exercise every Budget business feature or authenticated account workflow.

Private project copies now retain empty directories (including writable cache folders) on initial copy and refresh, while retaining symlink safety checks. Large framework error responses retain their specific message instead of hiding missing-table errors behind a generic database warning. Failed application startup remains a failed preparation state rather than reporting completion.

The opening workspace now fills the window with Start actions and compact recent-project rows. Canvas navigation includes persistent designer-defined page groups and related alternatives, Pages/Components/Layers tabs, 260px/286px resizable panels, a selection-dependent inspector, collapsible sections, integrated document controls, bottom-right zoom, and a restrained grid. Double-clicking source artboards creates or reopens an editable copy; the source remains protected. Shared progress dialogs cover setup, indexing, imports, creation and exports, with activity hidden by default and no fabricated percentage or ETA. Chrome typography uses integer sizes and shared light/dark tokens.

Validation: 152 unit/integration tests, 439 assertions, production typecheck/build and lint. Desktop smoke checks cover import, preparation, runtime restart, source protection, artboard close/undo, double-click capture, text editing/undo, iframe zoom and full quit/reopen. Database-choice checks cover required selection, cancel, Escape and reopening. Light/dark visual checks cover setup, canvas, features, application, pages, components, design system, journeys, review, problems and settings with no renderer errors or window overflow. The Intel package smoke verifies fresh onboarding, an empty project library, a build-specific profile, private preparation and rendered application content. All work and packaging remain local; nothing was pushed or published.
