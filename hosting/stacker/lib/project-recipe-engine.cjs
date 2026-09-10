const path = require('path')

// The recipe catalogue is the single source of truth for framework behaviour.
// Keep recipes declarative: orchestration belongs to the setup/process engines.
const APPLICATION_TYPES = Object.freeze({
  website: 'Website',
  webapp: 'Web Application',
  dashboard: 'Dashboard / Internal Tool',
  api: 'API',
  other: 'Other',
})

const NODE_MANAGERS = ['pnpm', 'npm', 'yarn']
const DATA_BACKED = new Set(['webapp', 'dashboard', 'api'])
const VITE_FRONTENDS = new Set(['react', 'vue', 'vite'])
const REQUIRED_SUPPORT_CHECKS = Object.freeze(['detection', 'creation', 'dependencyInstallation', 'startup', 'httpVerification', 'stop', 'restart', 'import', 'environmentRecreation', 'databasePolicy', 'migrationDetection'])

function nodeRecipe(overrides) {
  return {
    language: 'JavaScript',
    runtime: { type: 'Node.js', minimum: '20.9.0', recommended: '22', managed: true },
    packageManagers: { supported: NODE_MANAGERS, recommended: 'npm' },
    documentRoot: '.',
    commands: { install: 'package-install', start: 'package-script:dev|start', build: 'package-script:build', test: 'package-script:test' },
    database: { required: false, supported: [], recommended: { default: 'none' }, access: 'none', drivers: {} },
    migrations: [],
    writableDirectories: [],
    healthCheck: { type: 'http', path: '/', readinessTimeoutMs: 60_000, acceptedStatusBelow: 500 },
    repairs: ['install-dependencies', 'select-compatible-runtime', 'choose-free-port'],
    productionEnabled: true,
    ...overrides,
  }
}

function phpRecipe(overrides) {
  return {
    language: 'PHP',
    runtime: { type: 'PHP', minimum: '8.2.0', recommended: '8.3', managed: true },
    packageManagers: { supported: ['composer'], recommended: 'composer' },
    documentRoot: '.',
    commands: { install: ['composer', ['install']] },
    database: {
      required: false,
      supported: ['postgres', 'mariadb', 'sqlite'],
      recommended: { default: 'postgres' },
      access: 'server',
      drivers: { postgres: 'pdo_pgsql', mariadb: 'pdo_mysql', sqlite: 'pdo_sqlite' },
    },
    migrations: [],
    writableDirectories: [],
    healthCheck: { type: 'http', path: '/', readinessTimeoutMs: 45_000, acceptedStatusBelow: 500 },
    repairs: ['install-dependencies', 'select-compatible-runtime', 'choose-free-port'],
    productionEnabled: true,
    ...overrides,
  }
}

const RECIPES = [
  { id: 'dotnet', name: 'ASP.NET Core / Blazor', language: 'C#', runtime: { type: '.NET', managed: true },
    packageManagers: { supported: [], recommended: null }, documentRoot: '.', defaultPort: 5000,
    detection: {}, commands: {}, database: { required: false, supported: [], recommended: { default: 'none' }, drivers: {} },
    migrations: [], writableDirectories: [], healthCheck: { type: 'http', path: '/', readinessTimeoutMs: 120000, acceptedStatusBelow: 500 },
    repairs: ['install-dependencies', 'select-compatible-runtime', 'choose-free-port'], productionEnabled: true },
  nodeRecipe({
    id: 'next', name: 'Next.js', aliases: ['Next'], detection: { dependencies: ['next'] },
    runtime: { type: 'Node.js', minimum: '20.9.0', recommended: '22', managed: true },
    create: { tool: 'create-next-app', expectedFiles: ['package.json'], supportsPackageManager: true },
    defaultPort: 3000,
    commands: { install: 'package-install', start: 'package-script:dev|start', build: 'package-script:build', test: 'package-script:test' },
    database: {
      required: false, supported: ['postgres', 'mariadb', 'sqlite'],
      recommended: { website: 'none', webapp: 'postgres', dashboard: 'postgres', api: 'postgres', other: 'none', default: 'none' },
      access: 'server-only',
      drivers: { postgres: ['pg', '@types/pg'], mariadb: ['mysql2'], sqlite: ['better-sqlite3', '@types/better-sqlite3'] },
      module: 'src/lib/db.ts', generateHttpApi: false,
    },
    migrations: [
      { id: 'prisma', filesAny: ['prisma/schema.prisma'], directoriesAny: ['prisma/migrations'], commandScripts: ['prisma:migrate', 'db:migrate'] },
      { id: 'drizzle', filesAny: ['drizzle.config.ts', 'drizzle.config.js'], directoriesAny: ['drizzle'], commandScripts: ['db:migrate', 'migrate'] },
    ],
    expectedFiles: ['package.json'],
  }),
  nodeRecipe({
    id: 'react', name: 'React + Vite', aliases: ['React'], detection: { dependencies: ['react', 'vite'] },
    create: { tool: 'create-vite', template: 'react', expectedFiles: ['package.json'], supportsPackageManager: true }, defaultPort: 5173,
    database: { required: false, supported: ['postgres', 'mariadb', 'sqlite'], recommended: { website: 'none', webapp: 'postgres', dashboard: 'postgres', api: 'postgres', other: 'none', default: 'none' }, access: 'generated-backend', drivers: {} },
  }),
  nodeRecipe({
    id: 'vue', name: 'Vue + Vite', aliases: ['Vue'], detection: { dependencies: ['vue', 'vite'] },
    create: { tool: 'create-vite', template: 'vue', expectedFiles: ['package.json'], supportsPackageManager: true }, defaultPort: 5173,
    database: { required: false, supported: ['postgres', 'mariadb', 'sqlite'], recommended: { website: 'none', webapp: 'postgres', dashboard: 'postgres', api: 'postgres', other: 'none', default: 'none' }, access: 'generated-backend', drivers: {} },
  }),
  nodeRecipe({
    id: 'astro', name: 'Astro', detection: { dependencies: ['astro'] },
    runtime: { type: 'Node.js', minimum: '22.12.0', recommended: '22', managed: true },
    create: { tool: 'create-astro', expectedFiles: ['package.json'], supportsPackageManager: true }, defaultPort: 4321,
    database: { required: false, supported: ['postgres', 'mariadb', 'sqlite'], recommended: { default: 'none', webapp: 'postgres', dashboard: 'postgres', api: 'postgres' }, access: 'server-only-when-ssr', drivers: { postgres: ['pg'], mariadb: ['mysql2'], sqlite: ['better-sqlite3'] } },
  }),
  nodeRecipe({
    id: 'nuxt', name: 'Nuxt', detection: { dependenciesAny: ['nuxt'], filesAny: ['nuxt.config.ts', 'nuxt.config.js'] },
    runtime: { type: 'Node.js', minimum: '22.0.0', recommended: '22', managed: true },
    create: { tool: 'create-nuxt', expectedFiles: ['package.json'], supportsPackageManager: true }, defaultPort: 3000,
    database: { required: false, supported: ['postgres', 'mariadb', 'sqlite'], recommended: { default: 'none', webapp: 'postgres', dashboard: 'postgres', api: 'postgres' }, access: 'server-layer', drivers: { postgres: ['pg'], mariadb: ['mysql2'], sqlite: ['better-sqlite3'] } },
    migrations: [
      { id: 'prisma', filesAny: ['prisma/schema.prisma'], directoriesAny: ['prisma/migrations'], commandScripts: ['prisma:migrate', 'db:migrate'] },
      { id: 'drizzle', filesAny: ['drizzle.config.ts', 'drizzle.config.js'], directoriesAny: ['drizzle'], commandScripts: ['db:migrate', 'migrate'] },
    ],
    productionEnabled: true,
  }),
  nodeRecipe({
    id: 'sveltekit', name: 'SvelteKit', detection: { dependenciesAny: ['@sveltejs/kit'] },
    runtime: { type: 'Node.js', minimum: '20.19.0', recommended: '22', managed: true },
    create: { tool: 'create-sveltekit', expectedFiles: ['package.json'], supportsPackageManager: true }, defaultPort: 5173,
    database: { required: false, supported: ['postgres', 'mariadb', 'sqlite'], recommended: { default: 'none', webapp: 'postgres', dashboard: 'postgres', api: 'postgres' }, access: 'server-only', drivers: { postgres: ['pg'], mariadb: ['mysql2'], sqlite: ['better-sqlite3'] } },
    migrations: [
      { id: 'prisma', filesAny: ['prisma/schema.prisma'], directoriesAny: ['prisma/migrations'], commandScripts: ['prisma:migrate', 'db:migrate'] },
      { id: 'drizzle', filesAny: ['drizzle.config.ts', 'drizzle.config.js'], directoriesAny: ['drizzle'], commandScripts: ['db:migrate', 'migrate'] },
    ],
    productionEnabled: true,
  }),
  nodeRecipe({
    id: 'express', name: 'Node / Express', aliases: ['Express'], detection: { dependencies: ['express'] },
    create: { tool: 'express-generator', expectedFiles: ['package.json'], supportsPackageManager: true }, defaultPort: 3000,
    database: { required: false, supported: ['postgres', 'mariadb', 'sqlite'], recommended: { default: 'postgres' }, access: 'server', drivers: { postgres: ['pg'], mariadb: ['mysql2'], sqlite: ['better-sqlite3'] } },
  }),
  nodeRecipe({
    id: 'vite', name: 'Vite', detection: { dependencies: ['vite'] },
    create: { tool: 'create-vite', template: 'vanilla', expectedFiles: ['package.json'], supportsPackageManager: true }, defaultPort: 5173,
    database: { required: false, supported: ['postgres', 'mariadb', 'sqlite'], recommended: { website: 'none', webapp: 'postgres', dashboard: 'postgres', api: 'postgres', other: 'none', default: 'none' }, access: 'generated-backend', drivers: {} },
  }),
  nodeRecipe({ id: 'node', name: 'Node.js', detection: { manifest: 'package.json' }, create: null, defaultPort: 3000 }),
  phpRecipe({
    id: 'laravel', name: 'Laravel', detection: { priority: 100, files: ['artisan'], composerPackages: ['laravel/framework'] },
    create: { tool: 'composer-create-project', package: 'laravel/laravel', expectedFiles: ['artisan', 'composer.json'] }, documentRoot: 'public', defaultPort: 8000,
    commands: { install: ['composer', ['install']], start: ['php', ['artisan', 'serve', '--no-reload', '--host=127.0.0.1', '--port={port}']], build: null, test: ['php', ['artisan', 'test']], migrate: ['php', ['artisan', 'migrate']], migrateStatus: ['php', ['artisan', 'migrate:status']], seed: ['php', ['artisan', 'db:seed']] },
    migrations: [{ id: 'laravel', directoriesAny: ['database/migrations'], command: ['php', ['artisan', 'migrate']] }], writableDirectories: ['storage', 'bootstrap/cache'],
  }),
  phpRecipe({
    id: 'codeigniter', name: 'CodeIgniter 4', detection: { priority: 100, files: ['spark'], composerPackages: ['codeigniter4/framework'] },
    create: { tool: 'composer-create-project', package: 'codeigniter4/appstarter', expectedFiles: ['spark', 'composer.json'] }, documentRoot: 'public', defaultPort: 8080,
    commands: { install: ['composer', ['install']], start: ['php', ['spark', 'serve', '--host', '127.0.0.1', '--port', '{port}']], test: ['./vendor/bin/phpunit', []], migrate: ['php', ['spark', 'migrate']], migrateStatus: ['php', ['spark', 'migrate:status']], seed: ['php', ['spark', 'db:seed']] },
    migrations: [{ id: 'codeigniter', directoriesAny: ['app/Database/Migrations'], command: ['php', ['spark', 'migrate']] }], writableDirectories: ['writable'],
  }),
  phpRecipe({
    id: 'wordpress', name: 'WordPress', detection: { priority: 90, files: ['wp-load.php', 'wp-settings.php'] },
    dependenciesRequired: false,
    packageManagers: { supported: [], recommended: null },
    create: { tool: 'stacker-wordpress', expectedFiles: ['index.php', 'wp-load.php', 'wp-settings.php', 'wp-config-sample.php'] }, defaultPort: 8080,
    commands: { install: null, start: ['php', ['-S', '127.0.0.1:{port}', '-t', '{documentRoot}']], build: null, test: null },
    database: { required: true, supported: ['mariadb'], recommended: { default: 'mariadb' }, access: 'native', drivers: { mariadb: 'mysqli' } },
    healthCheck: { type: 'http', path: '/', readinessTimeoutMs: 45_000, acceptedStatusBelow: 500 },
    productionEnabled: true,
  }),
  phpRecipe({
    id: 'php', name: 'Generic PHP', detection: { manifest: 'composer.json' }, create: { tool: 'stacker-php', expectedFiles: ['composer.json', 'index.php'] }, defaultPort: 8000,
    commands: { install: ['composer', ['install']], start: ['php', ['-S', '127.0.0.1:{port}', '-t', '{documentRoot}']] },
  }),
  {
    id: 'static', name: 'Vanilla HTML / JS', aliases: ['Vanilla web'], language: 'HTML', detection: { files: ['index.html'] },
    runtime: null, packageManagers: { supported: [], recommended: null }, create: { tool: 'stacker-static', expectedFiles: ['index.html'] },
    commands: { start: ['python3', ['-m', 'http.server', '{port}', '--bind', '127.0.0.1', '--directory', '{projectRoot}']] },
    documentRoot: '.', defaultPort: 8080,
    database: { required: false, supported: [], recommended: { default: 'none' }, access: 'none', drivers: {} },
    migrations: [], writableDirectories: [], expectedFiles: ['index.html'],
    healthCheck: { type: 'http', path: '/', readinessTimeoutMs: 15_000, acceptedStatusBelow: 500 }, repairs: ['choose-free-port'], productionEnabled: true,
  },
]

function compositeRecipe(frontendId, database = 'none') {
  const frontend = RECIPES.find(recipe => recipe.id === frontendId)
  if (!frontend || !VITE_FRONTENDS.has(frontendId)) return null
  const databaseName = database === 'postgres' ? 'PostgreSQL' : database === 'mariadb' ? 'MariaDB' : database === 'sqlite' ? 'SQLite' : 'No database'
  return nodeRecipe({
    id: `${frontendId}-vite-express-${database}`,
    name: `${frontend.name} + Express`,
    aliases: [],
    detection: { stackerRecipe: `${frontendId}-vite-express-${database}` },
    create: { tool: 'stacker-fullstack', frontend: frontendId, template: frontend.create.template, expectedFiles: ['package.json', 'client/package.json', 'server/package.json', 'server/src/server.js', 'scripts/start.mjs'] },
    defaultPort: frontend.defaultPort,
    commands: { install: 'package-install', start: 'package-script:dev', build: 'package-script:build', test: 'package-script:test' },
    database: {
      required: database !== 'none',
      supported: database === 'none' ? [] : [database],
      recommended: { default: database },
      access: 'generated-backend',
      drivers: database === 'postgres' ? { postgres: ['pg'] } : database === 'mariadb' ? { mariadb: ['mysql2'] } : database === 'sqlite' ? { sqlite: ['better-sqlite3'] } : {},
    },
    composite: { frontend: frontendId, api: 'express', apiPath: '/api', apiPortOffset: 1, database, databaseName },
    expectedFiles: ['package.json', 'client/package.json', 'server/package.json', 'server/src/server.js', 'scripts/start.mjs'],
  })
}

const COMPOSITE_RECIPES = Object.freeze([...VITE_FRONTENDS].flatMap(frontend => ['none', 'postgres', 'mariadb', 'sqlite'].map(database => compositeRecipe(frontend, database))))

const UNKNOWN_RECIPE = Object.freeze({
  id: 'unknown', name: 'Unknown project', language: null, runtime: null,
  packageManagers: { supported: [], recommended: null }, create: null, commands: {}, documentRoot: '.', defaultPort: 3000,
  database: { required: false, supported: [], recommended: { default: 'none' }, access: 'unknown', drivers: {} },
  migrations: [], writableDirectories: [], expectedFiles: [], healthCheck: { type: 'http', path: '/', readinessTimeoutMs: 45_000, acceptedStatusBelow: 500 }, repairs: [], productionEnabled: false,
})

function clone(value) { return JSON.parse(JSON.stringify(value)) }

function recipeById(id) { return clone(RECIPES.find(recipe => recipe.id === id) || COMPOSITE_RECIPES.find(recipe => recipe.id === id) || UNKNOWN_RECIPE) }

function recipeByName(name) {
  const normalized = String(name || '').toLowerCase()
  return clone(RECIPES.find(recipe => recipe.name.toLowerCase() === normalized || recipe.aliases?.some(alias => alias.toLowerCase() === normalized)) || UNKNOWN_RECIPE)
}

function recipeSupportReport(recipeOrId) {
  const recipe = typeof recipeOrId === 'string' ? RECIPES.find(item => item.id === recipeOrId) : recipeOrId
  if (!recipe) return { supported: false, checks: {} }
  const checks = {
    detection: Boolean(recipe.detection),
    creation: Boolean(recipe.create),
    dependencyInstallation: recipe.language === 'HTML' || recipe.dependenciesRequired === false || Boolean(recipe.commands?.install),
    startup: Boolean(recipe.commands?.start),
    httpVerification: recipe.healthCheck?.type === 'http' && Number(recipe.healthCheck.readinessTimeoutMs) > 0,
    stop: true,
    restart: true,
    import: Boolean(recipe.detection),
    environmentRecreation: true,
    databasePolicy: Boolean(recipe.database && Array.isArray(recipe.database.supported) && recipe.database.recommended),
    migrationDetection: Array.isArray(recipe.migrations),
  }
  return { supported: Boolean(recipe.productionEnabled) && REQUIRED_SUPPORT_CHECKS.every(check => checks[check]), checks }
}

function listRecipes({ productionOnly = false, creatableOnly = false } = {}) {
  return RECIPES.filter(recipe => (!productionOnly || recipeSupportReport(recipe).supported) && (!creatableOnly || recipe.create)).map(clone)
}

function allDependencies(manifest) { return { ...(manifest?.dependencies || {}), ...(manifest?.devDependencies || {}) } }

async function matchesDetection(recipe, context) {
  const rule = recipe.detection || {}
  const dependencies = allDependencies(context.packageJson)
  const composerDependencies = context.composerJson?.require || {}
  if (rule.dependencies && !rule.dependencies.every(name => dependencies[name])) return false
  if (rule.dependenciesAny && !rule.dependenciesAny.some(name => dependencies[name])) return false
  if (rule.composerPackages && !rule.composerPackages.every(name => composerDependencies[name])) return false
  if (rule.files && !await Promise.all(rule.files.map(context.exists)).then(items => items.every(Boolean))) return false
  if (rule.filesAny && !await Promise.all(rule.filesAny.map(context.exists)).then(items => items.some(Boolean))) return false
  if (rule.manifest === 'package.json' && !context.packageJson) return false
  if (rule.manifest === 'composer.json' && !context.composerJson) return false
  return Boolean(rule.dependencies || rule.dependenciesAny || rule.composerPackages || rule.files || rule.filesAny || rule.manifest)
}

async function detectRecipe(context) {
  if (context.dotnetProject) return clone(RECIPES.find(recipe => recipe.id === 'dotnet'))
  const declared = context.packageJson?.stacker?.recipe
  if (declared) {
    const composite = COMPOSITE_RECIPES.find(recipe => recipe.id === declared)
    if (composite) return clone(composite)
  }
  // Strong framework markers win over embedded tooling. Modern Laravel and
  // CodeIgniter projects can contain Vite dependencies, for example, but their
  // PHP entrypoint plus Composer package is the authoritative project recipe.
  const generic = new Set(['node', 'php', 'static'])
  const specific = RECIPES.filter(item => !generic.has(item.id)).sort((left, right) => (right.detection?.priority || 0) - (left.detection?.priority || 0))
  for (const recipe of specific) if (await matchesDetection(recipe, context)) return clone(recipe)
  if (await context.exists('index.php') || await context.exists('public/index.php')) return clone(RECIPES.find(recipe => recipe.id === 'php'))
  for (const recipe of RECIPES.filter(item => generic.has(item.id))) if (await matchesDetection(recipe, context)) return clone(recipe)
  return clone(UNKNOWN_RECIPE)
}

function creationRecipeFor(framework, applicationType = 'website', database = null) {
  const base = typeof framework === 'string' ? recipeByName(framework) : framework
  const selectedDatabase = database || databaseRecommendation(base, applicationType)
  if (VITE_FRONTENDS.has(base.id) && (selectedDatabase !== 'none' || ['dashboard', 'api'].includes(applicationType))) return compositeRecipe(base.id, selectedDatabase)
  return base
}

const LOCKFILE_MANAGERS = Object.freeze([
  ['pnpm-lock.yaml', 'pnpm'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
  ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
])

function managerFromPackageManager(value) {
  const match = String(value || '').trim().match(/^(pnpm|npm|yarn|bun)@/)
  return match?.[1] || null
}

async function resolvePackageManager({ packageJson, exists, recipe }) {
  const declared = managerFromPackageManager(packageJson?.packageManager)
  const lockfiles = []
  for (const [file, manager] of LOCKFILE_MANAGERS) if (await exists(file)) lockfiles.push({ file, manager })
  const distinct = [...new Set(lockfiles.map(item => item.manager))]
  return {
    manager: declared || distinct[0] || recipe?.packageManagers?.recommended || (packageJson ? 'npm' : null),
    source: declared ? 'packageManager' : lockfiles.length ? 'lockfile' : 'recipe',
    lockfiles,
    conflict: distinct.length > 1 || Boolean(declared && distinct.some(manager => manager !== declared)),
  }
}

function databaseRecommendation(recipeOrId, applicationType = 'website') {
  const recipe = typeof recipeOrId === 'string' ? recipeById(recipeOrId) : recipeOrId
  const recommendation = recipe?.database?.recommended || { default: 'none' }
  return recommendation[applicationType] || recommendation.default || (DATA_BACKED.has(applicationType) ? 'postgres' : 'none')
}

function interpolate(command, project, port) {
  if (!command) return null
  const replace = value => String(value)
    .replaceAll('{port}', String(port || project.preferredPort))
    .replaceAll('{documentRoot}', project.documentRoot)
    .replaceAll('{projectRoot}', project.path)
  return [replace(command[0]), command[1].map(replace)]
}

function packageRun(manager, script, extra = []) {
  if (manager === 'yarn') return ['yarn', [script, ...extra]]
  if (manager === 'pnpm') return ['pnpm', ['run', script, ...extra]]
  if (manager === 'bun') return ['bun', ['run', script, ...extra]]
  return ['npm', ['run', script, ...(extra.length ? ['--', ...extra] : [])]]
}

function installCommand(manager) {
  if (manager === 'yarn') return ['yarn', ['install']]
  if (manager === 'pnpm') return ['pnpm', ['install']]
  if (manager === 'bun') return ['bun', ['install']]
  return ['npm', ['install']]
}

function packageExec(manager, binary, args = []) {
  if (manager === 'pnpm') return ['pnpm', ['exec', binary, ...args]]
  if (manager === 'yarn') return ['yarn', ['exec', binary, ...args]]
  if (manager === 'bun') return ['bun', ['x', binary, ...args]]
  return ['npm', ['exec', '--', binary, ...args]]
}

function commandForRecipe(project, action, port = project.preferredPort) {
  const recipe = recipeById(project.recipeId || project.framework?.id)
  if (recipe.id === 'dotnet') {
    if (action === 'install') return ['dotnet', ['restore', project.dotnetProject]]
    if (action === 'start') return ['dotnet', ['run', '--no-restore', '--no-launch-profile', '--project', project.dotnetProject, '--urls', `http://127.0.0.1:${port}`]]
    if (action === 'build') return ['dotnet', ['publish', project.dotnetProject, '-c', 'Release']]
    return null
  }
  const scripts = project.packageScripts || {}
  const manager = project.packageManager || recipe.packageManagers.recommended
  if (recipe.language === 'JavaScript' || project.framework?.language === 'JavaScript') {
    if (action === 'install') return installCommand(manager)
    if (action === 'start') {
      const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null
      if (!script) return null
      const scriptCommand = String(scripts[script] || '')
      const usesKnownCli = recipe.id === 'next' ? /(^|\s)next\s+(dev|start)(\s|$)/.test(scriptCommand)
        : ['vite', 'react', 'vue', 'sveltekit'].includes(recipe.id) ? /(^|\s)vite(\s|$)/.test(scriptCommand)
          : recipe.id === 'astro' ? /(^|\s)astro\s+dev(\s|$)/.test(scriptCommand)
            : recipe.id === 'nuxt' ? /(^|\s)(nuxt|nuxi)\s+dev(\s|$)/.test(scriptCommand) : false
      const args = usesKnownCli ? recipe.id === 'next' ? ['--hostname', '127.0.0.1', '--port', String(port)] : ['--host', '127.0.0.1', '--port', String(port)] : []
      return packageRun(manager, script, args)
    }
    for (const actionName of ['build', 'test']) if (action === actionName && scripts[actionName]) return packageRun(manager, actionName)
    if (action === 'migrate') {
      const script = ['migrate', 'db:migrate', 'prisma:migrate'].find(name => scripts[name])
      if (script) return packageRun(manager, script)
      if (project.migrationsDetected?.includes('prisma')) return packageExec(manager, 'prisma', ['migrate', 'dev'])
    }
    if (action === 'migrate-status' && project.migrationsDetected?.includes('prisma')) return packageExec(manager, 'prisma', ['migrate', 'status'])
    if (action === 'seed') {
      const script = ['seed', 'db:seed'].find(name => scripts[name])
      if (script) return packageRun(manager, script)
    }
    return null
  }
  const key = action === 'migrate-status' ? 'migrateStatus' : action
  return interpolate(recipe.commands[key], project, port)
}

function creationCommand(recipeOrName, name, packageManager = null) {
  const recipe = typeof recipeOrName === 'string' ? recipeByName(recipeOrName) : recipeOrName
  const create = recipe?.create
  if (!create) throw new Error('That project type does not have a creator recipe.')
  const manager = packageManager || recipe.packageManagers.recommended
  if (create.tool === 'stacker-static') return ['__stacker_static__', []]
  if (create.tool === 'stacker-php') return ['__stacker_php__', []]
  if (create.tool === 'stacker-wordpress') return ['__stacker_wordpress__', []]
  if (create.tool === 'composer-create-project') return ['composer', ['create-project', create.package, name, ...(recipe.id === 'laravel' ? ['--no-scripts'] : [])]]
  if (create.tool === 'create-next-app') {
    const flag = manager === 'pnpm' ? '--use-pnpm' : manager === 'yarn' ? '--use-yarn' : manager === 'bun' ? '--use-bun' : '--use-npm'
    return ['npx', ['--yes', 'create-next-app@latest', name, flag, '--no-git', '--yes']]
  }
  if (create.tool === 'create-vite') return ['npm', ['create', 'vite@latest', name, '--', '--template', create.template]]
  if (create.tool === 'create-astro') return ['npm', ['create', 'astro@latest', name, '--', '--yes', '--no-git', '--no-install']]
  if (create.tool === 'express-generator') return ['npx', ['--yes', 'express-generator', name, '--no-view']]
  if (create.tool === 'create-nuxt') return ['npm', ['create', 'nuxt@latest', name, '--', '--no-install', '--packageManager', manager, '--template', 'minimal', '--gitInit=false']]
  if (create.tool === 'create-sveltekit') return ['npx', ['--yes', 'sv@latest', 'create', name, '--template', 'minimal', '--types', 'ts', '--no-add-ons', '--no-install']]
  throw new Error(`The ${recipe.name} creator recipe is incomplete.`)
}

function documentRootFor(recipe, root) { return path.resolve(root, recipe.documentRoot || '.') }

module.exports = {
  APPLICATION_TYPES, RECIPES, UNKNOWN_RECIPE, LOCKFILE_MANAGERS,
  COMPOSITE_RECIPES, REQUIRED_SUPPORT_CHECKS, listRecipes, recipeSupportReport, recipeById, recipeByName, creationRecipeFor, detectRecipe, resolvePackageManager,
  managerFromPackageManager, databaseRecommendation, commandForRecipe,
  creationCommand, documentRootFor, installCommand, packageRun, packageExec,
}
