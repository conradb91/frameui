import fs from 'node:fs'
import path from 'node:path'
import type { PackageJsonInfo } from '../shared/packageJson'
import { hasDependency } from '../shared/packageJson'
import { detectPackageManager } from '../shared/packageManager'
import type { DevCommand } from '@shared/types/projectIndex'

const VITE_CONFIG_NAMES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts']

export interface ViteDetectionResult {
  detected: boolean
  devCommand: DevCommand | null
}

export function detectVite(rootPath: string, pkg: PackageJsonInfo | null): ViteDetectionResult {
  const hasConfig = VITE_CONFIG_NAMES.some((name) => fs.existsSync(path.join(rootPath, name)))
  const hasDep = pkg ? hasDependency(pkg, 'vite') : false
  const detected = hasConfig || hasDep

  if (!detected || !pkg) return { detected, devCommand: null }

  const pm = detectPackageManager(rootPath)
  const scriptName = pkg.scripts.dev ? 'dev' : pkg.scripts.start ? 'start' : null
  const devCommand: DevCommand | null = scriptName ? { command: pm, args: ['run', scriptName] } : null

  return { detected, devCommand }
}
