import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DetectedPage, DevCommand } from '@shared/types/projectIndex'
import { hasComposerDependency, type ComposerJsonInfo } from '@core/adapters/shared/composerJson'
import { parsePhp, isPhpNode, phpNodeName, phpStringValue, findPhpNode, type PhpNode } from '@core/adapters/php/parsePhp'

export function detectCodeIgniter(rootPath: string, composer: ComposerJsonInfo | null): boolean {
  if (composer && hasComposerDependency(composer, 'codeigniter4/framework')) return true
  // CodeIgniter 3 has no composer dependency by default — fall back to its
  // distinctive top-level marker file.
  return fs.existsSync(path.join(rootPath, 'system', 'core', 'CodeIgniter.php'))
}

/** CI4's built-in dev server, run via its `spark` CLI at the project root. */
export function getCodeIgniterDevCommand(rootPath: string): DevCommand | null {
  if (!fs.existsSync(path.join(rootPath, 'spark'))) return null
  return { command: 'php', args: ['spark', 'serve'] }
}

interface RawRoute {
  method: string
  routePath: string
  controller: string
  action: string
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options'])

/** True when `node` is `$routes->someMethod(...)` (or the nullsafe variant)
 * — CodeIgniter 4's route-definition call shape. */
function asRoutesMethodCall(node: PhpNode): { method: string; args: unknown[] } | null {
  const what = node.what
  if (!isPhpNode(what) || (what.kind !== 'propertylookup' && what.kind !== 'nullsafepropertylookup')) return null
  const target = what.what
  if (!isPhpNode(target) || target.kind !== 'variable' || target.name !== 'routes') return null
  const method = phpNodeName(what.offset)
  if (!method) return null
  return { method, args: Array.isArray(node.arguments) ? node.arguments : [] }
}

/**
 * Recursively walks a parsed `Routes.php` AST for `$routes->get/post/.../
 * group(...)` calls — real syntax tree traversal in place of the previous
 * line-by-line regex + character-counted brace depth (spec §2). A
 * `$routes->group('prefix', function ($routes) { ... })` call recurses into
 * the closure's body with `prefix` pushed onto `groupStack`, so nested
 * groups and multi-line calls are handled naturally and a stray `{`/`}`
 * inside a string or comment can no longer desync anything — the walk
 * follows real AST structure, not character counts. Closures used directly
 * as a route handler (rather than a `'Controller::method'` string) are
 * still skipped, matching the previous behavior exactly.
 */
function walkRoutes(node: unknown, groupStack: string[], routes: RawRoute[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkRoutes(item, groupStack, routes)
    return
  }
  if (!isPhpNode(node)) return

  if (node.kind === 'call') {
    const routeCall = asRoutesMethodCall(node)
    if (routeCall) {
      if (routeCall.method === 'group') {
        const prefix = phpStringValue(routeCall.args[0])
        const closure = routeCall.args[1]
        if (prefix !== null && isPhpNode(closure) && closure.kind === 'closure') {
          walkRoutes(closure.body, [...groupStack, prefix], routes)
        }
        return
      }
      if (HTTP_METHODS.has(routeCall.method)) {
        const routePath = phpStringValue(routeCall.args[0])
        const actionRaw = phpStringValue(routeCall.args[1])
        if (routePath !== null && actionRaw !== null) {
          const action = actionRaw.replace(/^\\/, '').replace(/\/\$\d+.*$/, '')
          const [controller, actionMethod] = action.split('::')
          if (controller && actionMethod) {
            const prefix = groupStack.join('/')
            const full = ['', prefix, routePath].filter((s) => s && s !== '/').join('/')
            routes.push({ method: routeCall.method, routePath: full || '/', controller, action: actionMethod })
          }
        }
      }
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'kind') continue
    walkRoutes(node[key], groupStack, routes)
  }
}

function parseRouteCalls(content: string, filename: string): RawRoute[] {
  const program = parsePhp(content, filename)
  if (!program) return []
  const routes: RawRoute[] = []
  walkRoutes(program, [], routes)
  return routes
}

const PLACEHOLDER = /\(:num\)|\(:any\)|\(:segment\)|\(:alpha\)/

/** `(:num)` / `(:any)` / `(:segment)` -> `{param}` for display, matching the
 * spec's own route-table examples (`/customers/{id}`). */
function humanizeRoutePath(routePath: string): string {
  const normalized = routePath.replace(new RegExp(PLACEHOLDER, 'g'), '{id}').replace(/^\/+/, '')
  return normalized ? `/${normalized}` : '/'
}

function titleCaseWords(input: string): string {
  return input
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function nameFromRoute(routePath: string, controller: string, action: string): string {
  const segments = routePath.split('/').filter((s) => s && !PLACEHOLDER.test(s))
  if (segments.length > 0) return titleCaseWords(segments[segments.length - 1])
  if (action && action.toLowerCase() !== 'index') return titleCaseWords(action)
  return titleCaseWords(controller.split('\\').pop() ?? controller)
}

/** `Admin\Users` -> `app/Controllers/Admin/Users.php` (CI4's PSR-4 mapping
 * of `App\Controllers\...` onto `app/Controllers/...`). */
function controllerFilePath(controller: string): string {
  return path.posix.join('app/Controllers', ...controller.split('\\')) + '.php'
}

/** Finds the `view('some/path')` call inside one controller method's body
 * via a real AST search — best-effort, and only trusted if the resulting
 * file actually exists on disk (never claims a source mapping that isn't
 * real). */
function resolveViewFile(rootPath: string, controllerRelPath: string, action: string): string | null {
  const absControllerPath = path.join(rootPath, controllerRelPath)
  let content: string
  try {
    content = fs.readFileSync(absControllerPath, 'utf-8')
  } catch {
    return null
  }

  const program = parsePhp(content, absControllerPath)
  if (!program) return null

  const classNode = findPhpNode(program, (n) => n.kind === 'class')
  if (!classNode) return null
  const methodNode = findPhpNode(classNode.body, (n) => n.kind === 'method' && phpNodeName(n.name) === action)
  if (!methodNode) return null

  const viewCall = findPhpNode(methodNode.body, (n) => {
    const what = n.what
    return n.kind === 'call' && isPhpNode(what) && what.kind === 'name' && what.name === 'view'
  })
  if (!viewCall) return null
  const args = Array.isArray(viewCall.arguments) ? viewCall.arguments : []
  const viewName = phpStringValue(args[0])
  if (viewName === null) return null

  const viewRelPath = path.posix.join('app/Views', `${viewName}.php`)
  return fs.existsSync(path.join(rootPath, viewRelPath)) ? viewRelPath : null
}

export function findCodeIgniterRoutes(rootPath: string): DetectedPage[] {
  const routesFile = path.join(rootPath, 'app', 'Config', 'Routes.php')
  let content: string
  try {
    content = fs.readFileSync(routesFile, 'utf-8')
  } catch {
    return []
  }

  const pages: DetectedPage[] = []
  const seenRoutes = new Set<string>()

  // GET routes only — POST/PUT/DELETE/PATCH are actions (form submits,
  // deletes), not screens a designer would open (matches the spec's own
  // route-table examples, which are all GET-shaped page routes).
  for (const route of parseRouteCalls(content, routesFile).filter((r) => r.method === 'get')) {
    if (seenRoutes.has(route.routePath)) continue
    seenRoutes.add(route.routePath)

    const controllerRelPath = controllerFilePath(route.controller)
    const viewRelPath = resolveViewFile(rootPath, controllerRelPath, route.action)
    const sourceExists = viewRelPath ? true : fs.existsSync(path.join(rootPath, controllerRelPath))
    if (!sourceExists) continue

    pages.push({
      id: crypto.randomUUID(),
      name: nameFromRoute(route.routePath, route.controller, route.action),
      filePath: viewRelPath ?? controllerRelPath,
      route: humanizeRoutePath(route.routePath),
    })
  }

  return pages
}
