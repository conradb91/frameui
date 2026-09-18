# Framework and application support

These requirements form part of the FrameUI product and implementation prompt. They describe the required architecture and initial support scope, rather than claiming that every adapter is already implemented.

FrameUI must be framework-agnostic from the start. It must not be built around PHP, HTML or any single framework. PHP is only one supported source type.

The import and rendering architecture must support the most common modern application types and allow new frameworks to be added later without rebuilding the editor.

## Initial support

- React
- Next.js
- Vue
- Nuxt
- Angular
- Svelte
- SvelteKit
- Astro
- Vite applications
- Vanilla HTML, CSS and JavaScript
- TypeScript
- PHP
- Laravel
- CodeIgniter
- ASP.NET Core
- ASP.NET MVC
- Razor Pages
- Blazor Server
- Blazor WebAssembly
- Node.js applications
- Express
- Tailwind CSS
- Bootstrap
- CSS Modules
- Sass and SCSS
- Standard CSS

This scope includes application frameworks, runtimes, languages, build tools and styling systems. Detection must represent these together rather than force each project into a single framework category.

## Project detection

FrameUI must first detect what the imported project uses. It must then determine:

- Application framework or frameworks.
- Routing system.
- Page and view files.
- Components.
- Layouts.
- Stylesheets.
- Design tokens.
- Assets.
- Fonts.
- Icons.
- Responsive breakpoints.
- Shared UI libraries.
- Component relationships.

## One common FrameUI Design Model

Do not build separate editors for React, PHP, ASP.NET or other stacks. Create one common FrameUI Design Model. Each supported technology must have an importer or adapter that converts the project's UI structure into this common model.

```text
ASP.NET Razor → FrameUI importer → FrameUI Design Model → Canvas
React        → FrameUI importer → FrameUI Design Model → Canvas
PHP          → FrameUI importer → FrameUI Design Model → Canvas
```

The designer must get the same FrameUI experience regardless of the technology the development team used. A Blazor application must feel as natural to design in FrameUI as a React or Laravel application.

FrameUI must support mixed projects, including an ASP.NET Core backend with a React frontend, or Laravel with Vue. Adapters must contribute to the common model while preserving relationships across the project's technologies.

The editor must focus on the visual application and its component relationships, rather than forcing the user to understand how the underlying framework works.

## Extensible adapters

Do not hard-code FrameUI around a fixed list of frameworks. Build the detection and importer system so additional frameworks can be added later as adapters without changing the canvas, assets system, responsive editor or design file format.

Framework-specific detection, parsing and rendering integration belong behind adapter boundaries. The shared editor must consume the common FrameUI Design Model rather than framework-specific source structures.
