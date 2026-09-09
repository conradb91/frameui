import path from 'node:path'
import { findMarkupPages } from '../markup/findMarkupPages'
import { findMarkupComponents } from '../markup/findMarkupComponents'
import type { SourceAdapter } from '../types'

/** Plain HTML with no package.json at all — the last real tier before
 * `unknown`. */
export const staticAdapter: SourceAdapter = {
  id: 'static',

  detect(ctx) {
    if (ctx.pkg) return null
    const hasHtmlPages = ctx.candidateFiles.some((file) => /\.html?$/i.test(file))
    if (!hasHtmlPages) return null
    return { framework: 'static', phpFramework: null, bundler: 'unknown', routerStyle: 'static', routesDir: null, devCommand: null }
  },

  findPages(ctx) {
    return findMarkupPages(ctx.rootPath, 'static', ctx.ignoreRules)
  },

  findComponents(ctx, _match, pages) {
    const pageAbsolutePaths = new Set(pages.map((page) => path.join(ctx.rootPath, page.filePath)))
    return findMarkupComponents(ctx.rootPath, ctx.candidateFiles, pageAbsolutePaths)
  },
}
