# FrameUI

FrameUI is a local-first Electron design IDE that reads an application's real pages, components and style tokens into a visual workspace.

## Source support

- React/Next.js JavaScript, JSX, TypeScript and TSX via static AST parsing
- PHP/PHTML, Laravel Blade and CodeIgniter views
- HTML and Node template views: EJS, Handlebars/Mustache, Nunjucks, Pug/Jade, Twig, Liquid, Eta, Smarty-style TPL and Latte
- Vue, Svelte/SvelteKit and Astro single-file pages/components

Template source is parsed statically and never executed. Nested elements, short text previews, custom components and common include/partial references are carried into the design tree. Parsing is capped for safety and remains best-effort for dynamic template branches.

## Workspaces

Every adapter feeds a framework-neutral FrameUI project model: routes, screens, states, components, elements, tokens, interactions, product areas and diagnostics. The IDE uses that model to provide visual screen grids/canvases, route trees, responsive comparison, an automatically generated application map, curated journeys, source-linked element inspection, component usage and a review workspace. Runtime-only styles and states are added through Run App/Capture rather than guessed from source.

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
