import fs from 'node:fs'
import path from 'node:path'
import { Project, Node, ScriptKind, type ObjectLiteralExpression, type SourceFile, type Expression } from 'ts-morph'
import type { StyleTokens } from '@shared/types/styleTokens'
import { flattenThemeObjectToTokens } from './resolveThemeValue'

const CONFIG_FILE_CANDIDATES = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs']

export function findTailwindV3Config(rootPath: string): string | null {
  for (const name of CONFIG_FILE_CANDIDATES) {
    const full = path.join(rootPath, name)
    if (fs.existsSync(full)) return full
  }
  return null
}

function scriptKindFor(ext: string) {
  return ext === '.ts' ? ScriptKind.TS : ScriptKind.JS
}

function resolveLocalConst(name: string, sourceFile: SourceFile): Expression | null {
  for (const decl of sourceFile.getVariableDeclarations()) {
    if (decl.getName() === name) return decl.getInitializer() ?? null
  }
  return null
}

/** Unwraps `defineConfig({...})` -> the object literal argument, an
 * identifier -> the local const it points at, leaving a plain object
 * literal (or null if this isn't something we can statically read). */
function resolveToObjectLiteral(expr: Expression, sourceFile: SourceFile, depth = 0): ObjectLiteralExpression | null {
  if (depth > 3) return null
  if (Node.isObjectLiteralExpression(expr)) return expr
  if (Node.isCallExpression(expr)) {
    const [firstArg] = expr.getArguments()
    return firstArg && Node.isExpression(firstArg) ? resolveToObjectLiteral(firstArg, sourceFile, depth + 1) : null
  }
  if (Node.isIdentifier(expr)) {
    const resolved = resolveLocalConst(expr.getText(), sourceFile)
    return resolved ? resolveToObjectLiteral(resolved, sourceFile, depth + 1) : null
  }
  if (Node.isAsExpression(expr) || Node.isSatisfiesExpression(expr)) {
    return resolveToObjectLiteral(expr.getExpression(), sourceFile, depth)
  }
  return null
}

function findConfigObjectLiteral(sourceFile: SourceFile): ObjectLiteralExpression | null {
  const exportAssignment = sourceFile.getExportAssignment(() => true)
  if (exportAssignment) {
    return resolveToObjectLiteral(exportAssignment.getExpression(), sourceFile)
  }
  // CommonJS: `module.exports = {...}`
  for (const stmt of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(stmt)) continue
    const expr = stmt.getExpression()
    if (!Node.isBinaryExpression(expr)) continue
    const left = expr.getLeft()
    if (Node.isPropertyAccessExpression(left) && left.getText() === 'module.exports') {
      return resolveToObjectLiteral(expr.getRight(), sourceFile)
    }
  }
  return null
}

function getObjectProperty(obj: ObjectLiteralExpression, key: string): ObjectLiteralExpression | null {
  const prop = obj.getProperty(key)
  if (!prop || !Node.isPropertyAssignment(prop)) return null
  const initializer = prop.getInitializer()
  return initializer && Node.isObjectLiteralExpression(initializer) ? initializer : null
}

function extractCategory(themeObj: ObjectLiteralExpression, extendObj: ObjectLiteralExpression | null, key: string, sourceFile: SourceFile) {
  const base = getObjectProperty(themeObj, key)
  const extend = extendObj ? getObjectProperty(extendObj, key) : null

  const baseTokens = base ? flattenThemeObjectToTokens(base, sourceFile) : []
  const extendTokens = extend ? flattenThemeObjectToTokens(extend, sourceFile) : []

  const byName = new Map(baseTokens.map((t) => [t.name, t]))
  for (const t of extendTokens) byName.set(t.name, t) // extend wins on name collision
  return [...byName.values()]
}

export function readTailwindV3Tokens(rootPath: string): StyleTokens | null {
  const configPath = findTailwindV3Config(rootPath)
  if (!configPath) return null

  const ext = path.extname(configPath)
  let content: string
  try {
    content = fs.readFileSync(configPath, 'utf-8')
  } catch {
    return null
  }

  const project = new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true })
  const sourceFile = project.createSourceFile(configPath, content, { overwrite: true, scriptKind: scriptKindFor(ext) })

  const configObj = findConfigObjectLiteral(sourceFile)
  if (!configObj) {
    return { source: 'tailwind-v3', colors: [], spacing: [], radius: [], breakpoints: [] }
  }

  const themeObj = getObjectProperty(configObj, 'theme')
  if (!themeObj) {
    return { source: 'tailwind-v3', colors: [], spacing: [], radius: [], breakpoints: [] }
  }
  const extendObj = getObjectProperty(themeObj, 'extend')

  return {
    source: 'tailwind-v3',
    colors: extractCategory(themeObj, extendObj, 'colors', sourceFile),
    spacing: extractCategory(themeObj, extendObj, 'spacing', sourceFile),
    radius: extractCategory(themeObj, extendObj, 'borderRadius', sourceFile),
    breakpoints: extractCategory(themeObj, extendObj, 'screens', sourceFile),
  }
}
