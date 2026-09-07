import fs from 'node:fs'
import path from 'node:path'

export interface PackageJsonInfo {
  dependencies: Record<string, string>
  scripts: Record<string, string>
  raw: Record<string, unknown>
}

export function readPackageJson(rootPath: string): PackageJsonInfo | null {
  const file = path.join(rootPath, 'package.json')
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    const dependencies = {
      ...((raw.dependencies as Record<string, string>) ?? {}),
      ...((raw.devDependencies as Record<string, string>) ?? {}),
    }
    const scripts = (raw.scripts as Record<string, string>) ?? {}
    return { dependencies, scripts, raw }
  } catch {
    return null
  }
}

export function hasDependency(pkg: PackageJsonInfo, name: string): boolean {
  return name in pkg.dependencies
}
