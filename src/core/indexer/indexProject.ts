import fs from 'node:fs'
import path from 'node:path'
import type { ProjectIndex, Language, IndexProgressStep } from '@shared/types/projectIndex'
import { readPackageJson } from '@core/adapters/shared/packageJson'
import { readComposerJson } from '@core/adapters/shared/composerJson'
import { detectProject } from '@core/adapters/registry'
import { MARKUP_EXTENSIONS } from '@core/adapters/markup/findMarkupPages'
import { resolveStyleTokens } from '@core/adapters/tailwind/resolveStyleTokens'
import { buildProjectModel } from '@core/design-model/buildProjectModel'
import type { AdapterContext } from '@core/adapters/types'
import { createIgnoreRules } from './ignore'
import { walkFiles } from './walkFiles'

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', ...MARKUP_EXTENSIONS]

/** The one piece of framework-agnostic derived state that doesn't vary per
 * adapter today — kept as a shared function rather than duplicated across
 * seven adapters. */
function deriveLanguage(framework: ProjectIndex['framework'], hasTsconfig: boolean, candidateFiles: string[]): Language {
  if (framework === 'php') return hasTsconfig || candidateFiles.some((file) => /\.[jt]sx?$/.test(file)) ? 'mixed' : 'php'
  if (framework === 'static') return 'html'
  if (framework === 'react' || framework === 'vue' || framework === 'svelte') return hasTsconfig ? 'typescript' : 'javascript'
  if (framework === 'astro') return 'mixed'
  if (framework === 'node') return hasTsconfig ? 'typescript' : 'javascript'
  return 'unknown'
}

export function indexProject(projectId: string, rootPath: string, onProgress?: (step: IndexProgressStep) => void): ProjectIndex {
  const startedAt = Date.now()
  const ignoreRules = createIgnoreRules()
  const pkg = readPackageJson(rootPath)
  const composer = readComposerJson(rootPath)

  // Walk once and use the same bounded, ignored source set for detection,
  // page discovery and component discovery. Server templates commonly live
  // outside `src` (resources/views, app/Views, views), so scanning only the
  // React source root made them impossible to index.
  const { files: candidateFiles, scannedFileCount } = walkFiles(rootPath, SOURCE_EXTENSIONS, ignoreRules)

  const ctx: AdapterContext = { rootPath, pkg, composer, candidateFiles, ignoreRules }
  const { adapter, match } = detectProject(ctx)
  onProgress?.('detecting')

  const pages = adapter.findPages(ctx, match)
  onProgress?.('pages')
  const components = adapter.findComponents(ctx, match, pages)
  onProgress?.('components')

  const hasTsconfig = fs.existsSync(path.join(rootPath, 'tsconfig.json'))
  const language = deriveLanguage(match.framework, hasTsconfig, candidateFiles)

  const styleTokens = resolveStyleTokens(rootPath, pkg)
  onProgress?.('tokens')
  const projectModel = buildProjectModel(projectId, rootPath, pages, components, styleTokens, match.phpFramework ?? match.framework)
  onProgress?.('model')

  const supportLevel =
    match.framework !== 'unknown' && pages.length > 0
      ? 'supported'
      : match.framework !== 'unknown'
        ? 'partial'
        : 'inspect-only'

  const index: ProjectIndex = {
    projectId,
    rootPath,
    supportLevel,
    framework: match.framework,
    phpFramework: match.phpFramework,
    language,
    bundler: match.bundler,
    routerStyle: match.routerStyle,
    devCommand: match.devCommand,
    projectModel,
    scannedFileCount,
    scanDurationMs: Date.now() - startedAt,
    scannedAt: new Date().toISOString(),
  }
  onProgress?.('done')
  return index
}
