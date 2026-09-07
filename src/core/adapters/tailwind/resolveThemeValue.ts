import { Node, type Expression, type ObjectLiteralExpression, type SourceFile } from 'ts-morph'
import type { StyleToken } from '@shared/types/styleTokens'

const MAX_DEPTH = 3

/**
 * Resolves a `const NAME = <expr>` declared at the top level of `sourceFile`
 * — the only "reference" a value is allowed to point at before this gives
 * up and reports 'unresolved'. No requires, no imports, no execution.
 */
function resolveLocalIdentifier(name: string, sourceFile: SourceFile): Expression | null {
  for (const decl of sourceFile.getVariableDeclarations()) {
    if (decl.getName() === name) {
      return decl.getInitializer() ?? null
    }
  }
  return null
}

function resolveExpressionToLiteral(expr: Expression, sourceFile: SourceFile, depth: number): string | null {
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.getLiteralText()
  }
  if (Node.isIdentifier(expr) && depth < MAX_DEPTH) {
    const resolved = resolveLocalIdentifier(expr.getText(), sourceFile)
    return resolved ? resolveExpressionToLiteral(resolved, sourceFile, depth + 1) : null
  }
  return null
}

/**
 * Flattens a theme object literal (e.g. `theme.extend.colors`) into tokens.
 * Nested objects (color shade scales like `{ blue: { 500: '#...' } }`) are
 * flattened to dash-joined names (`blue-500`). Every leaf gets a
 * confidence: 'full' for a literal (or a value traced to a local const),
 * 'unresolved' — with an empty value — for anything requiring real
 * execution to know (a function, a spread, an imported reference).
 */
export function flattenThemeObjectToTokens(
  objectLiteral: ObjectLiteralExpression,
  sourceFile: SourceFile,
  prefix = '',
  depth = 0,
): StyleToken[] {
  const tokens: StyleToken[] = []
  if (depth > MAX_DEPTH) return tokens

  for (const prop of objectLiteral.getProperties()) {
    if (Node.isSpreadAssignment(prop)) {
      // What a spread contributes isn't enumerable without executing it —
      // silently omitted rather than reported as one confusing placeholder.
      continue
    }
    if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) continue

    const key = prop.getName().replace(/^['"]|['"]$/g, '')
    const tokenName = prefix ? `${prefix}-${key}` : key

    if (Node.isShorthandPropertyAssignment(prop)) {
      tokens.push({ name: tokenName, value: '', confidence: 'unresolved' })
      continue
    }

    const initializer = prop.getInitializer()
    if (!initializer) {
      tokens.push({ name: tokenName, value: '', confidence: 'unresolved' })
      continue
    }

    if (Node.isObjectLiteralExpression(initializer)) {
      tokens.push(...flattenThemeObjectToTokens(initializer, sourceFile, tokenName, depth + 1))
      continue
    }

    const literal = resolveExpressionToLiteral(initializer, sourceFile, 0)
    if (literal !== null) {
      tokens.push({ name: tokenName, value: literal, confidence: 'full' })
    } else {
      tokens.push({ name: tokenName, value: '', confidence: 'unresolved' })
    }
  }

  return tokens
}
