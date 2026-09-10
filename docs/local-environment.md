# Local applications in FrameUI

Importing a folder opens a compact preparation screen after analysis. Choose **Prepare project** to authorize installation and startup in a private application copy. Project dependency installers can execute installation scripts. A shared progress dialog reports preparation stages; successful preparation opens the designer automatically. Previously authorized copies resume when reopened.

Preparation copies source files into FrameUI storage, installs supported runtimes and dependencies, configures local settings, starts detected services, and checks the application response. Analysis alone does not run project code. Source design remains available without a running application.

## Ownership and lifecycle

Private copies live under FrameUI's user-data storage in `local-applications`. Preparation, resume and Restart synchronize source changes while preserving private environment settings and generated dependencies. Restart rediscovers services and installs changed dependencies before starting the application. Start and resume retain the previously selected database mode. Original source settings are not changed by preparation.

The shell, preparation dialog, canvas, sign-in window and Advanced settings use the same application state. Closing or switching projects stops their processes. Managed services stop on app quit. Sign-in and canvas webviews share `persist:project-<FrameUI project ID>`; projects have separate sessions.

The embedded hosting engine keeps runtime files, logs and service data in `LocalEnvironment`, with credentials under `com.frameui.hosting`. Standalone Stacker storage is not imported. The local proxy binds to 127.0.0.1:4181; managed PostgreSQL and MySQL use 55433 and 53307. Occupied ports are checked before startup.

## Advanced settings

The Local app control opens preparation/status information. Advanced exposes masked environment settings, database choices, health checks, logs and sanitized diagnostics. Secrets are redacted before diagnostic display or copying. Remote database evidence blocks automatic preparation rather than silently configuring a detected remote server. Database migrations and restores remain explicit actions; local database selection does not manufacture schema or seed data.

## Runtime downloads

PHP, Node and database archives use a shared verified download pipeline with partial files, retries, checksum validation, format detection, archive integrity checks and staged extraction. PHP installation validates the executable's platform, architecture and version. Managed .NET SDK selection uses Microsoft's official release metadata and SHA-512 hashes. Composer uses verified installation with retry and staging, and a broken cached Composer is replaced during preparation. Missing Laravel encryption keys are generated in the private override file and preserved across restarts. Laravel's server receives local overrides through its no-reload mode; FrameUI handles environment changes through Restart.

See [the implementation audit](designer-preparation-audit.md) for tested journeys and remaining limitations. Node runtime distribution selection supports macOS, Windows and Linux; PHP has macOS and Windows catalogs. Managed databases have macOS and Windows x64 catalogs. Windows packaging stages app-local Visual C++ support files; native prerequisite and end-to-end validation remain outstanding. Public GitHub import downloads the default branch snapshot; it does not preserve Git history or authenticate private repositories.

Workspace members install dependencies from their declared workspace root. Explicit local API URL settings can be connected to discovered supporting services through the frontend origin. PHP applications with a frontend build script also prepare Node dependencies and build browser assets in their private copy.
