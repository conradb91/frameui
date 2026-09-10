import type { StyleTokens } from '@shared/types/styleTokens'
import type { PackageJsonInfo } from '../shared/packageJson'
import { hasDependency } from '../shared/packageJson'
import { readTailwindV3Tokens } from './tailwindV3Adapter'
import { readTailwindV4Tokens } from './tailwindV4Adapter'
import { readCustomPropertyTokens } from '../css/customPropertiesAdapter'
import { defaultColorTokens, defaultSpacingTokens, defaultRadiusTokens, defaultBreakpointTokens } from './defaultTheme'

function isTailwindV4(pkg: PackageJsonInfo): boolean {
  const version = pkg.dependencies.tailwindcss
  if (!version) return false
  const majorMatch = /(\d+)/.exec(version)
  return majorMatch ? Number(majorMatch[1]) >= 4 : false
}

/** Fills any category Tailwind was detected for but couldn't resolve with
 * the bundled default-theme snapshot, explicitly marked 'unresolved' — a
 * visible fallback, never silently blank. */
function fillUnresolvedWithDefaults(tokens: StyleTokens): StyleTokens {
  if (tokens.colors.length === 0) {
    tokens.colors = defaultColorTokens().map((t) => ({ ...t, confidence: 'unresolved' as const }))
  }
  if (tokens.spacing.length === 0) {
    tokens.spacing = defaultSpacingTokens().map((t) => ({ ...t, confidence: 'unresolved' as const }))
  }
  if (tokens.radius.length === 0) {
    tokens.radius = defaultRadiusTokens().map((t) => ({ ...t, confidence: 'unresolved' as const }))
  }
  if (tokens.breakpoints.length === 0) {
    tokens.breakpoints = defaultBreakpointTokens().map((t) => ({ ...t, confidence: 'unresolved' as const }))
  }
  return tokens
}

export function resolveStyleTokens(rootPath: string, pkg: PackageJsonInfo | null): StyleTokens {
  const hasTailwind = pkg ? hasDependency(pkg, 'tailwindcss') : false

  if (hasTailwind && pkg) {
    const preferV4 = isTailwindV4(pkg)
    const primary = preferV4 ? readTailwindV4Tokens(rootPath) : readTailwindV3Tokens(rootPath)
    const secondary = preferV4 ? readTailwindV3Tokens(rootPath) : readTailwindV4Tokens(rootPath)
    const tokens = primary ?? secondary ?? { source: preferV4 ? 'tailwind-v4' : 'tailwind-v3', colors: [], spacing: [], radius: [], breakpoints: [] }
    const stylesheetTokens = readCustomPropertyTokens(rootPath)
    for (const category of ['colors', 'spacing', 'radius', 'breakpoints'] as const) {
      const names = new Set(tokens[category].map((token) => token.name))
      tokens[category].push(...stylesheetTokens[category].filter((token) => !names.has(token.name)))
    }
    return fillUnresolvedWithDefaults(tokens)
  }

  const cssTokens = readCustomPropertyTokens(rootPath)
  const foundAny = cssTokens.colors.length || cssTokens.spacing.length || cssTokens.radius.length || cssTokens.breakpoints.length
  return foundAny ? cssTokens : { source: 'none', colors: [], spacing: [], radius: [], breakpoints: [] }
}
