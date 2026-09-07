import fs from 'node:fs'
import postcss from 'postcss'
import type { StyleTokens, StyleToken } from '@shared/types/styleTokens'
import { createIgnoreRules } from '@core/indexer/ignore'
import { walkFiles } from '@core/indexer/walkFiles'

const MAX_FILES = 40
const COLOR_VALUE = /^\s*(#|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|oklab\()/i

function categoryFor(name: string, value: string): keyof Omit<StyleTokens, 'source'> | null {
  const n = name.toLowerCase()
  if (n.includes('radius') || n.includes('rounded')) return 'radius'
  if (n.includes('breakpoint') || n.includes('screen')) return 'breakpoints'
  if (n.includes('space') || n.includes('spacing') || n.includes('gap')) return 'spacing'
  if (n.includes('color') || n.includes('bg-') || n.includes('accent') || COLOR_VALUE.test(value)) return 'colors'
  return null
}

/**
 * Fallback for projects with no Tailwind config at all — reads `:root`
 * custom properties from a bounded set of global stylesheets. Only
 * properties whose name/value clearly maps to a color, spacing, radius, or
 * breakpoint bucket are kept; anything ambiguous is left out rather than
 * guessed, so what shows up is trustworthy.
 */
export function readCustomPropertyTokens(rootPath: string): StyleTokens {
  const tokens: StyleTokens = { source: 'css-custom-properties', colors: [], spacing: [], radius: [], breakpoints: [] }

  const ignoreRules = createIgnoreRules()
  const { files } = walkFiles(rootPath, ['.css'], ignoreRules)

  for (const filePath of files.slice(0, MAX_FILES)) {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }
    if (!content.includes(':root')) continue

    let root
    try {
      root = postcss.parse(content, { from: filePath })
    } catch {
      continue
    }

    root.walkRules(':root', (rule) => {
      rule.walkDecls(/^--/, (decl) => {
        const category = categoryFor(decl.prop, decl.value)
        if (!category) return
        const token: StyleToken = { name: decl.prop.replace(/^--/, ''), value: decl.value.trim(), confidence: 'full' }
        tokens[category].push(token)
      })
    })
  }

  return tokens
}
