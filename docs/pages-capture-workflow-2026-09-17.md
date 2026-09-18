# Guided Pages capture workflow

Pages now explains the difference between indexed source routes and captured,
editable screens. The previous empty gallery and separate route explorer are
replaced by a single workflow:

1. Confirm the local application address (the saved address is prefilled).
2. Capture one route directly, or select route groups and device sizes.
3. Start a design from a captured screen.

Route groups follow URL structure; they are not inferred end-to-end user
journeys. Interactive states can still be captured through the existing live
capture workspace. The existing batch modal now also supports multiple routes
and group selection instead of offering only one “starting page”.

Single and bulk captures use hidden browsers from Pages. A new bounded
`design:prepareCapture` IPC method validates selected local URLs, rejects other
origins, unresolved parameters and action routes, and uses the indexed source
metadata without first crawling the entire application. Dynamic routes require
a matching concrete example; successful example URLs are remembered.

Progress includes route and viewport identity, so similarly named pages and
multiple sizes do not share an ambiguous status. Completed screens are merged
with existing content. Cancellation keeps completed results; failures have
route-specific explanations, retries, and persisted error messages. Navigation
out of the workspace is disabled during capture; if it unmounts, the job is
cancelled and returned partial results are saved without replacing another
open document.

Protected pages prompt for email/username and password in the shared modal
system, identify the local origin and session, then resume the affected routes.
Credentials are not saved. Manual sign-in is available inside that modal for
custom or multi-step authentication, sharing the chosen project browser
partition. Session choice does not grant application permissions. Authentication
checks also recognize HTTP 401 and common sign-in forms rendered at the
requested route. Unknown forms and identity-provider-specific flows may still
require manual sign-in.

Validation commands:

```sh
bun run build
bun test src/core/capture-compiler
bun test src/core/visual src/core/design-model/matchRoutePattern.test.ts
node scripts/smoke-pages-workflow.cjs
node scripts/smoke-ui-polish.cjs
```

The workflow smoke uses a real local fixture server: direct Home capture,
customer route groups, a concrete record path, Desktop/Mobile variants, a 404,
a protected route, credential sign-in/resume, manual sign-in in a separate
session, cancellation, URL validation, persistence and starting a design.
Screenshots are in `docs/verification/pages-workflow/`.

Connection checks honor the selected app session and can open sign-in directly.
Malformed or missing addresses receive an actionable message. Registration
forms with password fields are not treated as authentication gates merely
because they have a Continue button.

Validation so far: production build/typechecks, 100 capture compiler tests,
25 visual-model/routing tests, the workflow smoke (including automatic/manual
sign-in, cancellation and persisted failures), and six-section UI regression
in light/dark themes with minimum-window layout checks passed.

Final packaged verification passed on Intel, including connection validation,
protected-URL connection prompts, direct and grouped captures, dynamic URLs,
Desktop/Mobile, credential and manual sign-in, persistence of error messages,
cancellation and capture of a registration form. Both DMGs passed checksums;
renderer/main/preload match the verified build. Both architectures have unique
fresh review profiles. ARM execution was not tested on the Intel host. The
previous verified release and intermediate build directories were removed
after these checks; only the latest verified release remains. Source projects
and user databases were preserved. Nothing was committed, pushed or published.
