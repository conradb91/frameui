# Source adapters

FrameUI composes matching source adapters into the existing version 1 Project Model (the common FrameUI Design Model). The canvas, design files, assets UI and responsive editor consume this model. There is no separate editor for a framework.

`registerSourceAdapter` in `src/core/adapters/registry.ts` registers trusted adapters at application startup. It returns an unregister function for tests. Imported repositories cannot load executable plugins into FrameUI.

An adapter provides:

- A stable `id`, `detect(context)`, `findPages(context, match)` and `findComponents(context, match, pages)`.
- `extensions` for source scanning, cache validation and file watching.
- `assetRoots` for project directories served at the application URL root, such as wwwroot or static. Asset URL aliases are resolved before reaching the canvas.
- `ownsFile(relativePath)` to keep contributions scoped to the source types it understands.
- Optional `readStructure(content, filePath, knownNames, includeRoot)`, returning common structure nodes or `null` to defer to another reader. The path may be absolute or repository-relative; readers should use source content and extension checks rather than assume a working directory.
- Optional `fallback` for generic importers that must defer to specific frameworks.

Framework and router identifiers accept adapter-defined strings. Adding an adapter does not require changing the canvas or design-file schema. A fixture adapter in `frameworkSupport.test.ts` verifies that a new file extension reaches the scanner, watcher and common renderer without editor changes.

Specific adapters contribute before generic Node/HTML fallbacks. File ownership prevents duplicate pages and Angular templates being mistaken for standalone HTML pages. Components may still be reusable routed components. One root can contain multiple technologies, such as Laravel with Vue or Razor with React. Nested package.json, composer.json and csproj applications are selectable targets; their file scopes exclude nested application roots. Application selection and preview commands survive adapter-driven reimports.

Technology detection records evidence alongside framework, language, runtime, build-tool, styling and shared UI-library identifiers. Project Settings displays these facts for the active application.

## Imported structures

| Source | Current import behavior |
| --- | --- |
| React / Next.js | Static JSX/TSX structures, pages and exported components; Next app/pages conventions. Root elements are retained. |
| Vue / Nuxt | Vue SFC structure and conventional page/view discovery, including Nuxt app/pages. |
| Svelte / SvelteKit | Svelte structure, filesystem pages, route groups and layout files. |
| Astro | Pages and markup, plus separately detected framework components used for islands. |
| Angular | Component decorator metadata, element selectors, inline and project-local external templates, literal component routes, nested paths and direct lazy component imports. |
| PHP / Laravel / CodeIgniter | PHP/Blade views and partials; existing Laravel and CodeIgniter route readers. |
| ASP.NET Core / MVC / Razor Pages | csproj detection, cshtml views and partials; Razor Pages directives and relative route templates. MVC views without a proven URL retain a null route. |
| Blazor Server / WebAssembly | csproj and host evidence, routable Razor components, explicit layouts, constrained route parameters and component references. Nonvisual code blocks are excluded. |
| Node / Express / Vite / vanilla web | HTML and server templates; package-script preview commands and Vite detection. |
| CSS / CSS Modules / Sass / SCSS / Bootstrap / Tailwind | Styling-system detection, stylesheet inventory, CSS custom properties, literal Sass variables, media boundaries, and existing Tailwind token readers. |

Image, icon and font files are recorded in the common model. Component and explicit layout references become source dependency edges, including transitive invalidation. .NET bin/obj output is ignored. Razor and Angular changes use their importers again so route and component metadata is refreshed together; existing incremental paths continue to handle ordinary JSX changes.

## Rendering scope

Import is static and does not execute application code. Dynamic branches, computed routes, dependency-injected data, arbitrary Angular selector expressions and framework runtime behavior require the running application for full fidelity. C# and template parsing is best-effort, not a compiler replacement. Multiple URL aliases for one source page are not fully represented by the existing one-route-per-page model.

CSS Modules class generation and Sass compilation require the project's build. Source previews can use available CSS and literal tokens; detected Sass expressions are marked unresolved. UI-library detection does not imply that every library component has an isolated preview.

ASP.NET Core and Blazor SDK projects receive a `dotnet run --project` preview command. Preparation can install a private .NET SDK from Microsoft release metadata, respecting global.json or the target framework. Classic ASP.NET MVC hosted by IIS requires the application's own runtime setup. Detection never launches a server. The existing Run App and capture flow supplies observed DOM/styles through the same visual editor.

Validation: `npm run typecheck`, `npm run lint`, `npx bun test`, `npx vite build`, and the existing desktop smoke script where a graphical Electron environment is available.
