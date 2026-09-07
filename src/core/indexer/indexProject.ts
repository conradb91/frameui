import fs from 'node:fs'
import path from 'node:path'
import type { ProjectIndex, Framework, Language, Bundler } from '@shared/types/projectIndex'
import { readPackageJson, hasDependency } from '@core/adapters/shared/packageJson'
import { detectVite } from '@core/adapters/vite/viteAdapter'
import { detectNext } from '@core/adapters/nextjs/nextAdapter'
import { findPages } from '@core/adapters/react/findPages'
import { findComponents } from '@core/adapters/react/findComponents'
import { resolveStyleTokens } from '@core/adapters/tailwind/resolveStyleTokens'
import { createIgnoreRules } from './ignore'
import { walkFiles } from './walkFiles'

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js']

function findConventionalPagesDir(rootPath: string): string | null {
  for (const candidate of ['src/pages', 'pages']) {
    const full = path.join(rootPath, candidate)
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full
  }
  return null
}

export function indexProject(projectId: string, rootPath: string): ProjectIndex {
  const startedAt = Date.now()
  const ignoreRules = createIgnoreRules()
  const pkg = readPackageJson(rootPath)

  const framework: Framework = pkg && hasDependency(pkg, 'react') ? 'react' : 'unknown'
  const hasTsconfig = fs.existsSync(path.join(rootPath, 'tsconfig.json'))
  const language: Language = pkg ? (hasTsconfig ? 'typescript' : 'javascript') : 'unknown'

  const next = detectNext(rootPath, pkg)
  const vite = next.detected ? { detected: false, devCommand: null } : detectVite(rootPath, pkg)

  const bundler: Bundler = next.detected ? 'next' : vite.detected ? 'vite' : 'unknown'
  const routesDir = next.detected ? next.routesDir : findConventionalPagesDir(rootPath)
  const routerStyle = next.detected ? next.routerStyle : routesDir ? 'conventional' : 'unknown'
  const devCommand = next.detected ? next.devCommand : vite.devCommand

  const pages = findPages(rootPath, routerStyle, routesDir, ignoreRules)
  const pageAbsolutePaths = new Set(pages.map((p) => path.join(rootPath, p.filePath)))

  const sourceRoot = fs.existsSync(path.join(rootPath, 'src')) ? path.join(rootPath, 'src') : rootPath
  const { files: candidateFiles, scannedFileCount } = walkFiles(sourceRoot, SOURCE_EXTENSIONS, ignoreRules)
  const components = findComponents(rootPath, candidateFiles, pageAbsolutePaths)
  const styleTokens = resolveStyleTokens(rootPath, pkg)

  const supportLevel =
    framework === 'react' && bundler !== 'unknown' ? 'supported' : framework === 'react' ? 'partial' : 'inspect-only'

  return {
    projectId,
    rootPath,
    supportLevel,
    framework,
    language,
    bundler,
    routerStyle,
    devCommand,
    pages,
    components,
    styleTokens,
    scannedFileCount,
    scanDurationMs: Date.now() - startedAt,
    scannedAt: new Date().toISOString(),
  }
}
