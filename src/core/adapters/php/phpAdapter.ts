import fs from 'node:fs'
import path from 'node:path'
import { resolveGenericBundler } from '../shared/genericBundler'
import { findMarkupPages } from '../markup/findMarkupPages'
import { findMarkupComponents } from '../markup/findMarkupComponents'
import { detectCodeIgniter, getCodeIgniterDevCommand, findCodeIgniterRoutes } from '../codeigniter/codeigniterAdapter'
import { findLaravelRoutes } from '../laravel/laravelAdapter'
import type { ComposerJsonInfo } from '../shared/composerJson'
import type { DetectedPage } from '@shared/types/projectIndex'
import type { AdapterMatch, SourceAdapter } from '../types'

function isLaravel(rootPath: string, composer: ComposerJsonInfo | null): boolean {
  return !!composer && ('laravel/framework' in composer.dependencies || fs.existsSync(path.join(rootPath, 'artisan')))
}

function hasPhpMarker(rootPath: string): boolean {
  return fs.existsSync(path.join(rootPath, 'index.php'))
    || fs.existsSync(path.join(rootPath, 'app', 'Views'))
    || fs.existsSync(path.join(rootPath, 'application', 'views'))
    || fs.existsSync(path.join(rootPath, 'resources', 'views'))
}

/** PHP — CodeIgniter (route + view discovery), Laravel, and generic PHP
 * (view-directory discovery via the markup scanner) all live under one
 * adapter since they share the same fallback shape; `match.phpFramework`
 * carries which one. A real PHP parser (replacing the regex route/brace
 * scanning in `codeigniterAdapter.ts`, and adding Laravel/Blade route and
 * template support) is Phase 2 follow-up work — this phase only gives PHP
 * a formal adapter seam. */
export const phpAdapter: SourceAdapter = {
  id: 'php',

  detect(ctx) {
    const isCodeIgniter = detectCodeIgniter(ctx.rootPath, ctx.composer)
    const laravel = isLaravel(ctx.rootPath, ctx.composer)
    const hasPhpViews = ctx.candidateFiles.some((file) => /\.(?:php|phtml)$/i.test(file))
    const isPhp = isCodeIgniter || laravel || (!!ctx.composer && hasPhpViews) || (hasPhpViews && (hasPhpMarker(ctx.rootPath) || !ctx.pkg))
    if (!isPhp) return null

    const phpFramework: AdapterMatch['phpFramework'] = isCodeIgniter ? 'codeigniter' : laravel ? 'laravel' : null
    const routerStyle: AdapterMatch['routerStyle'] = isCodeIgniter ? 'codeigniter' : 'templates'
    const devCommand = isCodeIgniter
      ? getCodeIgniterDevCommand(ctx.rootPath)
      : laravel
        ? { command: 'php', args: ['artisan', 'serve'] }
        : resolveGenericBundler(ctx.rootPath, ctx.pkg, false).devCommand
    const bundler = resolveGenericBundler(ctx.rootPath, ctx.pkg, false).bundler

    return { framework: 'php', phpFramework, bundler, routerStyle, routesDir: null, devCommand }
  },

  findPages(ctx, match) {
    const routedPhpPages = match.phpFramework === 'codeigniter'
      ? findCodeIgniterRoutes(ctx.rootPath)
      : match.phpFramework === 'laravel'
        ? findLaravelRoutes(ctx.rootPath)
        : []
    const markupPages = findMarkupPages(ctx.rootPath, 'php', ctx.ignoreRules)
      // A framework view path is not a public URL. Keep unmatched views
      // available for source/design rendering, but never ask the running
      // PHP router to open a filesystem-derived guess such as
      // app/Views/admin/admin_accounts -> /admin/admin_accounts.
      .map((page) => match.phpFramework ? { ...page, route: null } : page)
    // Route-derived pages carry real route/prefix/parameter semantics;
    // the generic markup scanner only guesses a route from the view file's
    // own path. On a collision (the same view reachable both ways) the
    // route-aware result must win — spread it last so it overwrites the
    // generic guess, not the other way around.
    const byFile = new Map<string, DetectedPage>([...markupPages, ...routedPhpPages].map((page) => [page.filePath, page]))
    return [...byFile.values()]
  },

  findComponents(ctx, _match, pages) {
    const pageAbsolutePaths = new Set(pages.map((page) => path.join(ctx.rootPath, page.filePath)))
    return findMarkupComponents(ctx.rootPath, ctx.candidateFiles, pageAbsolutePaths)
  },
}
