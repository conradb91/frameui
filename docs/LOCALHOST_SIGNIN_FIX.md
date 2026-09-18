# Localhost connection and keyboard editing fix

The design connection validator now accepts localhost subdomains such as `http://budget.localhost:4180/dashboard`, retains the supplied host/port/path, and trims pasted whitespace. Automatic scanning no longer replaces an address the user has already entered.

Login redirects and password forms prompt for sign-in before capture. The embedded interactive browser and automated workers share the existing project session; manual login can submit credentials while automated workers continue to block non-read requests. Redirects to a login route that the read-only navigation policy blocks now produce a sign-in instruction instead of a generic rendering error.

The connection actions distinguish finding running apps, opening the sign-in browser, and checking sign-in to discover pages. A zero-page result does not claim success and offers Sign in & reconnect. Individual failures show sign-in guidance when relevant.

Native Edit commands route copy, paste, cut, select-all, undo and redo to the focused text field or embedded browser. Canvas commands remain available when the design canvas has focus.

## Verification

Renderer and main TypeScript checks, targeted ESLint and the Vite build passed. `FRAMEUI_AUTH_SMOKE=1` enables an authenticated budget.localhost fixture in `scripts/smoke-design-ide.cjs`. It checks keyboard address paste/copy, a login redirect, keyboard paste in the embedded form, POST sign-in, session reuse for approved capture, blocked automated writes, and offline reopening. The separate editor workflow smoke passed after the menu changes.

A read-only request to the user's actual dashboard returned a redirect to `http://budget.localhost:4180/login`. No user credentials or application data were modified during verification. Authenticated capture was tested with disposable fixture credentials.

The Intel macOS package in `release/localhost-review/FrameUI-0.1.0.dmg` passed the authenticated smoke with a fresh review profile and a valid DMG checksum. The disposable test profile and superseded release were removed after verification.
