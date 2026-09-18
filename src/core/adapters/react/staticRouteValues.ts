import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

/** Bounded constant folding only: never imports or executes application code. */
export function staticRouteValues(files: string[]) {
  const allowed = new Set(files)
  const sources = new Map<string, ts.SourceFile>()
  const resolveFile = (from: string, spec: string) => {
    if (!spec.startsWith('.')) return undefined
    const base = path.resolve(path.dirname(from), spec)
    return [base, ...['.ts','.tsx','.js','.jsx','/index.ts','/index.tsx','/index.js'].map(ext => base + ext)].find(file => allowed.has(file))
  }
  function source(file: string) {
    if (!sources.has(file)) {
      try { sources.set(file, ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)) } catch { return undefined }
    }
    return sources.get(file)
  }
  function binding(name: string, file: ts.SourceFile, seen: Set<ts.Node>): ts.Expression | undefined {
    for (const statement of file.statements) {
      if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
        const declaration = statement.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === name)
        if (declaration?.initializer) return expression(declaration.initializer, seen)
      }
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        const imported = bindings.elements.find(e => e.name.text === name)
        if (!imported) continue
        const target = resolveFile(file.fileName, statement.moduleSpecifier.text)
        const other = target && source(target)
        if (other && !seen.has(statement) && seen.size < 64) return binding(imported.propertyName?.text || imported.name.text, other, new Set(seen).add(statement))
      }
    }
  }
  function expression(node: ts.Expression, seen = new Set<ts.Node>()): ts.Expression | undefined {
    if (seen.size > 64 || seen.has(node)) return undefined
    seen = new Set(seen).add(node)
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) return expression(node.expression, seen)
    if (ts.isIdentifier(node)) {
      for (let scope: ts.Node | undefined = node.parent; scope && !ts.isSourceFile(scope); scope = scope.parent) {
        if (ts.isFunctionLike(scope) && scope.parameters.some(p => p.name.getText().split(/\W+/).includes(node.text))) return undefined
        if (ts.isBlock(scope)) for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue
          const local = statement.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === node.text)
          if (local) return (statement.declarationList.flags & ts.NodeFlags.Const) && local.initializer ? expression(local.initializer, seen) : undefined
        }
      }
      return binding(node.text, node.getSourceFile(), seen)
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const object = expression(node.expression, seen)
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : value(node.argumentExpression, seen)
      if (object && ts.isObjectLiteralExpression(object)) {
        const property = object.properties.find(p => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && p.name.text === key)
        if (property && ts.isPropertyAssignment(property)) return expression(property.initializer, seen)
      }
      return undefined
    }
    return node
  }
  function value(node?: ts.Node, seen = new Set<ts.Node>()): string | undefined {
    if (!node || !ts.isExpression(node)) return undefined
    const resolved = expression(node, seen)
    if (!resolved) return undefined
    if (ts.isStringLiteralLike(resolved) || ts.isNumericLiteral(resolved)) return resolved.text
    if (seen.has(resolved) || seen.size > 64) return undefined
    seen = new Set(seen).add(resolved)
    if (ts.isBinaryExpression(resolved) && resolved.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = value(resolved.left, seen), right = value(resolved.right, seen)
      if (left !== undefined && right !== undefined) return left + right
    }
    if (ts.isTemplateExpression(resolved)) {
      let result = resolved.head.text
      for (const span of resolved.templateSpans) { const part = value(span.expression, seen); if (part === undefined) return undefined; result += part + span.literal.text }
      return result
    }
    return undefined
  }
  return {source, expression, value, resolveFile}
}
