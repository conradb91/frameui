import fs from 'node:fs'
import path from 'node:path'
import type { PackageJsonInfo } from '../shared/packageJson'
import { hasDependency } from '../shared/packageJson'
import { detectPackageManager } from '../shared/packageManager'
import type { DevCommand, RouterStyle } from '@shared/types/projectIndex'

export interface NextDetectionResult {
  detected: boolean
  routerStyle: RouterStyle
  /** Absolute path to the app/ or pages/ dir actually in use, if any. */
  routesDir: string | null
  devCommand: DevCommand | null
}

function findFirstExistingDir(rootPath: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const full = path.join(rootPath, candidate)
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full
  }
  return null
}

export function detectNext(rootPath: string, pkg: PackageJsonInfo | null): NextDetectionResult {
  const hasDep = pkg ? hasDependency(pkg, 'next') : false
  if (!hasDep) {
    return { detected: false, routerStyle: 'unknown', routesDir: null, devCommand: null }
  }

  // App Router takes precedence when both exist (Next's own resolution order).
  const appDir = findFirstExistingDir(rootPath, ['app', 'src/app'])
  const pagesDir = appDir ? null : findFirstExistingDir(rootPath, ['pages', 'src/pages'])

  const routerStyle: RouterStyle = appDir ? 'next-app' : pagesDir ? 'next-pages' : 'unknown'
  const routesDir = appDir ?? pagesDir

  let devCommand: DevCommand | null = null
  if (pkg) {
    const pm = detectPackageManager(rootPath)
    const scriptName = pkg.scripts.dev ? 'dev' : pkg.scripts.start ? 'start' : null
    devCommand = scriptName ? { command: pm, args: ['run', scriptName] } : null
  }

  return { detected: true, routerStyle, routesDir, devCommand }
}
