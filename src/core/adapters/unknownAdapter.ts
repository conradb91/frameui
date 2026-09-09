import type { SourceAdapter } from './types'

/**
 * The final tier — nothing recognized the project. Always matches, so the
 * registry never returns without a result. Empty pages/components rather
 * than failing outright (spec §1: "unknown frameworks should fall back to
 * runtime inspection rather than failing completely"); the runtime-only
 * inspection path itself is later work (spec §3/§42) — this is just the
 * adapter slot it will eventually fill in.
 */
export const unknownAdapter: SourceAdapter = {
  id: 'unknown',
  detect() {
    return { framework: 'unknown', phpFramework: null, bundler: 'unknown', routerStyle: 'unknown', routesDir: null, devCommand: null }
  },
  findPages() {
    return []
  },
  findComponents() {
    return []
  },
}
