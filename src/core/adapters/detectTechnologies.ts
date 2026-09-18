import fs from 'node:fs'
import path from 'node:path'
import type { DetectedTechnology } from '@shared/types/projectIndex'
import type { AdapterContext } from './types'

/** Technologies are facts with evidence, not mutually exclusive framework enums. */
export function detectTechnologies(ctx: AdapterContext, frameworkIds: string[]): DetectedTechnology[] {
  const found = new Map<string, DetectedTechnology>()
  const add = (id: string, kind: DetectedTechnology['kind'], evidence: string[]) => {
    if (!evidence.length) return
    const previous = found.get(id)
    found.set(id, { id, kind, evidence: [...new Set([...(previous?.evidence ?? []), ...evidence])].slice(0, 30) })
  }
  for (const id of frameworkIds.filter((id) => !['unknown', 'node', 'static'].includes(id))) add(id, 'framework', [`adapter:${id}`])
  const dependencies: [string, string, DetectedTechnology['kind']][] = [
    ['next', 'nextjs', 'framework'], ['nuxt', 'nuxt', 'framework'], ['@sveltejs/kit', 'sveltekit', 'framework'],
    ['express', 'express', 'framework'], ['vite', 'vite', 'build-tool'], ['tailwindcss', 'tailwind', 'styling'],
    ['bootstrap', 'bootstrap', 'styling'], ['sass', 'sass', 'styling'], ['typescript', 'typescript', 'language'],
  ]
  for (const [dependency, id, kind] of dependencies) if (ctx.pkg?.dependencies[dependency]) add(id, kind, [`package.json:${dependency}`])
  for (const dependency of Object.keys(ctx.pkg?.dependencies ?? {})) {
    if (/(?:^@(?:mui|radix-ui|chakra-ui|headlessui|angular\/material)|^antd$|^vuetify$|^primevue$|^lucide|^@fortawesome|^react-icons$)/.test(dependency)) add(dependency, 'ui-library', [`package.json:${dependency}`])
  }
  if (ctx.pkg) add('nodejs', 'runtime', ['package.json'])
  for (const [dependency, id] of [['laravel/framework', 'laravel'], ['codeigniter4/framework', 'codeigniter'], ['codeigniter/framework', 'codeigniter']]) {
    if (JSON.stringify(ctx.composer?.raw ?? {}).includes(dependency)) add(id, 'framework', [`composer.json:${dependency}`])
  }
  const extensions: [RegExp, string, DetectedTechnology['kind']][] = [
    [/\.[jt]sx?$/i, 'javascript', 'language'], [/\.tsx?$/i, 'typescript', 'language'], [/\.php$/i, 'php', 'language'],
    [/\.html?$/i, 'html', 'language'], [/\.css$/i, 'css', 'styling'], [/\.module\.(css|scss|sass)$/i, 'css-modules', 'styling'],
    [/\.scss$/i, 'scss', 'styling'], [/\.sass$/i, 'sass', 'styling'], [/\.(cs|cshtml|razor)$/i, 'csharp', 'language'],
  ]
  for (const file of ctx.candidateFiles) {
    const relative = path.relative(ctx.rootPath, file).split(path.sep).join('/')
    for (const [pattern, id, kind] of extensions) if (pattern.test(file)) add(id, kind, [relative])
    if (/\.csproj$/i.test(file)) {
      const content = fs.readFileSync(file, 'utf8')
      if (/Microsoft\.NET\.Sdk\.Web/.test(content)) add('aspnet-core', 'framework', [relative])
      if (/BlazorWebAssembly/.test(content)) add('blazor-webassembly', 'framework', [relative])
      if (/Microsoft\.AspNet\.Mvc|System\.Web\.Mvc/.test(content)) add('aspnet-mvc', 'framework', [relative])
      for (const match of content.matchAll(/PackageReference\s+Include="([^"]+)"/g)) if (/MudBlazor|Radzen|Blazorise|Telerik|Syncfusion/i.test(match[1])) add(match[1], 'ui-library', [relative])
    }
    if (/\.(cs|cshtml|razor)$/i.test(file)) {
      const content = fs.readFileSync(file, 'utf8')
      if (/AddServerSideBlazor|AddInteractiveServerComponents|InteractiveServer|blazor\.server\.js/.test(content)) add('blazor-server', 'framework', [relative])
      if (/AddControllersWithViews|System\.Web\.Mvc/.test(content) || /(?:^|\/)Views\/.+\.cshtml$/i.test(relative)) add('aspnet-mvc', 'framework', [relative])
      if (/\.cshtml$/i.test(file) && /^\s*@page\b/m.test(content)) add('razor-pages', 'framework', [relative])
    }
    if (/\.(css|scss|sass|html|cshtml|php)$/i.test(file) && fs.statSync(file).size < 512_000) {
      const content = fs.readFileSync(file, 'utf8')
      if (/@(?:import|use).*['"](?:tailwindcss|tailwindcss\/)|@tailwind\s/.test(content)) add('tailwind', 'styling', [relative])
      if (/(?:bootstrap(?:\.min)?\.css|@(?:import|use).*['"](?:~?bootstrap))/.test(content)) add('bootstrap', 'styling', [relative])
    }
  }
  return [...found.values()]
}
