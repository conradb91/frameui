const { readEnvironment, databaseEnvironmentValues, SECRET_PATTERN } = require('./environment.cjs')
const { commandForRecipe, recipeById } = require('./project-recipe-engine.cjs')

function frameworkLines(project) {
  const recipe = recipeById(project.recipeId || project.framework?.id)
  const display = command => command ? [command[0], ...command[1]].join(' ') : null
  const start = display(commandForRecipe(project, 'start', project.preferredPort))
  const migrate = display(commandForRecipe(project, 'migrate', project.preferredPort))
  const root = recipe.documentRoot && recipe.documentRoot !== '.' ? `Public directory: ${recipe.documentRoot}` : null
  return [start && `Start command: ${start}`, migrate && `Migration command: ${migrate}`, root].filter(Boolean)
}

function frameworkDatabaseLines(project, includeSecrets) {
  if (!project.database?.engine) return []
  let values
  try { values = databaseEnvironmentValues(project, project.database) } catch { return [] }
  const entries = Object.entries(values).filter(([, value]) => value != null).map(([key, value]) => `${key}=${SECRET_PATTERN.test(key) && !includeSecrets ? '[REDACTED]' : value}`)
  return entries.length ? ['Framework database variables:', ...entries] : []
}

function databaseLines(project, includeSecrets) {
  const database = project.database
  if (!database?.engine) return [`Database: ${project.databaseHints?.join(', ') || 'None detected'}`]
  const password = includeSecrets ? database.password : database.password ? '[REDACTED]' : 'None'
  const connectionUrl = includeSecrets ? database.url : database.url?.replace(/:\/\/[^@/]+@/, '://[REDACTED]@')
  return [
    `Database engine: ${database.engine}`,
    database.host && `Database host: ${database.host}`,
    database.port && `Database port: ${database.port}`,
    database.database && `Database name: ${database.database}`,
    database.username && `Database username: ${database.username}`,
    database.password && `Database password: ${password}`,
    connectionUrl && `Connection URL: ${connectionUrl}`,
    database.file && `Database file: ${database.file}`,
    ...frameworkDatabaseLines(project, includeSecrets),
  ].filter(Boolean)
}

async function projectCopy(project, kind = 'full', includeSecrets = false) {
  const environment = await readEnvironment(project).catch(() => ({ variables: [] }))
  const app = [
    `Project: ${project.name}`,
    `Framework: ${project.framework.name}${project.framework.version ? ` ${project.framework.version}` : ''}`,
    `Local URL: ${project.localUrl || `http://${project.localDomain}`}`,
    `Project root: ${project.path}`,
    `Document root: ${project.documentRoot}`,
    ...frameworkLines(project),
  ]
  const runtime = [
    `Runtime: ${project.runtime?.type || 'None'}${project.runtime?.constraint ? ` ${project.runtime.constraint}` : ''}`,
    project.runtimeSelection && `${project.runtimeSource === 'system' ? 'System' : 'Managed'} runtime: ${project.runtimeSelection}`,
    `Package manager: ${project.packageManager || 'None'}`,
    `Preferred port: ${project.preferredPort}`,
    project.activePort && `Active port: ${project.activePort}`,
  ].filter(Boolean).join('\n')
  const variables = environment.variables.map(item => `${item.key}=${item.secret && !includeSecrets ? '[REDACTED]' : item.value}`)
  const sections = {
    app,
    runtime: runtime.split('\n'),
    database: databaseLines(project, includeSecrets),
    environment: [environment.file ? `Environment file: ${environment.file}` : 'Environment file: None detected', ...(variables.length ? ['', ...variables] : [])],
  }
  const selected = kind === 'full' || kind === 'diagnostic' ? ['app', 'runtime', 'database', 'environment'] : [kind]
  if (selected.some(section => !sections[section])) throw new Error('Unsupported project copy format.')
  return [`# ${project.name} — ${kind === 'diagnostic' ? 'Safe Diagnostic Summary' : 'Local Development Setup'}`, '', ...selected.flatMap((section, index) => [`## ${section[0].toUpperCase()}${section.slice(1)}`, ...sections[section], ...(index < selected.length - 1 ? [''] : [])])].join('\n')
}

async function projectSetup(project, includeSecrets = false) { return projectCopy(project, 'full', includeSecrets) }

module.exports = { projectSetup, projectCopy, databaseLines, frameworkLines, frameworkDatabaseLines }
