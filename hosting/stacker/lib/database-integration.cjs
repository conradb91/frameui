const fs = require('fs/promises')
const path = require('path')
const { recipeById } = require('./project-recipe-engine.cjs')

async function exists(target) { return fs.access(target).then(() => true).catch(() => false) }

function addCommand(manager, packages) {
  if (manager === 'pnpm') return ['pnpm', ['add', ...packages]]
  if (manager === 'yarn') return ['yarn', ['add', ...packages]]
  if (manager === 'bun') return ['bun', ['add', ...packages]]
  return ['npm', ['install', '--save', ...packages]]
}

function engineKey(engine) {
  if (engine === 'PostgreSQL' || engine === 'postgres') return 'postgres'
  if (engine === 'MariaDB/MySQL' || engine === 'mariadb' || engine === 'mysql') return 'mariadb'
  if (engine === 'SQLite' || engine === 'sqlite') return 'sqlite'
  return 'none'
}

async function installDatabaseDriver(project, engine, processManager) {
  const recipe = recipeById(project.recipeId || project.framework?.id)
  const key = engineKey(engine)
  const packages = recipe.database?.drivers?.[key]
  if (recipe.language !== 'JavaScript' || !packages?.length) return { installed: [], command: null }
  const manifest = JSON.parse(await fs.readFile(path.join(project.path, 'package.json'), 'utf8'))
  const declared = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) }
  const missing = packages.filter(name => !declared[name])
  if (!missing.length) return { installed: [], command: null }
  const command = addCommand(project.packageManager || recipe.packageManagers.recommended || 'npm', missing)
  const result = await processManager.runCommand(project, 'database-driver', command)
  if (result.task.status !== 'Completed') throw new Error(`The ${recipe.name} database driver could not be installed. See Operations for ${result.task.command}.`)
  return { installed: missing, command: result.task.command }
}

function nextModule(engine) {
  if (engine === 'postgres') return `import 'server-only'\nimport { Pool } from 'pg'\n\nconst connectionString = process.env.DATABASE_URL\nif (!connectionString) throw new Error('DATABASE_URL is not configured')\n\nconst globalForDb = globalThis as unknown as { stackerPg?: Pool }\nexport const db = globalForDb.stackerPg ?? new Pool({ connectionString })\nif (process.env.NODE_ENV !== 'production') globalForDb.stackerPg = db\n`
  if (engine === 'mariadb') return `import 'server-only'\nimport mysql from 'mysql2/promise'\n\nconst uri = process.env.DATABASE_URL\nif (!uri) throw new Error('DATABASE_URL is not configured')\n\nconst globalForDb = globalThis as unknown as { stackerMysql?: mysql.Pool }\nexport const db = globalForDb.stackerMysql ?? mysql.createPool(uri)\nif (process.env.NODE_ENV !== 'production') globalForDb.stackerMysql = db\n`
  return `import 'server-only'\nimport Database from 'better-sqlite3'\n\nconst filename = process.env.DATABASE_URL?.replace(/^file:/, '')\nif (!filename) throw new Error('DATABASE_URL is not configured')\n\nconst globalForDb = globalThis as unknown as { stackerSqlite?: Database.Database }\nexport const db = globalForDb.stackerSqlite ?? new Database(filename)\nif (process.env.NODE_ENV !== 'production') globalForDb.stackerSqlite = db\n`
}

function serverModule(project, engine) {
  const esm = project.packageType === 'module'
  if (engine === 'postgres') return esm
    ? `import { Pool } from 'pg'\nexport const db = new Pool({ connectionString: process.env.DATABASE_URL })\n`
    : `const { Pool } = require('pg')\nmodule.exports = new Pool({ connectionString: process.env.DATABASE_URL })\n`
  if (engine === 'mariadb') return esm
    ? `import mysql from 'mysql2/promise'\nexport const db = mysql.createPool(process.env.DATABASE_URL)\n`
    : `module.exports = require('mysql2/promise').createPool(process.env.DATABASE_URL)\n`
  return esm
    ? `import Database from 'better-sqlite3'\nexport const db = new Database(process.env.DATABASE_URL.replace(/^file:/, ''))\n`
    : `module.exports = require('better-sqlite3')(process.env.DATABASE_URL.replace(/^file:/, ''))\n`
}

function genericPhpModule() {
  return `<?php\ndeclare(strict_types=1);\n\nfunction stacker_database(): PDO\n{\n    $envFile = __DIR__ . '/.env';\n    if (is_file($envFile)) {\n        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {\n            if (str_starts_with(ltrim($line), '#') || !str_contains($line, '=')) continue;\n            [$key, $value] = array_map('trim', explode('=', $line, 2));\n            if (getenv($key) === false) putenv($key . '=' . trim($value, \"\\\"'\"));\n        }\n    }\n    $url = getenv('DATABASE_URL');\n    if (!$url) {\n        throw new RuntimeException('DATABASE_URL is not configured');\n    }\n    if (str_starts_with($url, 'file:')) {\n        return new PDO('sqlite:' . substr($url, 5), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);\n    }\n    $parts = parse_url($url);\n    if (!$parts || empty($parts['scheme']) || empty($parts['host']) || empty($parts['path'])) {\n        throw new RuntimeException('DATABASE_URL is invalid');\n    }\n    $driver = in_array($parts['scheme'], ['postgres', 'postgresql'], true) ? 'pgsql' : 'mysql';\n    $port = isset($parts['port']) ? ';port=' . $parts['port'] : '';\n    $dsn = $driver . ':host=' . $parts['host'] . $port . ';dbname=' . ltrim($parts['path'], '/');\n    return new PDO($dsn, urldecode($parts['user'] ?? ''), urldecode($parts['pass'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);\n}\n`
}

async function moduleTarget(project) {
  if (project.framework?.id === 'next') {
    if (await exists(path.join(project.path, 'src'))) return path.join(project.path, 'src', 'lib', 'db.ts')
    if (await exists(path.join(project.path, 'app'))) return path.join(project.path, 'app', 'lib', 'db.ts')
    return path.join(project.path, 'lib', 'db.ts')
  }
  if (project.framework?.id === 'nuxt') return path.join(project.path, 'server', 'utils', 'db.ts')
  if (project.framework?.id === 'sveltekit') return path.join(project.path, 'src', 'lib', 'server', 'db.ts')
  if (project.framework?.id === 'astro') return path.join(project.path, 'src', 'lib', 'db.ts')
  return path.join(project.path, project.packageType === 'module' ? 'db.js' : 'db.cjs')
}

async function configureFrameworkDatabase(project, engine, processManager) {
  const recipe = recipeById(project.recipeId || project.framework?.id)
  const key = engineKey(engine)
  if (key === 'none') return { configured: false, reason: 'no-database' }
  if (!recipe.database.supported.includes(key)) {
    if (recipe.database.access === 'backend-required') throw new Error(`${recipe.name} is a browser-only recipe. Create or attach a backend service before selecting ${engine}.`)
    throw new Error(`${recipe.name} does not support ${engine} in its project recipe.`)
  }
  if (recipe.composite) {
    const module = path.join(project.path, 'server', 'src', 'db', 'index.js')
    if (!await exists(module)) throw new Error('The generated Express database adapter is missing. Retry project creation to restore the server workspace.')
    return { configured: true, driver: { installed: [], command: null }, module: 'server/src/db/index.js', preserved: true, generatedHttpApi: true }
  }
  if (recipe.id === 'astro' && !project.serverRendering) throw new Error('Astro database access requires an SSR adapter and server output mode. Static Astro projects cannot attach a runtime database.')
  const driver = await installDatabaseDriver(project, key, processManager)
  if (recipe.id === 'php') {
    const target = path.join(project.path, 'db.php')
    if (await exists(target)) return { configured: true, driver, module: 'db.php', preserved: true }
    await fs.writeFile(target, genericPhpModule(), { flag: 'wx' })
    return { configured: true, driver, module: 'db.php', generatedHttpApi: false }
  }
  if (recipe.language !== 'JavaScript' || !['server-only', 'server', 'server-layer', 'server-only-when-ssr'].includes(recipe.database.access)) return { configured: true, driver, module: null }
  const target = await moduleTarget(project)
  if (await exists(target)) return { configured: true, driver, module: path.relative(project.path, target), preserved: true }
  await fs.mkdir(path.dirname(target), { recursive: true })
  const contents = project.framework.id === 'next' ? nextModule(key) : serverModule(project, key)
  await fs.writeFile(target, contents, { flag: 'wx' })
  return { configured: true, driver, module: path.relative(project.path, target), generatedHttpApi: false }
}

module.exports = { configureFrameworkDatabase, installDatabaseDriver, engineKey, addCommand }
