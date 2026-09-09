import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DetectedPage } from '@shared/types/projectIndex'
import { parsePhp, isPhpNode, phpNodeName, phpStringValue, findPhpNode } from '@core/adapters/php/parsePhp'

interface RawRoute {
  method: 'get' | 'view'
  routePath: string
  handler: unknown
}

/** `use App\Http\Controllers\UserController;` (optionally `as Alias`) —
 * lets a bare `UserController::class` reference in the route file resolve
 * to its real namespace, which is how idiomatic Laravel code writes it. */
function buildUseMap(program: unknown): Map<string, string> {
  const map = new Map<string, string>()
  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!isPhpNode(node)) return
    if (node.kind === 'usegroup' && Array.isArray(node.items)) {
      for (const item of node.items) {
        if (!isPhpNode(item) || item.kind !== 'useitem' || typeof item.name !== 'string') continue
        const alias = phpNodeName(item.alias)
        const bare = alias ?? item.name.split('\\').pop()
        if (bare) map.set(bare, item.name)
      }
      return
    }
    for (const key of Object.keys(node)) {
      if (key !== 'kind') visit(node[key])
    }
  }
  visit(program)
  return map
}

/** Collects every `prefix('x')` call found anywhere along a fluent chain —
 * `Route::prefix('admin')->group(...)`, or with other links in between
 * (`->middleware([...])->prefix('admin')->group(...)`) — by walking back
 * through `.what.what` as long as it's itself a call on a static or
 * property lookup. */
function collectChainPrefixes(node: unknown, prefixes: string[]): void {
  if (!isPhpNode(node) || node.kind !== 'call') return
  const what = node.what
  if (!isPhpNode(what) || (what.kind !== 'staticlookup' && what.kind !== 'propertylookup')) return
  if (phpNodeName(what.offset) === 'prefix') {
    const args = Array.isArray(node.arguments) ? node.arguments : []
    const value = phpStringValue(args[0])
    if (value !== null) prefixes.push(value)
  }
  collectChainPrefixes(what.what, prefixes)
}

function arrayEntryString(node: unknown, key: string): string | null {
  if (!isPhpNode(node) || node.kind !== 'array' || !Array.isArray(node.items)) return null
  for (const item of node.items) {
    if (!isPhpNode(item) || item.kind !== 'entry') continue
    if (phpStringValue(item.key) === key) return phpStringValue(item.value)
  }
  return null
}

function joinPrefix(prefixStack: string[], routePath: string): string {
  const segments = [...prefixStack, routePath].map((s) => s.replace(/^\/+|\/+$/g, '')).filter(Boolean)
  return segments.length > 0 ? `/${segments.join('/')}` : '/'
}

/**
 * Recursively walks a parsed `routes/web.php` AST for `Route::get`/
 * `Route::view` definitions and both group syntaxes Laravel supports
 * (`Route::group(['prefix' => ...], fn)` and `Route::prefix(...)->group(fn)`)
 * — real AST traversal, same approach as `codeigniterAdapter.ts`'s
 * `walkRoutes`, generalized to Laravel's two group shapes.
 */
function walkRoutes(node: unknown, prefixStack: string[], routes: RawRoute[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkRoutes(item, prefixStack, routes)
    return
  }
  if (!isPhpNode(node)) return

  if (node.kind === 'call') {
    const what = node.what
    const args = Array.isArray(node.arguments) ? node.arguments : []

    if (isPhpNode(what) && what.kind === 'staticlookup' && isPhpNode(what.what) && what.what.kind === 'name' && what.what.name === 'Route') {
      const method = phpNodeName(what.offset)
      if (method === 'group') {
        const prefix = arrayEntryString(args[0], 'prefix')
        const closure = args[args.length - 1]
        if (isPhpNode(closure) && closure.kind === 'closure') {
          walkRoutes(closure.body, prefix !== null ? [...prefixStack, prefix] : prefixStack, routes)
        }
        return
      }
      if (method === 'get' || method === 'view') {
        const routePath = phpStringValue(args[0])
        if (routePath !== null) routes.push({ method, routePath: joinPrefix(prefixStack, routePath), handler: args[1] })
        return
      }
    } else if (isPhpNode(what) && what.kind === 'propertylookup' && phpNodeName(what.offset) === 'group') {
      const prefixes: string[] = []
      collectChainPrefixes(what.what, prefixes)
      const closure = args[args.length - 1]
      if (isPhpNode(closure) && closure.kind === 'closure') {
        walkRoutes(closure.body, [...prefixStack, ...prefixes], routes)
      }
      return
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'kind') continue
    walkRoutes(node[key], prefixStack, routes)
  }
}

function findViewInBody(rootPath: string, body: unknown): string | null {
  const viewCall = findPhpNode(body, (n) => {
    const what = n.what
    return n.kind === 'call' && isPhpNode(what) && what.kind === 'name' && what.name === 'view'
  })
  if (!viewCall) return null
  const args = Array.isArray(viewCall.arguments) ? viewCall.arguments : []
  const viewName = phpStringValue(args[0])
  if (viewName === null) return null
  const relPath = path.posix.join('resources/views', ...viewName.split('.')) + '.blade.php'
  return fs.existsSync(path.join(rootPath, relPath)) ? relPath : null
}

/** `App\Http\Controllers\UserController` -> `app/Http/Controllers/
 * UserController.php` — Laravel's default PSR-4 map (`App\` -> `app/`),
 * generalized rather than hardcoded to `Http/Controllers` specifically. */
function resolveControllerView(rootPath: string, useMap: Map<string, string>, controllerRaw: string, action: string): string | null {
  const resolved = useMap.get(controllerRaw) ?? controllerRaw
  // A bare name with no `use` import (common with the legacy `'Controller@
  // action'` string style) resolves against Laravel's default controller
  // namespace, exactly as the framework's own router does at runtime.
  const fqcn = resolved.includes('\\') ? resolved : `App\\Http\\Controllers\\${resolved}`
  const relControllerPath = fqcn.replace(/^\\+/, '').split('\\').map((segment, i) => (i === 0 ? 'app' : segment)).join('/') + '.php'
  let content: string
  try {
    content = fs.readFileSync(path.join(rootPath, relControllerPath), 'utf-8')
  } catch {
    return null
  }
  const program = parsePhp(content, relControllerPath)
  if (!program) return null
  const classNode = findPhpNode(program, (n) => n.kind === 'class')
  if (!classNode) return null
  const methodNode = findPhpNode(classNode.body, (n) => n.kind === 'method' && phpNodeName(n.name) === action)
  if (!methodNode) return null
  return findViewInBody(rootPath, methodNode.body)
}

function resolveHandlerView(rootPath: string, useMap: Map<string, string>, route: RawRoute): string | null {
  if (route.method === 'view') {
    const viewName = phpStringValue(route.handler)
    if (viewName === null) return null
    const relPath = path.posix.join('resources/views', ...viewName.split('.')) + '.blade.php'
    return fs.existsSync(path.join(rootPath, relPath)) ? relPath : null
  }

  const handler = route.handler
  if (!isPhpNode(handler)) return null

  if (handler.kind === 'closure') return findViewInBody(rootPath, handler.body)

  if (handler.kind === 'string' && typeof handler.value === 'string') {
    const [controllerRaw, action] = handler.value.split('@')
    if (!controllerRaw || !action) return null
    return resolveControllerView(rootPath, useMap, controllerRaw, action)
  }

  if (handler.kind === 'array' && Array.isArray(handler.items) && handler.items.length === 2) {
    const [first, second] = handler.items
    const classNode = isPhpNode(first) && first.kind === 'entry' ? first.value : undefined
    const action = isPhpNode(second) && second.kind === 'entry' ? phpStringValue(second.value) : null
    if (isPhpNode(classNode) && classNode.kind === 'staticlookup' && isPhpNode(classNode.what) && classNode.what.kind === 'name' && action) {
      return resolveControllerView(rootPath, useMap, classNode.what.name as string, action)
    }
  }

  return null
}

const PARAM_SEGMENT = /^\{.*\}$/

function titleCaseWords(input: string): string {
  return input
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function nameFromRoute(routePath: string): string {
  const segments = routePath.split('/').filter((s) => s && !PARAM_SEGMENT.test(s))
  return titleCaseWords(segments[segments.length - 1] ?? 'Home')
}

export function findLaravelRoutes(rootPath: string): DetectedPage[] {
  const routesFile = path.join(rootPath, 'routes', 'web.php')
  let content: string
  try {
    content = fs.readFileSync(routesFile, 'utf-8')
  } catch {
    return []
  }
  const program = parsePhp(content, routesFile)
  if (!program) return []

  const useMap = buildUseMap(program)
  const rawRoutes: RawRoute[] = []
  walkRoutes(program, [], rawRoutes)

  const pages: DetectedPage[] = []
  const seenRoutes = new Set<string>()
  for (const route of rawRoutes) {
    if (seenRoutes.has(route.routePath)) continue
    const viewRelPath = resolveHandlerView(rootPath, useMap, route)
    if (!viewRelPath) continue
    seenRoutes.add(route.routePath)
    pages.push({
      id: crypto.randomUUID(),
      name: nameFromRoute(route.routePath),
      filePath: viewRelPath,
      route: route.routePath,
    })
  }

  return pages
}
