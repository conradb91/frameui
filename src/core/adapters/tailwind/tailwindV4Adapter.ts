import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import type { StyleTokens, StyleToken } from '@shared/types/styleTokens'
import { createIgnoreRules } from '@core/indexer/ignore'
import { walkFiles } from '@core/indexer/walkFiles'

const ENTRY_CANDIDATES = [
  'src/index.css',
  'src/App.css',
  'src/main.css',
  'src/styles/globals.css',
  'src/styles/index.css',
  'app/globals.css',
  'styles/globals.css',
]

const MAX_FILES_TO_SCAN = 60

/** Checks the conventional paths first (fast, common case), then falls back
 * to a bounded scan of every .css file in the project — real projects put
 * their Tailwind entry in all kinds of places (FrameUI's own is
 * src/renderer/styles/globals.css, matching none of the fixed candidates). */
function findCssEntryWithTheme(rootPath: string): string | null {
  for (const candidate of ENTRY_CANDIDATES) {
    const full = path.join(rootPath, candidate)
    if (fs.existsSync(full)) {
      try {
        if (fs.readFileSync(full, 'utf-8').includes('@theme')) return full
      } catch {
        continue
      }
    }
  }

  const ignoreRules = createIgnoreRules()
  const { files } = walkFiles(rootPath, ['.css'], ignoreRules)
  for (const filePath of files.slice(0, MAX_FILES_TO_SCAN)) {
    try {
      if (fs.readFileSync(filePath, 'utf-8').includes('@theme')) return filePath
    } catch {
      continue
    }
  }
  return null
}

function categoryFor(prop: string): 'colors' | 'spacing' | 'radius' | 'breakpoints' | null {
  if (prop.startsWith('--color-')) return 'colors'
  if (prop.startsWith('--radius')) return 'radius'
  if (prop.startsWith('--breakpoint-')) return 'breakpoints'
  if (prop.startsWith('--spacing')) return 'spacing'
  return null
}

function nameFor(prop: string, category: string): string {
  const withoutDashes = prop.replace(/^--/, '')
  if (category === 'colors') return withoutDashes.replace(/^color-/, '')
  if (category === 'breakpoints') return withoutDashes.replace(/^breakpoint-/, '')
  if (category === 'radius') return withoutDashes.replace(/^radius-?/, '') || 'DEFAULT'
  if (category === 'spacing') return withoutDashes.replace(/^spacing-?/, '') || 'DEFAULT'
  return withoutDashes
}

export function readTailwindV4Tokens(rootPath: string): StyleTokens | null {
  const entryPath = findCssEntryWithTheme(rootPath)
  if (!entryPath) return null

  let content: string
  try {
    content = fs.readFileSync(entryPath, 'utf-8')
  } catch {
    return null
  }

  const tokens: StyleTokens = { source: 'tailwind-v4', colors: [], spacing: [], radius: [], breakpoints: [] }

  let root
  try {
    root = postcss.parse(content, { from: entryPath })
  } catch {
    return tokens
  }

  root.walkAtRules('theme', (atRule) => {
    atRule.walkDecls((decl) => {
      const category = categoryFor(decl.prop)
      if (!category) return
      const token: StyleToken = { name: nameFor(decl.prop, category), value: decl.value.trim(), confidence: 'full' }
      tokens[category].push(token)
    })
  })

  return tokens
}
