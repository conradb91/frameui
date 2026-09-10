import fs from 'node:fs'
import path from 'node:path'
import { PathScope } from '../../main/security/pathScope'
import type { ProjectVisuals } from '@shared/types/projectVisuals'

const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' }
export function cssPixels(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(px|rem|em)$/)
  return match ? Number(match[1]) * (match[2] === 'px' ? 1 : 16) : null
}
/** Read-only, bounded, project-scoped asset bundle. Embedded previews cannot fetch the network. */
export function readProjectVisuals(root: string, files: string[]): ProjectVisuals {
  const scope = new PathScope(root)
  const assets: Record<string, string> = {}
  let bytes = 0
  for (const file of files) {
    const type = mime[path.extname(file).toLowerCase()]
    if (!type) continue
    try {
      const absolute = scope.resolve(file); const size = fs.statSync(absolute).size
      if (size > 2_000_000 || bytes + size > 12_000_000) continue
      assets[file] = `data:${type};base64,${fs.readFileSync(absolute).toString('base64')}`; bytes += size
    } catch { /* Missing or out-of-project symlink. */ }
  }
  let css = ''
  for (const file of files.filter((file) => /\.css$/i.test(file))) {
    try {
      const absolute = scope.resolve(file)
      if (fs.statSync(absolute).size > 1_000_000 || css.length > 2_000_000) continue
      const content = fs.readFileSync(absolute, 'utf8').replace(/@import\s+[^;]+;/gi, '').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote, url: string) => {
        if (url.startsWith('data:')) return `url("${url}")`
        const clean = url.split(/[?#]/)[0]
        const asset = clean.startsWith('/') ? clean.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), clean))
        return `url("${assets[asset] ?? assets[`public/${asset}`] ?? ''}")`
      })
      css += `\n${content}`
    } catch { /* Optional stylesheet. */ }
  }
  const numeric = (pattern: RegExp) => [...new Set([...css.matchAll(pattern)].map((m) => cssPixels(m[1])).filter((n): n is number => n !== null && n > 0))].sort((a, b) => a - b)
  return { css, assets,
    breakpoints: numeric(/(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?(?:px|rem|em))(?=\s*\))/gi),
    containerWidths: numeric(/max-width\s*:\s*(\d+(?:\.\d+)?(?:px|rem|em))\s*(?:;|})/gi),
    spacing: numeric(/(?:gap|padding|margin)(?:-[\w]+)?\s*:\s*(\d+(?:\.\d+)?(?:px|rem|em))/gi),
    fonts: [...new Set([...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1].trim()))],
    colors: [...new Set(css.match(/#[a-f\d]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) ?? [])],
    visibilityRules: [...css.matchAll(/[^{}]+\{[^{}]*display\s*:\s*none[^{}]*\}/gi)].map((m) => m[0]),
  }
}
