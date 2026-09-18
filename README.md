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

## Design workflow

1. Open the repository and let FrameUI scan its pages, components and styles.
2. Connect to an application you already run in your normal development environment. FrameUI can discover common localhost addresses or accept one manually.
3. Sign in inside the isolated application session when needed.
4. Review discovered pages and approve **Capture Application**. Add representative addresses for parameterized pages and optionally include tablet/mobile layouts.
5. Edit the captured design in Pages, Layers and Assets. The saved design opens independently of localhost.

FrameUI does not create servers, install project runtimes, configure databases or run migrations. Automated capture blocks write requests and action navigation. Source files and databases are not edited by the design workflow.

## Editable design export

The editor exports local `.frameui` interchange packages for Figma (primary) and Adobe XD, alongside SVG, PDF, and PNG. The bundled Figma importer reconstructs native pages, frames, Auto Layout, editable text (including character-range weight and colour), vectors, images, components, instances, variables, and prototype links. Export packages contain design data only; source paths, credentials, sessions, and font binaries are excluded.

A visual normalizer converts rendered interfaces into named design objects. The persisted FrameUI Design Model is the source of truth; SVG is an editable rendering/export format. **Refresh from App** compares source dependencies and preserves edited pages. Source mapping appears in Inspect.

See [rebuild implementation and fidelity boundaries](docs/DESIGN_IDE_REBUILD.md) and [adapter support](docs/source-adapters.md). Earlier runtime-preparation documents describe the retired workspace and do not apply to the new editor.

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
