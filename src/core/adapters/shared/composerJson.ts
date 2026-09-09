import fs from 'node:fs'
import path from 'node:path'

export interface ComposerJsonInfo {
  dependencies: Record<string, string>
  raw: Record<string, unknown>
}

export function readComposerJson(rootPath: string): ComposerJsonInfo | null {
  const file = path.join(rootPath, 'composer.json')
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    const dependencies = {
      ...((raw.require as Record<string, string>) ?? {}),
      ...((raw['require-dev'] as Record<string, string>) ?? {}),
    }
    return { dependencies, raw }
  } catch {
    return null
  }
}

export function hasComposerDependency(composer: ComposerJsonInfo, name: string): boolean {
  return name in composer.dependencies
}
