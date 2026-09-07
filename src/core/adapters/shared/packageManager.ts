import fs from 'node:fs'
import path from 'node:path'

export type PackageManagerName = 'npm' | 'yarn' | 'pnpm' | 'bun'

/** Detected from lockfile presence — best-effort, npm is the fallback. */
export function detectPackageManager(rootPath: string): PackageManagerName {
  if (fs.existsSync(path.join(rootPath, 'bun.lockb')) || fs.existsSync(path.join(rootPath, 'bun.lock'))) return 'bun'
  if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) return 'yarn'
  return 'npm'
}
