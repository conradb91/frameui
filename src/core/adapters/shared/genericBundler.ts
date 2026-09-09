import { detectVite } from '../vite/viteAdapter'
import { detectPackageManager } from './packageManager'
import type { PackageJsonInfo } from './packageJson'
import type { Bundler, DevCommand } from '@shared/types/projectIndex'

export interface GenericBundlerResult {
  bundler: Bundler
  devCommand: DevCommand | null
}

/**
 * The bundler/dev-command fallback every non-Next, non-Astro-hardcoded
 * framework shares today — Vite when detected, else a plain `npm run dev`
 * (or `start`) from package.json scripts, else nothing. Extracted once so
 * Vue/Svelte/Node/Static/generic-PHP adapters don't each reimplement it.
 */
export function resolveGenericBundler(rootPath: string, pkg: PackageJsonInfo | null, frameworkIsNode: boolean): GenericBundlerResult {
  const vite = pkg ? detectVite(rootPath, pkg) : { detected: false, devCommand: null }
  const packageScript = pkg ? (pkg.scripts.dev ? 'dev' : pkg.scripts.start ? 'start' : null) : null
  const packageDevCommand = packageScript && pkg ? { command: detectPackageManager(rootPath), args: ['run', packageScript] } : null
  const bundler: Bundler = vite.detected ? 'vite' : frameworkIsNode ? 'node' : 'unknown'
  return { bundler, devCommand: vite.devCommand ?? packageDevCommand }
}
