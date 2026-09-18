import fs from 'node:fs'
import path from 'node:path'
import { Project, Node, SyntaxKind } from 'ts-morph'
import type { AdapterContext, SourceAdapter } from '../types'
import { resolveGenericBundler } from '../shared/genericBundler'
import { extractMarkupStructure } from '../markup/extractMarkupStructure'

function parse(content: string) {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile('component.ts', content)
}
function literal(node: Node | undefined): string | null {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralText() : null
}
function metadata(content: string) {
  const source = parse(content)
  return source.getClasses().flatMap((declaration) => {
    const argument = declaration.getDecorator('Component')?.getArguments()[0]
    if (!argument || !Node.isObjectLiteralExpression(argument)) return []
    const value = (name: string) => {
      const property = argument.getProperty(name)
      return property && Node.isPropertyAssignment(property) ? literal(property.getInitializer()) : null
    }
    return [{ name: declaration.getName() ?? 'Component', selector: value('selector'), template: value('template'), templateUrl: value('templateUrl') }]
  })
}
const componentCache = new WeakMap<AdapterContext, ReturnType<typeof scanComponents>>()
function components(ctx: AdapterContext) {
  const cached = componentCache.get(ctx)
  if (cached) return cached
  const scanned = scanComponents(ctx)
  componentCache.set(ctx, scanned)
  return scanned
}
function scanComponents(ctx: AdapterContext) {
  return ctx.candidateFiles.filter((file) => file.endsWith('.ts')).flatMap((file) => {
    const content = fs.readFileSync(file, 'utf8')
    if (!content.includes('@Component')) return []
    return metadata(content).map((item) => {
      const templateFile = item.templateUrl ? path.resolve(path.dirname(file), item.templateUrl) : file
      const safeTemplate = ctx.candidateFiles.includes(templateFile) ? templateFile : file
      return { ...item, file, filePath: path.relative(ctx.rootPath, safeTemplate).split(path.sep).join('/') }
    })
  })
}

export const angularAdapter: SourceAdapter = {
  id: 'angular',
  extensions: ['.ts', '.html'],
  ownsFile: (file) => /\.(ts|html)$/.test(file),
  detect(ctx) {
    if (!ctx.pkg?.dependencies['@angular/core']) return null
    const generic = resolveGenericBundler(ctx.rootPath, ctx.pkg, false)
    return { framework: 'angular', phpFramework: null, ...generic, routerStyle: 'angular', routesDir: null }
  },
  findPages(ctx) {
    const declarations = components(ctx)
    const pages: { id: string; name: string; filePath: string; route: string | null }[] = []
    for (const file of ctx.candidateFiles.filter((item) => item.endsWith('.ts'))) {
      const content = fs.readFileSync(file, 'utf8')
      if (!/\bpath\s*:/.test(content)) continue
      const source = parse(content)
      for (const object of source.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
        const routeProperty = object.getProperty('path')
        const componentProperty = object.getProperty('component')
        if (!routeProperty || !Node.isPropertyAssignment(routeProperty)) continue
        const route = literal(routeProperty.getInitializer())
        const componentName = componentProperty && Node.isPropertyAssignment(componentProperty) ? componentProperty.getInitializer()?.getText() : null
        const lazyProperty = object.getProperty('loadComponent')
        const lazyText = lazyProperty?.getText() ?? ''
        const lazyImport = /import\(\s*['"]([^'"]+)['"]\s*\)/.exec(lazyText)?.[1]
        const lazyName = /\.then\([\s\S]*?=>\s*\w+\.(\w+)/.exec(lazyText)?.[1]
        const lazyFile = lazyImport?.startsWith('.') ? path.resolve(path.dirname(file), lazyImport) : null
        const declaration = declarations.find((item) => componentName ? item.name === componentName : lazyFile && [lazyFile, lazyFile + '.ts', path.join(lazyFile, 'index.ts')].includes(item.file) && (!lazyName || lazyName === 'default' || item.name === lazyName))
        if (route === null || !declaration) continue
        // Nested paths are assembled from literal ancestor route objects.
        const parents = object.getAncestors().filter(Node.isObjectLiteralExpression).reverse().flatMap((parent) => {
          const property = parent.getProperty('path')
          const value = property && Node.isPropertyAssignment(property) ? literal(property.getInitializer()) : null
          return value === null ? [] : [value]
        })
        pages.push({ id: declaration.filePath, name: declaration.name, filePath: declaration.filePath, route: '/' + [...parents, route].filter(Boolean).join('/') })
      }
    }
    if (!pages.length) {
      for (const item of declarations.filter((item) => /(?:app|root)[-.]?component/i.test(item.name) || /(?:pages|views)\//i.test(item.filePath))) {
        pages.push({ id: item.filePath, name: item.name, filePath: item.filePath, route: null })
      }
    }
    return pages
  },
  findComponents(ctx) {
    return components(ctx).map((item) => ({ id: item.filePath, name: item.selector ?? item.name, filePath: item.filePath, exportKind: 'template' as const }))
  },
  readStructure(content, filePath, knownNames) {
    if (!filePath.endsWith('.ts') || !content.includes('@Component')) return null
    const inline = metadata(content).find((item) => item.template !== null)?.template
    return inline ? extractMarkupStructure(inline, filePath, knownNames) : []
  },
}
