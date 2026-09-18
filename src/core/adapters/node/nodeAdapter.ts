import path from 'node:path'
import { resolveGenericBundler } from '../shared/genericBundler'
import { findMarkupPages } from '../markup/findMarkupPages'
import { findMarkupComponents } from '../markup/findMarkupComponents'
import type { SourceAdapter } from '../types'

/** Fallback for any Node project with a package.json that no more specific
 * adapter claimed (Express/EJS/Pug/Handlebars/etc. server-rendered apps) —
 * page/component discovery is the generic markup scanner. Tried after
 * every framework-specific adapter, so reaching here means none matched. */
export const nodeAdapter: SourceAdapter = {
  id: 'node',
  ownsFile: (file) => /\.(?:ejs|hbs|handlebars|mustache|njk|nunjucks|pug|jade|twig|liquid|eta|tpl|latte|html?)$/i.test(file),
  fallback: true,

  detect(ctx) {
    if (!ctx.pkg) return null
    const generic = resolveGenericBundler(ctx.rootPath, ctx.pkg, true)
    return { framework: 'node', phpFramework: null, bundler: generic.bundler, routerStyle: 'templates', routesDir: null, devCommand: generic.devCommand }
  },

  findPages(ctx) {
    return findMarkupPages(ctx.rootPath, 'node', ctx.ignoreRules)
  },

  findComponents(ctx, _match, pages) {
    const pageAbsolutePaths = new Set(pages.map((page) => path.join(ctx.rootPath, page.filePath)))
    return findMarkupComponents(ctx.rootPath, ctx.candidateFiles, pageAbsolutePaths)
  },
}
