import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import type { DetectedPage } from '@shared/types/projectIndex'
import { staticRouteValues } from './staticRouteValues'
import { nameFromSegments } from './routeNaming'

/** Read literal router declarations without executing project code. */
export function configuredRoutes(root: string, files: string[]): DetectedPage[] {
  const pages = new Map<string, DetectedPage>()
  const constants = staticRouteValues(files)
  for (const file of files) {
    if (!/\.[jt]sx?$/.test(file) || /\.(test|spec|stories)\./.test(file)) continue
    let text: string
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    if (!/(?:<Route\b|\bpath\s*:)/.test(text)) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const imports = new Map<string, string>()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const spec = statement.moduleSpecifier.text
      if (!spec.startsWith('.')) continue
      const base = path.resolve(path.dirname(file), spec)
      const resolved = [base, ...['.tsx','.jsx','.ts','.js','/index.tsx','/index.jsx'].map(ext => base + ext)].find(p => files.includes(p))
      if (!resolved) continue
      const clause = statement.importClause
      if (clause?.name) imports.set(clause.name.text, resolved)
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const item of clause.namedBindings.elements) imports.set(item.name.text, resolved)
    }
    const nestedBindings = new Set<string>()
    const findNestedBindings = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'children') {
        const collect = (child: ts.Node) => { if (ts.isIdentifier(child)) nestedBindings.add(child.text); ts.forEachChild(child, collect) }
        collect(node.initializer)
      }
      ts.forEachChild(node, findNestedBindings)
    }
    findNestedBindings(source)
    const literal = constants.value
    const add = (route: string, node: ts.Node, title?: string) => {
      if (!route.startsWith('/')) return
      let sourceFile = file
      const identified = new Set<ts.Node>()
      const identify = (child: ts.Node) => {
        if (identified.has(child) || identified.size > 100) return
        identified.add(child)
        if (ts.isIdentifier(child) && !imports.has(child.text)) { const resolved = constants.expression(child); if (resolved && resolved !== child) identify(resolved) }
        if (ts.isIdentifier(child) && imports.has(child.text)) sourceFile = imports.get(child.text)!
        if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && child.arguments[0]) {
          const spec = literal(child.arguments[0])
          const target = spec && constants.resolveFile(file, spec)
          if (target) sourceFile = target
        }
        ts.forEachChild(child, identify)
      }
      identify(node)
      pages.set(route, { id: createHash('sha256').update(route).digest('hex').slice(0, 24), route,
        name: title || nameFromSegments(route.split('/').filter(Boolean)), filePath: path.relative(root, sourceFile).split(path.sep).join('/') })
    }
    const join = (parent: string, child: string) => child.startsWith('/') ? child : `${parent.replace(/\/$/, '')}/${child}` || '/'
    const walk = (node: ts.Node, parent = '', seen = new Set<ts.Node>()): void => {
      if (seen.size > 100 || seen.has(node)) return
      seen = new Set(seen).add(node)
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && nestedBindings.has(node.name.text)) return
      if (ts.isIdentifier(node) || ts.isSpreadElement(node)) {
        const resolved = constants.expression(ts.isSpreadElement(node) ? node.expression : node)
        if (resolved && resolved !== node) walk(resolved, parent, seen)
        return
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node
        if (opening.tagName.getText().split('.').pop() === 'Route') {
          const attrs = new Map(opening.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(), a.initializer]))
          const attr = attrs.get('path')
          const segment = literal(attr && ts.isJsxExpression(attr) ? attr.expression : attr)
          if (attr && segment === undefined) return
          const route = segment === undefined ? parent : join(parent, segment)
          if (attrs.has('element') || attrs.has('Component') || attrs.has('index')) add(route || '/', opening)
          if (ts.isJsxElement(node)) node.children.forEach(child => walk(child, route, seen))
          return
        }
      }
      if (ts.isObjectLiteralExpression(node)) {
        const props = new Map(node.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText().replace(/['"]/g, ''), p.initializer]))
        const segment = literal(props.get('path'))
        if (props.has('path') && segment === undefined) return
        if (segment !== undefined || props.has('children') || props.has('index')) {
          const route = segment === undefined ? parent : join(parent, segment)
          const component = props.get('element') || props.get('Component') || props.get('component')
          if (component) add(route || '/', component, literal(props.get('title')))
          const children = props.get('children')
          if (children) walk(children, route, seen)
          return
        }
      }
      ts.forEachChild(node, child => walk(child, parent, seen))
    }
    walk(source)
  }
  return [...pages.values()]
}
