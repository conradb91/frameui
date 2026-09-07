import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const START_MARKER = '__FRAMEUI_PATH_START__'
const END_MARKER = '__FRAMEUI_PATH_END__'

/** Common package-manager bin dirs that some shells only add to PATH behind
 * a `[[ -t 1 ]]`-style TTY check in their rc file — which a spawned
 * `shell -ilc` child doesn't always satisfy even with -i, so they can be
 * missing from the resolved PATH above despite being on the user's real
 * PATH in an actual terminal. Appended defensively, only if they exist and
 * aren't already present — never overrides what the shell itself reported. */
function commonPackageManagerDirs(): string[] {
  const home = os.homedir()
  return [path.join(home, '.bun/bin'), path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'].filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

/**
 * GUI-launched Electron apps on macOS/Linux inherit a minimal PATH (from
 * launchd/the desktop session), not the user's actual shell PATH — so a
 * package manager installed via a shell rc file (bun, nvm, etc.) resolves
 * fine in a terminal but fails with ENOENT when this app tries to spawn it
 * (confirmed while building this: `bun run dev` failed here for exactly
 * this reason). Runs the user's own login shell once, in the background,
 * to read its real PATH and merge it in — best-effort; if it fails or
 * times out, preview spawning just falls back to Electron's own PATH.
 * Windows GUI apps already inherit the system PATH correctly, so this is a
 * no-op there.
 */
export function fixPath(): void {
  if (process.platform === 'win32') return

  const applyFallbackDirs = () => {
    const current = (process.env.PATH || '').split(path.delimiter)
    const missing = commonPackageManagerDirs().filter((dir) => !current.includes(dir))
    if (missing.length > 0) {
      process.env.PATH = [...current, ...missing].join(path.delimiter)
    }
  }

  const shell = process.env.SHELL || '/bin/zsh'
  execFile(shell, ['-ilc', `echo "${START_MARKER}$PATH${END_MARKER}"`], { timeout: 8_000 }, (error, stdout) => {
    if (!error) {
      const match = new RegExp(`${START_MARKER}(.*)${END_MARKER}`, 's').exec(stdout)
      if (match?.[1]) process.env.PATH = match[1].trim()
    }
    applyFallbackDirs()
  })
}
