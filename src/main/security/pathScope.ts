import path from 'node:path'
import fs from 'node:fs'

/**
 * Every filesystem-touching IPC handler must resolve its target path through
 * this before touching disk. Never trust a renderer-supplied path directly —
 * contextIsolation means the renderer is untrusted from main's point of
 * view (spec §23/27.2: every fs method scoped to the opened project or the
 * FrameUI workspace dir, nothing else).
 */
export class PathScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathScopeError'
  }
}

/**
 * Resolves `requestedPath` (which may be relative or contain `..`) against
 * `boundaryRoot`, following symlinks, and throws PathScopeError unless the
 * result is `boundaryRoot` itself or strictly inside it.
 */
export function resolveWithinBoundary(boundaryRoot: string, requestedPath: string): string {
  const boundary = fs.existsSync(boundaryRoot) ? fs.realpathSync(boundaryRoot) : path.resolve(boundaryRoot)
  const target = path.resolve(boundary, requestedPath)
  const realTarget = fs.existsSync(target) ? fs.realpathSync(target) : target

  const relative = path.relative(boundary, realTarget)
  const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))

  if (!isInside) {
    throw new PathScopeError(`Path "${requestedPath}" resolves outside the allowed boundary "${boundaryRoot}".`)
  }
  return realTarget
}

/**
 * A scope bound to one boundary root (e.g. the currently-opened project, or
 * the FrameUI workspace data dir) — construct one per boundary and use it
 * for every fs call against that boundary rather than re-deriving paths.
 */
export class PathScope {
  constructor(private readonly boundaryRoot: string) {}

  resolve(requestedPath: string): string {
    return resolveWithinBoundary(this.boundaryRoot, requestedPath)
  }

  get root(): string {
    return this.boundaryRoot
  }
}
