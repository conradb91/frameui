import fs from 'node:fs'
import path from 'node:path'
import type { SourceAdapter } from '../types'
import { extractMarkupStructure } from '../markup/extractMarkupStructure'

const isTemplate = (file: string) => /\.(cshtml|razor)$/i.test(file)
const read = (file: string) => fs.readFileSync(file, 'utf8')
const name = (file: string) => path.basename(file).replace(/\.(cshtml|razor)$/i, '').replace(/^_/, '')
const normalizeRoute = (route: string) => route.replace(/\{(?:\*\*)?([^}:?]+)(?::[^}]+)?\??\}/g, ':$1')

/** Hide nonvisual C# blocks without executing application code. Preserve line numbers. */
export function razorMarkup(content: string): string {
  let result = content.replace(/@\*[\s\S]*?\*@/g, (value) => value.replace(/[^\n]/g, ' '))
  const pattern = /@(?:code\s*|functions\s*)?\{/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(result))) {
    let depth = 1
    let quote = ''
    let end = pattern.lastIndex
    for (; end < result.length && depth; end++) {
      const char = result[end]
      if (quote) { if (char === quote && result[end - 1] !== '\\') quote = ''; continue }
      if (char === '"' || char === "'") quote = char
      else if (char === '{') depth++
      else if (char === '}') depth--
    }
    result = result.slice(0, match.index) + result.slice(match.index, end).replace(/[^\n]/g, ' ') + result.slice(end)
    pattern.lastIndex = end
  }
  return result.replace(/^\s*@(?:page|using|model|inject|inherits|implements|namespace|attribute|rendermode|layout|addTagHelper|removeTagHelper|tagHelperPrefix)\b[^\n]*/gm, (value) => value.replace(/[^\n]/g, ' '))
}

export const dotnetAdapter: SourceAdapter = {
  id: 'dotnet',
  assetRoots: ['wwwroot'],
  extensions: ['.cshtml', '.razor', '.csproj', '.cs'],
  ownsFile: isTemplate,
  detect(ctx) {
    const projects = ctx.candidateFiles.filter((file) => /\.csproj$/i.test(file))
    if (!projects.length && !ctx.candidateFiles.some(isTemplate)) return null
    const runnable = projects.find((file) => /Microsoft\.NET\.Sdk\.(?:Web|BlazorWebAssembly)/i.test(read(file)))
    return { framework: 'dotnet', phpFramework: null, bundler: 'unknown', routerStyle: 'aspnet', routesDir: null, devCommand: runnable ? { command: 'dotnet', args: ['run', '--project', path.relative(ctx.rootPath, runnable)] } : null }
  },
  findPages(ctx) {
    return ctx.candidateFiles.filter(isTemplate).flatMap((file) => {
      const filePath = path.relative(ctx.rootPath, file).split(path.sep).join('/')
      if (path.basename(file).startsWith('_')) return []
      const content = read(file)
      const directive = /^\s*@page(?:[ \t]+"([^"]*)")?[ \t]*(?:\r?$)/m.exec(content)
      if (file.endsWith('.razor') && !directive) return []
      if (!directive && !/(?:^|\/)Views\//i.test(filePath)) return []
      let route: string | null = directive?.[1] ?? null
      if (directive && file.endsWith('.cshtml') && (!route || !route.startsWith('/'))) {
        const base = filePath.replace(/^.*?Pages\//i, '').replace(/\.cshtml$/i, '').replace(/(?:^|\/)Index$/i, '')
        route = '/' + [base, route].filter(Boolean).join('/')
      }
      return [{ id: filePath, name: name(file), filePath, route: route ? normalizeRoute(route) : null }]
    })
  },
  findComponents(ctx, _match, pages) {
    return ctx.candidateFiles.filter((file) => isTemplate(file) && !/^_(?:Imports|ViewImports|ViewStart|Host)\./i.test(path.basename(file))).flatMap((file) => {
      const filePath = path.relative(ctx.rootPath, file).split(path.sep).join('/')
      if (pages.some((page) => page.filePath === filePath)) return []
      return [{ id: filePath, name: name(file), filePath, exportKind: 'template' as const }]
    })
  },
  readStructure(content, filePath, knownNames) {
    if (!isTemplate(filePath)) return null
    const items = extractMarkupStructure(razorMarkup(content), filePath, knownNames)
    const layout = /^\s*@layout\s+([\w.]+)/m.exec(content)?.[1]?.split('.').pop()
      ?? /\bLayout\s*=\s*"([^";]+)"/.exec(content)?.[1]?.split('/').pop()?.replace(/\.cshtml$/i, '').replace(/^_/, '')
    return layout && knownNames.has(layout) ? [{ tagName: layout, isKnownComponent: true, children: items }] : items
  },
}
