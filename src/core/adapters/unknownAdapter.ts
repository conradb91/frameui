import type { SourceAdapter } from './types'
import { detectPackageManager } from './shared/packageManager'

/**
 * The final tier — nothing recognized the project. Always matches, so the
 * registry never returns without a result. Empty pages/components rather
 * than failing outright (spec §1: "unknown frameworks should fall back to
 * runtime inspection rather than failing completely"); the runtime-only
 * inspection remains available whenever a safe dev/start script can be
 * launched; source-specific capabilities stay explicitly unavailable.
 */
export const unknownAdapter: SourceAdapter = {
  id: 'unknown',
  detect(ctx) {
    const script = ctx.pkg?.scripts.dev ? 'dev' : ctx.pkg?.scripts.start ? 'start' : null
    const devCommand = script ? { command: detectPackageManager(ctx.rootPath), args: ['run', script] } : null
    return { framework: 'unknown', phpFramework: null, bundler: 'unknown', routerStyle: 'unknown', routesDir: null, devCommand }
  },
  findPages() {
    return []
  },
  findComponents() {
    return []
  },
}
