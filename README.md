# FrameUI

FrameUI is a local-first Electron design IDE that reads an application's real pages, components and style tokens into a visual workspace.

## Source support

The required framework-agnostic architecture and initial support scope are defined in the [framework and application support prompt](docs/framework-application-support.md). The list below describes currently implemented source support.

- React/Next.js JavaScript, JSX, TypeScript and TSX via static AST parsing
- PHP/PHTML, Laravel Blade and CodeIgniter views
- HTML and Node template views: EJS, Handlebars/Mustache, Nunjucks, Pug/Jade, Twig, Liquid, Eta, Smarty-style TPL and Latte
- Vue/Nuxt, Svelte/SvelteKit and Astro single-file pages/components
- Angular decorator metadata, inline/external templates and literal eager/lazy component routes
- ASP.NET Razor Pages, MVC views and Blazor Server/WebAssembly components
- Mixed stacks through composing adapters, plus selectable nested Node, Composer and .NET applications

Detection records frameworks, languages, runtimes, build tools, styling systems and UI libraries with source evidence. The common model includes stylesheet files, image/icon/font assets, literal CSS/Sass tokens, media-query breakpoints and component/layout relationships.

Template source is parsed statically and never executed. Nested elements, short text previews, custom components and common include/partial references are carried into the design tree. Parsing is capped for safety and remains best-effort for dynamic template branches.

## Workspaces

Project import opens a compact preparation screen. **Prepare project** creates a private application copy, installs supported runtimes and dependencies, starts detected services, and opens the canvas. Preparation, preview and restart share one lifecycle. Logs, environment settings and database tools are available through Advanced. Public GitHub repositories can be downloaded directly. See the [local application workflow](docs/local-environment.md) and [implementation audit](docs/designer-preparation-audit.md) for verification and support limits.

The canvas defaults to **Design from code**. It renders the extracted page structure with local styles and assets without starting a server or requiring a database, login, or installed application runtime. Use **Duplicate to design** to create an editable copy. Existing source frames also use this mode when reopened.

This is a static representation: runtime-generated content, authenticated data, and interactions may be missing. Pages with no extractable layout show an explanation instead of a server error. **Live preview** and **Run application** remain optional for projects with a working runtime.

Every adapter feeds a framework-neutral FrameUI project model: routes, screens, states, components, elements, tokens, interactions, product areas and diagnostics. The IDE uses that model to provide visual screen grids/canvases, route trees, responsive comparison, an automatically generated application map, curated journeys, source-linked element inspection, component usage and a review workspace. Runtime-only styles and states are added through Run App/Capture rather than guessed from source.

See [adapter development and support limits](docs/source-adapters.md) for the extension contract and rendering scope.

## Development

```sh
bun install
bun run dev
```

Validation:

```sh
bun run typecheck
bun run lint
bun run build
```
