# Capture input fixes

The shared source scanner now excludes additional cache, log, generated build, dependency, test-report and runtime directories. These rules apply across adapters, including React, Vue, Svelte, Astro, PHP, Razor and Blazor; they are not PHP-only rules. Rotated logs, databases, source maps and backup files are also excluded. Existing persistent indexes rebuild under parser version 6. View source, routes, components, styles and fonts remain eligible. A real application page named Logs is not excluded merely because of its page title.

Credentials-assisted login waits for a rendered password form and can activate an explicit password sign-in choice on a passkey-first page. It fills and submits the existing same-origin POST form, preserving hidden fields and the submit button. Credentials remain transient. Passkeys, MFA and custom multistep authentication can still require manual completion.

Verification: six scanner/index tests, eighteen framework-support tests, main TypeScript check, production build, and Electron capture/editing smoke test against a local passkey-first fixture. The fixture validates submitted username and password before granting its session. No real account credentials were used.

Review package: release/navigation-review/FrameUI-0.1.0.dmg. Uses a fresh build-specific review profile.
