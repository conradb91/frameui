import fs from 'node:fs'
import path from 'node:path'
import { hasDependency } from '../shared/packageJson'
import { resolveGenericBundler } from '../shared/genericBundler'
import { detectNext } from '../nextjs/nextAdapter'
import { findPages } from './findPages'
import { findComponents } from './findComponents'
import type { AdapterMatch, SourceAdapter } from '../types'

function findConventionalPagesDir(rootPath: string): string | null {
  for (const candidate of ['src/pages', 'pages']) {
    const full = path.join(rootPath, candidate)
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full
  }
  return null
}

/** React (Vite, Create React App-style, or Next.js — App Router or Pages
 * Router). Tried after Astro/Svelte/Vue in the registry so an Astro project
 * with a `react` dependency (islands) still matches Astro first. */
export const reactAdapter: SourceAdapter = {
  id: 'react',
  ownsFile: (file) => /\.[jt]sx?$/i.test(file),

  detect(ctx) {
    if (!(ctx.pkg && (hasDependency(ctx.pkg, 'react') || hasDependency(ctx.pkg, 'next'))) && !ctx.candidateFiles.some((file) => /\.[jt]sx$/.test(file))) return null

    const next = ctx.pkg ? detectNext(ctx.rootPath, ctx.pkg) : { detected: false, routesDir: null, routerStyle: 'unknown' as const, devCommand: null }
    const generic = next.detected ? null : resolveGenericBundler(ctx.rootPath, ctx.pkg, false)
    const bundler: AdapterMatch['bundler'] = next.detected ? 'next' : (generic!.bundler)
    const routesDir = next.detected ? next.routesDir : findConventionalPagesDir(ctx.rootPath)
    const routerStyle: AdapterMatch['routerStyle'] = next.detected ? next.routerStyle : routesDir ? 'conventional' : 'unknown'
    const devCommand = next.detected ? next.devCommand : generic!.devCommand

    return { framework: 'react', phpFramework: null, bundler, routerStyle, routesDir, devCommand }
  },

  findPages(ctx, match) {
    return findPages(ctx.rootPath, match.routerStyle, match.routesDir, ctx.ignoreRules)
  },

  findComponents(ctx, _match, pages) {
    const pageAbsolutePaths = new Set(pages.map((page) => path.join(ctx.rootPath, page.filePath)))
    return findComponents(ctx.rootPath, ctx.candidateFiles, pageAbsolutePaths)
  },
}
