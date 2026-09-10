const fs = require('fs/promises')
const path = require('path')

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.php', '.prisma'])
const IGNORED_DIRECTORIES = new Set(['.git', '.next', '.nuxt', '.output', '.svelte-kit', 'build', 'coverage', 'dist', 'node_modules', 'release', 'vendor'])
const MAX_FILES = 450
const MAX_FILE_SIZE = 320 * 1024

function slash(value) { return String(value || '').split(path.sep).join('/') }
function nodeId(prefix, value) { return `${prefix}:${slash(value).replace(/[^a-z0-9/_.:@-]+/gi, '-')}` }

function classifySource(relativePath, contents = '') {
  const target = slash(relativePath).toLowerCase()
  if (/(^|\/)(dockerfile|docker-compose|compose\.ya?ml|vite\.config|next\.config|nuxt\.config|astro\.config)/.test(target)) return 'infrastructure'
  if (/(^|\/)(prisma|database|db|models?|repositories|entities|migrations)(\/|\.|$)/.test(target)) return 'data'
  if (/(^|\/)(routes?|controllers?|services?|jobs?|workers?|server|api|middleware)(\/|\.|$)/.test(target) || /\b(express|fastify|koa|router|route::)\b/i.test(contents)) return 'server'
  if (/\.(jsx|tsx|vue|svelte)$/.test(target) || /(^|\/)(pages?|components?|views?|client|frontend|app)(\/|$)/.test(target)) return 'client'
  return 'server'
}

function sourceKind(relativePath, layer) {
  const target = slash(relativePath).toLowerCase()
  if (/(^|\/)components?(\/|$)/.test(target)) return 'component'
  if (/(^|\/)(pages?|views?)(\/|$)/.test(target)) return 'page'
  if (/(^|\/)routes?(\/|\.|$)/.test(target)) return 'route-file'
  if (/(^|\/)controllers?(\/|\.|$)/.test(target)) return 'controller'
  if (/(^|\/)services?(\/|\.|$)/.test(target)) return 'service'
  if (/(^|\/)(jobs?|workers?)(\/|\.|$)/.test(target)) return 'job'
  if (layer === 'data') return 'model'
  if (layer === 'infrastructure') return 'config'
  return 'source'
}

async function collectSourceFiles(root) {
  const files = []
  async function visit(directory) {
    if (files.length >= MAX_FILES) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (files.length >= MAX_FILES || entry.isSymbolicLink()) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolute)
        continue
      }
      const relativePath = slash(path.relative(root, absolute))
      const extension = path.extname(entry.name).toLowerCase()
      const configFile = /(^|\/)(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i.test(relativePath)
      if (!SOURCE_EXTENSIONS.has(extension) && !configFile) continue
      const stat = await fs.stat(absolute).catch(() => null)
      if (stat?.isFile() && stat.size <= MAX_FILE_SIZE) files.push({ absolute, relativePath, extension })
    }
  }
  await visit(root)
  return files
}

function resolveImport(sourcePath, request, knownPaths) {
  if (!request.startsWith('.')) return null
  const base = slash(path.posix.normalize(path.posix.join(path.posix.dirname(slash(sourcePath)), request)))
  const candidates = [base, ...[...SOURCE_EXTENSIONS].map(extension => `${base}${extension}`), ...[...SOURCE_EXTENSIONS].map(extension => `${base}/index${extension}`)]
  return candidates.find(candidate => knownPaths.has(candidate)) || null
}

function importsIn(contents) {
  const values = []
  const pattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|require\s*\()\s*['"]([^'"]+)['"]/g
  for (const match of contents.matchAll(pattern)) values.push(match[1])
  return values
}

function normalizeRoute(value) {
  const route = String(value || '').trim()
  if (!route) return '/'
  return route.startsWith('/') ? route.replace(/\/+$/g, '') || '/' : `/${route.replace(/\/+$/g, '')}`
}

function routesIn(relativePath, contents) {
  const routes = []
  const patterns = [
    { regex: /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]+)['"]/gi, method: 1, route: 2 },
    { regex: /\bRoute::(get|post|put|patch|delete|options)\s*\(\s*['"]([^'"]+)['"]/gi, method: 1, route: 2 },
  ]
  for (const pattern of patterns) for (const match of contents.matchAll(pattern.regex)) routes.push({ method: match[pattern.method].toUpperCase(), path: normalizeRoute(match[pattern.route]), file: relativePath })
  const nextRoute = slash(relativePath).match(/(?:^|\/)app\/(?:api\/)?(.+)\/route\.(?:js|jsx|ts|tsx)$/i)
  if (nextRoute) {
    const methods = [...contents.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map(match => match[1])
    const routePath = normalizeRoute(`/api/${nextRoute[1].replace(/\/\([^/]+\)/g, '').replace(/\[([^\]]+)\]/g, ':$1')}`)
    for (const method of methods) routes.push({ method, path: routePath, file: relativePath })
  }
  return routes
}

function callsIn(relativePath, contents) {
  const calls = []
  const fetchPattern = /\bfetch\s*\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*\{([\s\S]{0,240}?)\})?/g
  for (const match of contents.matchAll(fetchPattern)) {
    const method = match[2]?.match(/method\s*:\s*['"]([A-Z]+)['"]/i)?.[1]?.toUpperCase() || 'GET'
    if (match[1].startsWith('/') || match[1].includes('/api/')) calls.push({ method, path: normalizeRoute(match[1].replace(/^https?:\/\/[^/]+/i, '')), file: relativePath })
  }
  const axiosPattern = /\baxios\s*\.\s*(get|post|put|patch|delete)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi
  for (const match of contents.matchAll(axiosPattern)) calls.push({ method: match[1].toUpperCase(), path: normalizeRoute(match[2].replace(/^https?:\/\/[^/]+/i, '')), file: relativePath })
  return calls
}

function externalServicesIn(relativePath, contents) {
  const services = new Map()
  const hosts = contents.matchAll(/https?:\/\/([a-z0-9.-]+)(?:[:/][^\s'"`]*)?/gi)
  for (const match of hosts) {
    const host = match[1].toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) continue
    services.set(`host:${host}`, { key: `host:${host}`, label: host, detail: 'External HTTP service', file: relativePath })
  }
  const providers = {
    STRIPE: 'Stripe', SENDGRID: 'SendGrid', MAILGUN: 'Mailgun', RESEND: 'Resend', AUTH0: 'Auth0', CLERK: 'Clerk',
    FIREBASE: 'Firebase', SUPABASE: 'Supabase', SENTRY: 'Sentry', AWS: 'AWS', TWILIO: 'Twilio', WHATSAPP: 'WhatsApp', PAYFAST: 'PayFast', OPENAI: 'OpenAI', GITHUB: 'GitHub',
  }
  for (const key of Object.keys(providers)) {
    if (new RegExp(`(?:process\\.env\\.|import\\.meta\\.env\\.|env\\s*\\(\\s*['\"]?)${key}[A-Z0-9_]*`, 'i').test(contents)) {
      services.set(`provider:${key}`, { key: `provider:${key}`, label: providers[key], detail: 'Detected from environment reference', file: relativePath })
    }
  }
  return [...services.values()]
}

function packageDependencies(manifest) {
  const groups = { ...manifest.dependencies, ...manifest.devDependencies }
  return Object.entries(groups || {}).sort(([left], [right]) => left.localeCompare(right)).slice(0, 40)
}

function runtimeNodes(project, runtimeState) {
  const process = runtimeState?.process || project.process || {}
  const services = runtimeState?.services || {}
  const running = Boolean(process.running)
  const nodes = [{
    id: 'runtime:app', label: project.framework?.name || project.type || 'Application', subtitle: 'Application server', layer: 'runtime', kind: 'process',
    status: running ? services.web?.status || 'healthy' : process.status || 'stopped', endpoint: `localhost:${process.port || project.preferredPort || 3000}`,
    metrics: [project.runtime?.type && `${project.runtime.type} ${project.runtime.constraint || ''}`, process.pid && `PID ${process.pid}`].filter(Boolean),
  }]
  if (process.apiPort || project.apiPort) nodes.push({ id: 'runtime:api', label: 'API server', subtitle: 'Backend service', layer: 'runtime', kind: 'process', status: running ? services.api?.status || 'healthy' : 'stopped', endpoint: `localhost:${process.apiPort || project.apiPort}`, metrics: ['HTTP /api'] })
  const database = project.database?.engine || project.databaseHints?.[0]
  if (database) nodes.push({ id: 'runtime:database', label: database, subtitle: project.database?.database || 'Project database', layer: 'runtime', kind: 'database', status: services.database?.status || (database === 'SQLite' ? 'healthy' : 'unknown'), endpoint: project.database?.file || (project.database?.port ? `localhost:${project.database.port}` : 'Managed locally'), metrics: [] })
  nodes.push({ id: 'runtime:proxy', label: 'Local proxy', subtitle: 'Stable project routing', layer: 'runtime', kind: 'proxy', status: 'healthy', endpoint: `${project.localDomain || 'project.localhost'}:${project.proxyPort || 4180}`, metrics: [] })
  return nodes
}

async function generateSystemMap(project, runtimeState = null) {
  const root = path.resolve(project.path)
  const files = await collectSourceFiles(root)
  const records = await Promise.all(files.map(async file => ({ ...file, contents: await fs.readFile(file.absolute, 'utf8').catch(() => '') })))
  const knownPaths = new Set(records.map(record => record.relativePath))
  const nodes = []
  const edges = []
  const nodeIds = new Map()
  const routes = []
  const calls = []
  const externalServices = []

  for (const record of records) {
    const layer = classifySource(record.relativePath, record.contents)
    const id = nodeId('file', record.relativePath)
    nodeIds.set(record.relativePath, id)
    nodes.push({ id, label: path.basename(record.relativePath), subtitle: slash(path.dirname(record.relativePath)) === '.' ? 'Project root' : slash(path.dirname(record.relativePath)), layer, kind: sourceKind(record.relativePath, layer), file: record.relativePath, status: 'detected', metrics: [] })
    routes.push(...routesIn(record.relativePath, record.contents))
    calls.push(...callsIn(record.relativePath, record.contents))
    externalServices.push(...externalServicesIn(record.relativePath, record.contents))
  }

  for (const record of records) {
    for (const request of importsIn(record.contents)) {
      const target = resolveImport(record.relativePath, request, knownPaths)
      if (!target) continue
      edges.push({ id: nodeId('edge', `${record.relativePath}->${target}`), source: nodeIds.get(record.relativePath), target: nodeIds.get(target), type: 'direct', status: 'detected', label: 'imports' })
    }
  }

  const routeIds = new Map()
  for (const route of routes) {
    const key = `${route.method} ${route.path}`
    let id = routeIds.get(key)
    if (!id) {
      id = nodeId('route', key)
      routeIds.set(key, id)
      nodes.push({ id, label: route.path, subtitle: route.method, layer: 'server', kind: 'route', file: route.file, method: route.method, route: route.path, status: 'detected', metrics: [] })
    }
    edges.push({ id: nodeId('edge', `${key}->${route.file}`), source: id, target: nodeIds.get(route.file), type: 'direct', status: 'detected', label: 'handled by' })
  }
  for (const call of calls) {
    const exact = routeIds.get(`${call.method} ${call.path}`)
    const fallback = [...routeIds.entries()].find(([key]) => key.endsWith(` ${call.path}`))?.[1]
    const target = exact || fallback
    if (target && nodeIds.has(call.file)) edges.push({ id: nodeId('edge', `${call.file}->${call.method}-${call.path}`), source: nodeIds.get(call.file), target, type: 'request', status: 'detected', label: `${call.method} ${call.path}` })
  }

  const externalIds = new Map()
  for (const service of externalServices) {
    let id = externalIds.get(service.key)
    if (!id) {
      id = nodeId('external', service.key)
      externalIds.set(service.key, id)
      nodes.push({ id, label: service.label, subtitle: service.detail, layer: 'external', kind: 'external', status: 'detected', metrics: [] })
    }
    const source = nodeIds.get(service.file)
    if (source) edges.push({ id: nodeId('edge', `${service.file}->${service.key}`), source, target: id, type: 'optional', status: 'detected', label: 'external call' })
  }

  const runtime = runtimeNodes(project, runtimeState)
  nodes.push(...runtime)
  const clientRoots = nodes.filter(node => node.layer === 'client' && !edges.some(edge => edge.target === node.id)).slice(0, 8)
  for (const node of clientRoots) edges.push({ id: nodeId('edge', `runtime-app->${node.id}`), source: 'runtime:app', target: node.id, type: 'runtime', status: runtime[0].status, label: 'serves' })
  const serverRoots = nodes.filter(node => node.layer === 'server' && node.kind !== 'route' && !edges.some(edge => edge.target === node.id)).slice(0, 8)
  const serverRuntime = runtime.some(node => node.id === 'runtime:api') ? 'runtime:api' : 'runtime:app'
  for (const node of serverRoots) edges.push({ id: nodeId('edge', `${serverRuntime}->${node.id}`), source: serverRuntime, target: node.id, type: 'runtime', status: runtime.find(item => item.id === serverRuntime)?.status || 'unknown', label: 'runs' })
  if (nodes.some(node => node.id === 'runtime:database')) {
    for (const node of nodes.filter(item => item.layer === 'data').slice(0, 12)) edges.push({ id: nodeId('edge', `${node.id}->runtime-db`), source: node.id, target: 'runtime:database', type: 'data', status: runtime.find(item => item.id === 'runtime:database')?.status || 'unknown', label: 'reads / writes' })
  }
  edges.push({ id: 'edge:app-proxy', source: 'runtime:proxy', target: 'runtime:app', type: 'runtime', status: runtime.find(item => item.id === 'runtime:app')?.status || 'unknown', label: 'routes' })

  const manifest = await fs.readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse).catch(() => null)
  if (manifest) {
    const manifestId = nodeIds.get('package.json') || 'manifest:package'
    if (!nodeIds.has('package.json')) nodes.push({ id: manifestId, label: 'package.json', subtitle: 'Project manifest', layer: 'dependencies', kind: 'manifest', file: 'package.json', status: 'detected', metrics: [] })
    for (const [name, version] of packageDependencies(manifest)) {
      const id = nodeId('package', name)
      nodes.push({ id, label: name, subtitle: version, layer: 'dependencies', kind: 'package', status: 'detected', metrics: [] })
      edges.push({ id: nodeId('edge', `package.json->${name}`), source: manifestId, target: id, type: 'dependency', status: 'detected', label: 'depends on' })
    }
  }

  const uniqueEdges = [...new Map(edges.filter(edge => edge.source && edge.target && edge.source !== edge.target).map(edge => [edge.id, edge])).values()]
  return {
    projectId: project.id,
    generatedAt: new Date().toISOString(),
    nodes,
    edges: uniqueEdges,
    routes: [...routeIds.entries()].map(([label, id]) => ({ id, label })),
    summary: {
      filesScanned: records.length,
      nodes: nodes.length,
      edges: uniqueEdges.length,
      routes: routeIds.size,
      truncated: files.length >= MAX_FILES,
    },
  }
}

async function resolveSystemMapSource(project, relativePath) {
  const root = await fs.realpath(path.resolve(project.path))
  const requested = path.resolve(root, String(relativePath || ''))
  if (requested === root || !requested.startsWith(`${root}${path.sep}`)) throw new Error('The requested source is outside the project folder.')
  const resolved = await fs.realpath(requested).catch(() => null)
  if (!resolved || !resolved.startsWith(`${root}${path.sep}`)) throw new Error('The requested source is outside the project folder.')
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('The requested source is not a file.')
  return resolved
}

module.exports = { generateSystemMap, resolveSystemMapSource, classifySource, routesIn, callsIn, externalServicesIn }
