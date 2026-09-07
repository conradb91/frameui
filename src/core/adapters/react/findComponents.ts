import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Project, ScriptKind, Node, type ExportedDeclarations } from 'ts-morph'
import type { DetectedComponent } from '@shared/types/projectIndex'
import { componentNameFromFilePath, isComponentLikeName } from './routeNaming'

const SOURCE_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.js'])
const EXCLUDED_SUFFIX = /\.(test|spec|stories|d)\.(tsx|ts|jsx|js)$/
const WRAPPER_CALLEES = /^(React\.)?(forwardRef|memo)$/

// Defensive cap so a huge repo can't make component discovery hang —
// proper perf hardening is a later phase; this just keeps Phase 2 safe.
const MAX_FILES_TO_PARSE = 3000

function scriptKindFor(ext: string): ScriptKind {
  switch (ext) {
    case '.tsx':
      return ScriptKind.TSX
    case '.jsx':
      return ScriptKind.JSX
    case '.ts':
      return ScriptKind.TS
    default:
      return ScriptKind.JS
  }
}

/**
 * Type-only exports (interface/type alias) share PascalCase naming with
 * components but aren't values at all — getExportedDeclarations() returns
 * both, so name casing alone isn't enough to tell them apart. Only function
 * declarations, classes, and function-valued variables (including ones
 * wrapped in forwardRef/memo) count as component candidates.
 */
function isComponentDeclaration(decl: Node, isJsxFile: boolean): boolean {
  if (Node.isFunctionDeclaration(decl)) return true
  // A class is only plausibly a component in a JSX-capable file — a class
  // in a plain .ts/.js file (like a watcher or a store) is essentially
  // never a React component, and .tsx/.jsx is where real ones live.
  if (Node.isClassDeclaration(decl)) return isJsxFile
  if (Node.isVariableDeclaration(decl)) {
    const initializer = decl.getInitializer()
    if (!initializer) return false
    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) return true
    if (Node.isCallExpression(initializer)) {
      return WRAPPER_CALLEES.test(initializer.getExpression().getText())
    }
  }
  return false
}

function anyDeclarationIsComponentLike(declarations: ExportedDeclarations[], isJsxFile: boolean): boolean {
  return declarations.some((d) => isComponentDeclaration(d, isJsxFile))
}

/**
 * Statically finds exported, PascalCase-named declarations that look like
 * React components. This is a deliberate, documented V1 subset (see the
 * plan's "Full static prop inference" scope note) — no prop typing yet,
 * just identity (name, file, export kind). Never executes the file.
 */
export function findComponents(
  rootPath: string,
  candidateFiles: string[],
  excludeAbsolutePaths: Set<string>,
): DetectedComponent[] {
  const project = new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true })
  const components: DetectedComponent[] = []

  let parsed = 0
  for (const filePath of candidateFiles) {
    if (parsed >= MAX_FILES_TO_PARSE) break
    if (excludeAbsolutePaths.has(filePath)) continue
    const ext = path.extname(filePath)
    if (!SOURCE_EXTENSIONS.has(ext)) continue
    if (EXCLUDED_SUFFIX.test(path.basename(filePath))) continue

    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }
    // Cheap pre-filter before paying for a real AST parse — not the
    // correctness gate (that's isComponentDeclaration below), just skips
    // files that obviously can't export anything.
    if (!/export/.test(content)) continue

    parsed++
    const relativePath = path.relative(rootPath, filePath).split(path.sep).join('/')

    try {
      const sourceFile = project.createSourceFile(filePath, content, {
        overwrite: true,
        scriptKind: scriptKindFor(ext),
      })
      const exported = sourceFile.getExportedDeclarations()
      const isJsxFile = ext === '.tsx' || ext === '.jsx'

      for (const [exportName, declarations] of exported) {
        if (declarations.length === 0 || !anyDeclarationIsComponentLike(declarations, isJsxFile)) continue

        if (exportName === 'default') {
          const name = componentNameFromFilePath(filePath)
          if (isComponentLikeName(name)) {
            components.push({
              id: crypto.randomUUID(),
              name,
              filePath: relativePath,
              exportKind: 'default',
            })
          }
        } else if (isComponentLikeName(exportName)) {
          components.push({
            id: crypto.randomUUID(),
            name: exportName,
            filePath: relativePath,
            exportKind: 'named',
          })
        }
      }

      project.removeSourceFile(sourceFile)
    } catch {
      // Unparseable file (syntax error, exotic dialect) — skip rather than
      // fail the whole scan (spec §31: keep indexing the rest).
      continue
    }
  }

  return components
}
