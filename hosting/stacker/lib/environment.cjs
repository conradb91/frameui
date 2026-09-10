const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')
const crypto = require('crypto')

const SECRET_PATTERN = /(^APP_KEY$|^DB_URL$|secret|password|token|private|credential|service[_-]?role|api[_-]?key|database_url|dsn|connection[_-]?strings?)/i
const ENV_FILE_PATTERN = /^(?:(?:client|server)\/)?\.env(?:\.[a-zA-Z0-9_-]+)*$/
// CodeIgniter intentionally uses dotted environment keys such as
// database.default.DBDriver, so dots are valid for the structured editor.
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/
const CLIENT_ENV_PATTERN = /^(?:VITE_|NEXT_PUBLIC_|NUXT_PUBLIC_|PUBLIC_)/i
const CLIENT_SAFE_PATTERN = /(?:_URL|_ORIGIN|_HOST|_ANON_KEY|_PUBLISHABLE_KEY)$/i
const EXTERNAL_SERVICE_PATTERN = /(?:SUPABASE|RESEND|STRIPE|PAYFAST|TWILIO|WHATSAPP|SENDGRID|MAILGUN|AUTH0|CLERK|FIREBASE|SENTRY|AWS_|AZURE_|GOOGLE_)/i
const LOCAL_APPLICATION_URL_KEY = /^(?:APP_URL|APPLICATION_URL|SITE_URL|PUBLIC_URL|ORIGIN|(?:INVITE|CUSTOMER_PORTAL|APP|APPLICATION|SITE|PUBLIC|FRONTEND|WEB)_(?:BASE_URL|APP_URL|SITE_URL))$/i
const NON_APPLICATION_URL_PREFIX = /^(?:SUPABASE|DATABASE|DB|REDIS|STRIPE|RESEND|PAYFAST|TWILIO|WHATSAPP|SENTRY|AWS|AZURE|GOOGLE|API)_/i

function isEnvironmentSecret(key) {
  const value = String(key)
  if (CLIENT_ENV_PATTERN.test(value) && CLIENT_SAFE_PATTERN.test(value) && !/(?:SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|TOKEN)/i.test(value)) return false
  return SECRET_PATTERN.test(value)
}

function environmentClassification(key, value = '') {
  const name = String(key)
  if (CLIENT_ENV_PATTERN.test(name) && !isEnvironmentSecret(name)) return 'Client safe'
  if (isEnvironmentSecret(name) && !/^(?:DATABASE_URL|DB_URL)$/i.test(name)) return 'Server secret'
  if (/^(?:DB_|DATABASE_|DATABASE_URL|POST|POSTGRES_|MYSQL_|MARIADB_|REDIS_)/i.test(name)) return 'Connection'
  if (EXTERNAL_SERVICE_PATTERN.test(name) || /^https?:\/\//i.test(String(value))) return 'External service'
  return 'Unknown'
}

function environmentSummary(variables = []) {
  const classifications = { 'Client safe': 0, 'Server secret': 0, Connection: 0, 'External service': 0, Unknown: 0 }
  const services = new Set()
  for (const item of variables) {
    const classification = environmentClassification(item.key, item.value)
    classifications[classification] += 1
    const provider = String(item.key).match(EXTERNAL_SERVICE_PATTERN)?.[0]
    if (provider) services.add(provider.replace(/_$/, '').toUpperCase())
  }
  return { variableCount: variables.length, secretCount: variables.filter(item => isEnvironmentSecret(item.key)).length, classifications, externalServices: [...services].sort(), localOverrideKeys: localApplicationUrlKeys(variables) }
}

function localApplicationUrlKeys(variables = []) {
  return variables.filter(item => {
    if (!LOCAL_APPLICATION_URL_KEY.test(item.key) || NON_APPLICATION_URL_PREFIX.test(item.key)) return false
    try {
      const host = new URL(item.value).hostname
      return host && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.localhost')
    } catch { return false }
  }).map(item => item.key)
}

function environmentTemplateFor(project) {
  if (project.recipeId?.includes('-vite-express-') && (project.envFiles || []).includes('server/.env.example')) return 'server/.env.example'
  if ((project.envFiles || []).includes('.env.example')) return '.env.example'
  if (project.framework?.id === 'codeigniter' && (project.envFiles || []).includes('env')) return 'env'
  return null
}

function activeEnvironmentFiles(project) {
  const template = environmentTemplateFor(project)
  const order = project.recipeId?.includes('-vite-express-') ? ['server/.env', 'server/.env.local'] : ['.env.stacker.local', '.env.development.local', '.env.local', '.env.development', '.env']
  return (project.envFiles || []).filter(file => file !== template && !/\.(example|sample|template)$/.test(file) && file !== 'env').sort((a, b) => (order.indexOf(a) < 0 ? 100 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 100 : order.indexOf(b)))
}

function environmentGroup(key) {
  const value = String(key)
  if (/^(DB_|DATABASE_|DATABASE_URL|POSTGRES_|MYSQL_|MARIADB_|database\.)/i.test(value)) return 'Database'
  if (/^(MAIL_|SMTP_|EMAIL_)/i.test(value)) return 'Mail'
  if (/^(CACHE_|QUEUE_|SESSION_|REDIS_|MEMCACHED_)/i.test(value)) return 'Cache & queues'
  if (/^(APP_|app\.|CI_ENVIRONMENT|NODE_ENV|ENVIRONMENT|DEBUG|LOG_|PORT$|HOST$|URL$)/i.test(value)) return 'Application'
  if (/(API|TOKEN|SECRET|KEY|CLIENT_ID|CLIENT_SECRET|WEBHOOK|SENTRY|STRIPE|AWS_|AZURE_|GOOGLE_)/i.test(value)) return 'APIs & services'
  return 'Other'
}

function requiredEnvironmentKeys(project) {
  const framework = project.framework?.id
  const engine = project.database?.engine
  const configuredDatabase = engine && engine !== 'None detected'
  if (project.recipeId?.includes('-vite-express-') && configuredDatabase) {
    const keys = ['DB_DATABASE']
    if (engine !== 'SQLite') keys.push('DB_HOST', 'DB_PORT', 'DB_USERNAME')
    return keys
  }
  if (framework === 'laravel') {
    const keys = ['APP_KEY']
    if (configuredDatabase) keys.push('DB_CONNECTION', 'DB_DATABASE')
    if (configuredDatabase && engine !== 'SQLite') keys.push('DB_HOST', 'DB_PORT', 'DB_USERNAME')
    return keys
  }
  if (framework === 'codeigniter' && configuredDatabase) {
    const keys = ['database.default.DBDriver', 'database.default.database']
    if (engine !== 'SQLite') keys.push('database.default.hostname', 'database.default.port', 'database.default.username')
    return keys
  }
  return []
}

function missingRequiredEnvironmentValues(project, variables) {
  const values = new Map((variables || []).map(item => [item.key, String(item.value || '').trim()]))
  return requiredEnvironmentKeys(project).filter(key => !values.get(key))
}

function parseEnv(contents) {
  return contents.split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return { type: 'raw', raw: line, index }
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.]*)(\s*=\s*)(.*)$/)
    if (!match) return { type: 'raw', raw: line, index }
    const [, prefix, key, separator, tail] = match
    const quoted = tail.match(/^("(?:\\.|[^"\\])*"|'[^']*')(\s*(?:#.*)?)$/)
    const rawValue = quoted ? quoted[1] : tail.replace(/\s+#.*$/, '').trimEnd()
    const suffix = quoted ? quoted[2] : tail.slice(rawValue.length)
    let value = rawValue
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try { value = JSON.parse(rawValue) } catch { value = rawValue.slice(1, -1) }
    } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) value = rawValue.slice(1, -1)
    return { type: 'variable', key, value, prefix, separator, suffix, secret: isEnvironmentSecret(key), classification: environmentClassification(key, value), group: environmentGroup(key), index, raw: line }
  })
}

async function readEnvironment(project, file = null) {
  const selected = file || activeEnvironmentFiles(project)[0] || environmentTemplateFor(project) || project.envFiles[0]
  if (!selected) return { file: null, variables: [] }
  if (!project.envFiles.includes(selected)) throw new Error('Environment file is outside the detected project configuration.')
  const contents = await fs.readFile(path.join(project.path, selected), 'utf8')
  return { file: selected, variables: parseEnv(contents).filter(item => item.type === 'variable') }
}

async function readEffectiveEnvironment(project) {
  const values = new Map()
  for (const file of [...activeEnvironmentFiles(project)].reverse()) {
    for (const variable of (await readEnvironment(project, file)).variables) values.set(variable.key, variable)
  }
  return { variables: [...values.values()] }
}

function validateVariables(variables) {
  if (!Array.isArray(variables)) throw new Error('Environment variables must be a list.')
  const seen = new Set()
  return variables.map(item => {
    const key = String(item?.key || '').trim()
    const value = String(item?.value ?? '')
    if (!ENV_KEY_PATTERN.test(key)) throw new Error(`“${key || 'Empty key'}” is not a valid environment variable name.`)
    if (seen.has(key)) throw new Error(`The environment variable “${key}” appears more than once.`)
    if (/\r|\n/.test(value)) throw new Error(`“${key}” cannot contain a line break.`)
    seen.add(key)
    return { key, value }
  })
}

function formatValue(value) {
  if (value === '') return ''
  return /[\s#'"\\]/.test(value) ? JSON.stringify(value) : value
}

async function atomicWrite(target, contents) {
  const temporary = `${target}.stacker-${process.pid}-${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, contents, { mode: 0o600 })
    await fs.rename(temporary, target)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => null)
  }
}

function phpString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function replaceWordPressDefine(contents, key, value) {
  const statement = `define( '${key}', '${phpString(value)}' );`
  const pattern = new RegExp(`define\\s*\\(\\s*['"]${key}['"]\\s*,[^;]+;`)
  if (pattern.test(contents)) return contents.replace(pattern, statement)
  const marker = /\/\* That's all, stop editing![^\n]*\*\//
  return marker.test(contents) ? contents.replace(marker, `${statement}\n\n$&`) : `${contents.trimEnd()}\n${statement}\n`
}

async function configureWordPressDatabase(project, connection) {
  if (connection.engine !== 'MariaDB/MySQL') throw new Error('WordPress natively supports MariaDB/MySQL in this Stacker release.')
  const target = path.join(project.path, 'wp-config.php')
  const existing = await fs.readFile(target, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
  const source = existing ?? await fs.readFile(path.join(project.path, 'wp-config-sample.php'), 'utf8')
  let contents = source
  const values = {
    DB_NAME: connection.database,
    DB_USER: connection.username,
    DB_PASSWORD: connection.password,
    DB_HOST: `${connection.host}${connection.port ? `:${connection.port}` : ''}`,
    DB_CHARSET: 'utf8mb4',
    DB_COLLATE: '',
  }
  for (const [key, value] of Object.entries(values)) contents = replaceWordPressDefine(contents, key, value)
  if (!existing) {
    for (const key of ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT']) {
      contents = replaceWordPressDefine(contents, key, crypto.randomBytes(48).toString('base64url'))
    }
  }
  if (existing && existing !== contents) await fs.writeFile(`${target}.stacker-backup`, existing, { mode: 0o600 })
  if (existing !== contents) await atomicWrite(target, contents)
  return { environment: { file: 'wp-config.php', variables: [] }, envFiles: project.envFiles || [], updatedKeys: Object.keys(values), changed: existing !== contents }
}

async function saveEnvironment(project, file, variables) {
  if (!project.envFiles.includes(file) || !ENV_FILE_PATTERN.test(file)) throw new Error('Invalid environment file.')
  const target = path.join(project.path, file)
  const previous = await fs.readFile(target, 'utf8')
  await fs.writeFile(`${target}.stacker-backup`, previous, { mode: 0o600 })
  const validated = validateVariables(variables)
  const byKey = new Map(validated.map(item => [item.key, item.value]))
  const written = new Set()
  const lines = parseEnv(previous).flatMap(item => {
    if (item.type !== 'variable') return [item.raw]
    if (!byKey.has(item.key)) return []
    if (written.has(item.key)) return []
    written.add(item.key)
    if (item.value === byKey.get(item.key)) return [item.raw]
    return [`${item.prefix}${item.key}${item.separator}${formatValue(byKey.get(item.key))}${item.suffix}`]
  })
  for (const item of validated) if (!written.has(item.key)) lines.push(`${item.key}=${formatValue(item.value)}`)
  await atomicWrite(target, lines.join(previous.includes('\r\n') ? '\r\n' : '\n'))
  return readEnvironment(project, file)
}

async function restoreEnvironment(project, file) {
  if (!project.envFiles.includes(file) || !ENV_FILE_PATTERN.test(file)) throw new Error('Invalid environment file.')
  const target = path.join(project.path, file)
  const backup = `${target}.stacker-backup`
  const [current, previous] = await Promise.all([fs.readFile(target, 'utf8'), fs.readFile(backup, 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw new Error('No previous environment edit is available to restore.')
    throw error
  })])
  await atomicWrite(target, previous)
  await atomicWrite(backup, current)
  return readEnvironment(project, file)
}

async function createEnvironmentFromExample(project, targetFile = '.env') {
  const template = environmentTemplateFor(project)
  if (!template) throw new Error('No environment template was detected.')
  if (!ENV_FILE_PATTERN.test(targetFile)) throw new Error('Invalid active environment filename.')
  if (targetFile === '.env' && activeEnvironmentFiles(project).length) throw new Error('An active environment file already exists.')
  const source = path.join(project.path, template)
  const target = path.join(project.path, targetFile)
  const contents = await fs.readFile(source, 'utf8')
  const handle = await fs.open(target, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error(`A ${targetFile} file already exists.`)
    throw error
  })
  try { await handle.writeFile(contents) } finally { await handle.close() }
  return { file: targetFile, variables: parseEnv(contents).filter(item => item.type === 'variable') }
}

function databaseEnvironmentValues(project, connection) {
  const engine = connection.engine
  const isSqlite = engine === 'SQLite'
  const isPostgres = engine === 'PostgreSQL'
  if (project.recipeId?.includes('-vite-express-')) {
    if (isSqlite) return {
      DB_DATABASE: path.resolve(connection.file),
      DATABASE_URL: `file:${path.resolve(connection.file)}`,
    }
    return {
      DB_HOST: connection.host,
      DB_PORT: String(connection.port),
      DB_DATABASE: connection.database,
      DB_USERNAME: connection.username,
      DB_PASSWORD: connection.password,
      DATABASE_URL: connection.url,
    }
  }
  if (project.framework?.id === 'codeigniter') {
    return isSqlite ? {
      'database.default.DBDriver': 'SQLite3',
      'database.default.database': path.resolve(connection.file),
    } : {
      'database.default.hostname': connection.host,
      'database.default.port': String(connection.port),
      'database.default.database': connection.database,
      'database.default.username': connection.username,
      'database.default.password': connection.password,
      'database.default.DBDriver': isPostgres ? 'Postgre' : 'MySQLi',
    }
  }
  if (project.framework?.id === 'laravel') {
    return isSqlite ? { DB_CONNECTION: 'sqlite', DB_DATABASE: path.resolve(connection.file) } : {
      DB_CONNECTION: isPostgres ? 'pgsql' : 'mysql',
      DB_HOST: connection.host,
      DB_PORT: String(connection.port),
      DB_DATABASE: connection.database,
      DB_USERNAME: connection.username,
      DB_PASSWORD: connection.password,
    }
  }
  if (isSqlite && ['next', 'nuxt', 'astro', 'express', 'node'].includes(project.framework?.id)) return { DATABASE_URL: `file:${path.resolve(connection.file)}` }
  if (isSqlite) return { DB_CONNECTION: 'sqlite', DB_DATABASE: path.resolve(connection.file) }
  return { DATABASE_URL: connection.url }
}

function localUrlEnvironmentValues(project, proxyPort = 4180, variables = []) {
  if (!project?.localDomain) return {}
  const url = `http://${project.localDomain}:${proxyPort}`
  const detected = Object.fromEntries(localApplicationUrlKeys(variables).map(key => [key, url]))
  if (project.framework?.id === 'codeigniter') return {
    ...detected,
    'app.baseURL': `${url}/`,
    'app.forceGlobalSecureRequests': 'false',
    'cookie.domain': '',
    'cookie.secure': 'false',
  }
  if (project.framework?.id === 'laravel') return { ...detected, APP_URL: url, SESSION_DOMAIN: project.localDomain, SESSION_SECURE_COOKIE: 'false' }
  if (project.recipeId?.includes('-vite-express-')) return { ...detected, VITE_API_URL: '/api' }
  return detected
}

async function configureLocalUrlEnvironment(project, proxyPort = 4180) {
  const sourceFile = activeEnvironmentFiles(project)[0]
  const source = sourceFile ? await readEnvironment(project, sourceFile) : { variables: [] }
  const updates = localUrlEnvironmentValues(project, proxyPort, source.variables)
  const file = '.env.stacker.local'
  if (!Object.keys(updates).length) return { changed: false, file: null, updatedKeys: [] }
  const target = path.join(project.path, file)
  const previous = await fs.readFile(target, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
  const environment = { file, variables: parseEnv(previous).filter(item => item.type === 'variable') }
  const existing = new Map(environment.variables.map(item => [item.key, item]))
  if (project.framework?.id === 'laravel') {
    const base = await fs.readFile(path.join(project.path, '.env'), 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
    const baseKey = parseEnv(base).find(item => item.type === 'variable' && item.key === 'APP_KEY')?.value
    const key = existing.get('APP_KEY')?.value || source.variables.find(item => item.key === 'APP_KEY')?.value || baseKey
    if (!key) updates.APP_KEY = `base64:${crypto.randomBytes(32).toString('base64')}`
  }
  const changed = Object.entries(updates).some(([key, value]) => String(existing.get(key)?.value ?? '') !== value)
  for (const [key, value] of Object.entries(updates)) existing.set(key, { key, value, secret: isEnvironmentSecret(key), group: environmentGroup(key) })
  const saved = changed ? { file, variables: [...existing.values()] } : environment
  if (changed) await atomicWrite(target, `${saved.variables.map(item => `${item.key}=${formatValue(item.value)}`).join('\n')}\n`)
  return { environment: saved, changed, file, updatedKeys: Object.keys(updates) }
}

function stackerLocalEnvironment(project) {
  if (!project?.path || project.environmentMode === 'existing') return {}
  try {
    const contents = fssync.readFileSync(path.join(project.path, '.env.stacker.local'), 'utf8')
    return Object.fromEntries(parseEnv(contents).filter(item => item.type === 'variable').map(item => [item.key, item.value]))
  } catch { return {} }
}

async function configureDatabaseEnvironment(project, connection) {
  if (project.framework?.id === 'wordpress') return configureWordPressDatabase(project, connection)
  let envFiles = [...(project.envFiles || [])]
  const activeFiles = activeEnvironmentFiles(project)
  let targetFile = activeFiles.includes(project.environmentFile) ? project.environmentFile : activeFiles[0]
  // Prefer the existing file containing database settings over an unrelated env file.
  for (const file of activeFiles) {
    const source = await readEnvironment(project, file)
    if (source.variables.some(item => environmentGroup(item.key) === 'Database' || item.key === 'DB_URL')) { targetFile = file; break }
  }
  targetFile ||= project.recipeId?.includes('-vite-express-') ? 'server/.env' : project.framework?.id === 'next' ? '.env.local' : '.env'
  const target = path.join(project.path, targetFile)
  const targetExists = await fs.access(target).then(() => true).catch(() => false)
  if (!targetExists) {
    if (environmentTemplateFor(project)) await createEnvironmentFromExample(project, targetFile)
    else {
      const handle = await fs.open(target, 'wx', 0o600)
      await handle.close()
    }
  }
  if (!envFiles.includes(targetFile)) envFiles.unshift(targetFile)
  const envProject = { ...project, envFiles }
  const environment = await readEnvironment(envProject, targetFile)
  let updates = databaseEnvironmentValues(project, connection)
  if (!['laravel', 'codeigniter'].includes(project.framework?.id) && !project.recipeId?.includes('-vite-express-') && connection.engine !== 'SQLite') {
    const keys = new Set(environment.variables.map(item => item.key))
    const aliases = { DB_HOST: connection.host, DB_PORT: String(connection.port), DB_DATABASE: connection.database, DB_NAME: connection.database, DB_USERNAME: connection.username, DB_USER: connection.username, DB_PASSWORD: connection.password, DATABASE_URL: connection.url, DB_URL: connection.url, DATABASE_HOST: connection.host, DATABASE_PORT: String(connection.port), DATABASE_NAME: connection.database, DATABASE_USER: connection.username, DATABASE_PASSWORD: connection.password }
    const detected = Object.fromEntries(Object.entries(aliases).filter(([key]) => keys.has(key)))
    if (Object.keys(detected).length) updates = detected
  }
  const existing = new Map(environment.variables.map(item => [item.key, item]))
  const changed = Object.entries(updates).some(([key, value]) => String(existing.get(key)?.value ?? '') !== String(value ?? ''))
  for (const [key, value] of Object.entries(updates)) existing.set(key, { key, value: String(value ?? ''), secret: isEnvironmentSecret(key), group: environmentGroup(key) })
  const saved = changed ? await saveEnvironment(envProject, targetFile, [...existing.values()]) : environment
  return { environment: saved, envFiles, updatedKeys: Object.keys(updates), changed }
}

async function existingDatabaseConnection(project) {
  const variables = new Map()
  for (const file of [...activeEnvironmentFiles(project)].reverse()) {
    const env = await readEnvironment(project, file)
    for (const item of env.variables) variables.set(item.key, item.value)
  }
  const pick = (...keys) => keys.map(key => variables.get(key)).find(value => value !== undefined)
  const rawUrl = pick('DATABASE_URL', 'DB_URL')
  if (rawUrl) {
    let url
    try { url = new URL(rawUrl) } catch { throw new Error('The existing database URL is invalid. Review its environment value.') }
    if (['postgres:', 'postgresql:', 'mysql:', 'mariadb:'].includes(url.protocol)) {
      return { engine: /^postgres/.test(url.protocol) ? 'PostgreSQL' : 'MariaDB/MySQL', host: url.hostname, port: Number(url.port) || (/^postgres/.test(url.protocol) ? 5432 : 3306), database: decodeURIComponent(url.pathname.slice(1)), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), url: rawUrl }
    }
  }
  const driver = pick('database.default.DBDriver', 'DB_CONNECTION') || project.databaseHints?.[0] || ''
  const postgres = /postgres|pgsql/i.test(driver)
  const host = pick('database.default.hostname', 'DB_HOST', 'DATABASE_HOST')
  if (!host) return null
  return { engine: postgres ? 'PostgreSQL' : 'MariaDB/MySQL', host, port: Number(pick('database.default.port', 'DB_PORT', 'DATABASE_PORT')) || (postgres ? 5432 : 3306), database: pick('database.default.database', 'DB_DATABASE', 'DB_NAME', 'DATABASE_NAME'), username: pick('database.default.username', 'DB_USERNAME', 'DB_USER', 'DATABASE_USER'), password: pick('database.default.password', 'DB_PASSWORD', 'DATABASE_PASSWORD') || '' }
}

async function environmentBlock(project, file, kind = 'all', includeSecrets = false) {
  const environment = await readEnvironment(project, file)
  const filters = {
    all: () => true,
    database: item => /^(DB_|DATABASE_|DATABASE_URL|POSTGRES_|MYSQL_|MARIADB_|database\.)/i.test(item.key),
    api: item => /(API|APP_URL|app\.baseURL|BASE_URL|PUBLIC_URL)/i.test(item.key),
  }
  if (!filters[kind]) throw new Error('Unsupported environment copy format.')
  return environment.variables.filter(filters[kind]).map(item => `${item.key}=${item.secret && !includeSecrets ? '[REDACTED]' : formatValue(item.value)}`).join('\n')
}

module.exports = {
  existingDatabaseConnection, readEnvironment, readEffectiveEnvironment, saveEnvironment, restoreEnvironment, createEnvironmentFromExample,
  configureDatabaseEnvironment, databaseEnvironmentValues, configureLocalUrlEnvironment, localUrlEnvironmentValues, stackerLocalEnvironment, environmentBlock, environmentGroup, environmentClassification, environmentSummary, localApplicationUrlKeys, isEnvironmentSecret, requiredEnvironmentKeys, missingRequiredEnvironmentValues, environmentTemplateFor, activeEnvironmentFiles, parseEnv, validateVariables, SECRET_PATTERN, ENV_FILE_PATTERN, ENV_KEY_PATTERN,
}
