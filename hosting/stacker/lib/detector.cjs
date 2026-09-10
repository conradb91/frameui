const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { detectRecipe, resolvePackageManager, documentRootFor, commandForRecipe } = require('./project-recipe-engine.cjs')
const { parseEnv, environmentSummary, activeEnvironmentFiles } = require('./environment.cjs')

async function exists(target) {
  try { await fs.access(target); return true } catch { return false }
}

async function json(target) {
  try { return JSON.parse(await fs.readFile(target, 'utf8')) } catch { return null }
}

async function text(target) {
  try { return (await fs.readFile(target, 'utf8')).trim() } catch { return '' }
}

function dependencyVersion(pkg, name) {
  return pkg?.dependencies?.[name] || pkg?.devDependencies?.[name] || pkg?.require?.[name] || pkg?.['require-dev']?.[name] || null
}

function normalizeVersion(value = '') {
  return String(value).replace(/^[^0-9]*/, '').split(/[ <|]/)[0] || null
}

function phpVersionFromId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id < 10000) return null
  return `${Math.floor(id / 10000)}.${Math.floor(id / 100) % 100}.${id % 100}`
}

async function installedComposerMinimum(root) {
  const platformCheck = await text(path.join(root, 'vendor', 'composer', 'platform_check.php'))
  const minimums = [
    ...[...platformCheck.matchAll(/PHP_VERSION_ID\s*<\s*(\d{5,6})/g)].map(match => Number(match[1])),
    ...[...platformCheck.matchAll(/!\s*\(\s*PHP_VERSION_ID\s*>=\s*(\d{5,6})\s*\)/g)].map(match => Number(match[1])),
  ]
  return minimums.length ? phpVersionFromId(Math.max(...minimums)) : null
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project'
}

function repairedLegacyProjectName(project) {
  const folderName = project?.path ? path.basename(project.path) : ''
  if (!folderName) return project?.name
  const legacyTemplateName = (project?.framework?.id === 'codeigniter' && String(project.name).toLowerCase() === 'appstarter')
    || (project?.framework?.id === 'laravel' && String(project.name).toLowerCase() === 'laravel')
  return legacyTemplateName ? folderName : project?.name
}

async function detectProject(projectPath) {
  const root = path.resolve(projectPath)
  const stat = await fs.stat(root)
  if (!stat.isDirectory()) throw new Error('The selected path is not a folder.')

  const pkg = await json(path.join(root, 'package.json'))
  const workspace = pkg ? await require('./workspace-context.cjs').workspaceContext(root) : null
  const clientPkg = await json(path.join(root, 'client', 'package.json'))
  const serverPkg = await json(path.join(root, 'server', 'package.json'))
  const composer = await json(path.join(root, 'composer.json'))
  const has = name => exists(path.join(root, name))
  const projectFiles = (await fs.readdir(root)).filter(file => /\.csproj$/i.test(file))
  let dotnetProject = null, dotnetContents = ''
  for (const file of projectFiles) { const contents = await text(path.join(root, file)); if (/Microsoft\.NET\.Sdk\.(Web|BlazorWebAssembly)/i.test(contents)) { dotnetProject = file; dotnetContents = contents; break } }
  const globalSdk = (await json(path.join(root, 'global.json')))?.sdk?.version
  const dotnetConstraint = globalSdk || dotnetContents.match(/<TargetFrameworks?>net(\d+\.\d+)/)?.[1] || '8.0'
  const recipe = await detectRecipe({ packageJson: pkg, composerJson: composer, exists: has, dotnetProject })
  const versionPackages = { next: 'next', astro: 'astro', nuxt: 'nuxt', sveltekit: '@sveltejs/kit', vue: 'vue', react: 'react', express: 'express', vite: 'vite' }
  const composerVersionPackages = { laravel: 'laravel/framework', codeigniter: 'codeigniter4/framework' }
  const wordpressVersionFile = recipe.id === 'wordpress' ? await text(path.join(root, 'wp-includes', 'version.php')) : ''
  const versionManifest = recipe.composite ? clientPkg : pkg
  const versionSource = recipe.id === 'wordpress'
    ? wordpressVersionFile.match(/\$wp_version\s*=\s*['"]([^'"]+)/)?.[1]
    : recipe.language === 'PHP' ? dependencyVersion(composer, composerVersionPackages[recipe.id]) : dependencyVersion(versionManifest, versionPackages[recipe.composite?.frontend || recipe.id])
  const framework = { id: recipe.id, name: recipe.name, version: normalizeVersion(versionSource), language: recipe.language }
  const signals = recipe.id === 'unknown' ? [] : [`recipe:${recipe.id}`]

  const managerResolution = recipe.language === 'PHP'
    ? { manager: composer ? 'composer' : null, source: composer ? 'manifest' : 'recipe', lockfiles: await has('composer.lock') ? [{ file: 'composer.lock', manager: 'composer' }] : [], conflict: false }
    : await resolvePackageManager({ packageJson: workspace?.packageJson || pkg, exists: workspace?.exists || has, recipe })
  const lockfiles = managerResolution.lockfiles
  const languageLockfiles = framework.language === 'PHP' ? lockfiles.filter(item => item.manager === 'composer') : lockfiles.filter(item => item.manager !== 'composer')
  const packageManager = managerResolution.manager
  const envFiles = []
  for (const file of ['.env.stacker.local', '.env', '.env.local', '.env.development', '.env.development.local', '.env.example', 'client/.env', 'client/.env.local', 'client/.env.example', 'server/.env', 'server/.env.example']) if (await has(file)) envFiles.push(file)
  if (framework.id === 'codeigniter' && await has('env')) envFiles.push('env')
  const environmentEntries = contents => Object.fromEntries(String(contents || '').split(/\r?\n/).map(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/)
    return match ? [match[1], match[2].trim().replace(/^(['"])(.*)\1$/, '$2')] : null
  }).filter(Boolean))
  const templateFile = recipe.composite && envFiles.includes('server/.env.example') ? 'server/.env.example' : envFiles.includes('.env.example') ? '.env.example' : framework.id === 'codeigniter' && envFiles.includes('env') ? 'env' : null
  const activeFile = recipe.composite && envFiles.includes('server/.env') ? 'server/.env' : activeEnvironmentFiles({ envFiles, framework, recipeId: recipe.id })[0] || null
  const templateValues = templateFile ? environmentEntries(await text(path.join(root, templateFile))) : {}
  const activeEnvironmentText = activeFile ? await text(path.join(root, activeFile)) : ''
  const activeVariables = parseEnv(activeEnvironmentText).filter(item => item.type === 'variable')
  const activeValues = Object.fromEntries(activeVariables.map(item => [item.key, item.value]))
  const missingEnvironmentValues = activeFile ? Object.keys(templateValues).filter(key => !String(activeValues[key] || '').trim() && !String(templateValues[key] || '').trim()) : []
  const nodeConstraint = pkg?.engines?.node || await text(path.join(root, '.nvmrc')) || await text(path.join(root, '.node-version'))
  const phpConstraint = composer?.require?.php || null
  const installedPhpMinimum = framework.language === 'PHP' ? await installedComposerMinimum(root) : null
  const requiredPhpExtensions = Object.keys(composer?.require || {}).filter(name => name.startsWith('ext-')).map(name => name.slice(4))
  const documentRoot = recipe.id === 'php' && !await has('index.php') && await has('public/index.php') ? path.join(root, 'public') : recipe.composite ? path.join(root, 'client') : documentRootFor(recipe, root)
  const databaseHints = []
  const environmentText = (await Promise.all(envFiles.map(file => text(path.join(root, file))))).join('\n') + (framework.id === 'codeigniter' ? `\n${await text(path.join(root, 'env'))}` : '')
  const wordpressConfig = framework.id === 'wordpress' ? await text(path.join(root, 'wp-config.php')) : ''
  const packageText = JSON.stringify(pkg || {}) + JSON.stringify(clientPkg || {}) + JSON.stringify(serverPkg || {}) + JSON.stringify(composer || {}) + environmentText + wordpressConfig
  const astroConfig = framework.id === 'astro' ? `${await text(path.join(root, 'astro.config.mjs'))}\n${await text(path.join(root, 'astro.config.ts'))}\n${await text(path.join(root, 'astro.config.js'))}` : ''
  const serverRendering = recipe.composite ? true : framework.id === 'astro' ? /output\s*:\s*['"](?:server|hybrid)['"]/.test(astroConfig) : ['next', 'nuxt', 'sveltekit', 'express', 'node', 'laravel', 'codeigniter', 'php', 'wordpress'].includes(framework.id)
  const nativeToolingRequired = /node-gyp|better-sqlite3|node-canvas|"canvas"|fsevents/i.test(packageText)
  if (recipe.composite?.database === 'postgres' || /postgres|pgsql|pg_/i.test(packageText)) databaseHints.push('PostgreSQL')
  if (recipe.composite?.database === 'mariadb' || /mysql|mariadb/i.test(packageText)) databaseHints.push('MariaDB/MySQL')
  if (framework.id === 'wordpress' && !databaseHints.includes('MariaDB/MySQL')) databaseHints.push('MariaDB/MySQL')
  if (recipe.composite?.database === 'sqlite' || /sqlite/i.test(packageText)) databaseHints.push('SQLite')
  const activeConnectionText = (await Promise.all(activeEnvironmentFiles({ envFiles, framework, recipeId: recipe.id }).map(file => text(path.join(root, file))))).join('\n')
  const urlValue = activeConnectionText.match(/^\s*(?:DATABASE_URL|DB_URL)\s*=\s*["']?([^\s"']+)/mi)?.[1] || null
  const appSettings = framework.id === 'dotnet' ? { ...(await json(path.join(root, 'appsettings.json')))?.ConnectionStrings, ...(await json(path.join(root, 'appsettings.Development.json')))?.ConnectionStrings } : {}
  for (const [key, value] of Object.entries(activeValues)) if (key.startsWith('ConnectionStrings__')) appSettings[key.slice('ConnectionStrings__'.length)] = value
  const dotnetConnections = Object.values(appSettings).join(';')
  const dotnetHost = dotnetConnections.match(/(?:Server|Host|Data Source)\s*=\s*([^;]+)/i)?.[1]?.replace(/^tcp:/i, '').replace(/[,\\].*$/, '').trim()
  const phpDatabaseConfig = framework.language === 'PHP' ? `${await text(path.join(root, 'app/Config/Database.php'))}\n${await text(path.join(root, 'config/database.php'))}` : ''
  const phpConfiguredHost = phpDatabaseConfig.match(/['"](?:hostname|host)['"]\s*=>\s*['"]([^'"]+)['"]/i)?.[1]
  const rawConfiguredHost = dotnetHost || activeConnectionText.match(/^\s*(?:DB_HOST|DATABASE_HOST|database\.default\.hostname)\s*=\s*["']?([^\s"']+)/mi)?.[1]
    || phpConfiguredHost
    || wordpressConfig.match(/define\s*\(\s*['"]DB_HOST['"]\s*,\s*['"]([^'"]+)/i)?.[1]
    || (() => { try { return urlValue ? new URL(urlValue).hostname : null } catch { return null } })()
  const configuredHost = rawConfiguredHost ? rawConfiguredHost.replace(/:\d+$/, '') : null
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '.', '(local)', '(localdb)'])
  const databaseTarget = configuredHost ? { host: configuredHost, classification: localHosts.has(configuredHost) || configuredHost.startsWith('/') ? 'local' : 'remote' } : { host: null, classification: 'unknown' }
  const migrationsDetected = []
  for (const system of recipe.migrations || []) {
    const fileMatch = system.filesAny?.length ? (await Promise.all(system.filesAny.map(has))).some(Boolean) : false
    const directoryMatch = system.directoriesAny?.length ? (await Promise.all(system.directoriesAny.map(has))).some(Boolean) : false
    const scriptMatch = system.commandScripts?.some(script => pkg?.scripts?.[script]) || false
    if (fileMatch || directoryMatch || scriptMatch) migrationsDetected.push(system.id)
  }
  const migrationCommand = migrationsDetected.length ? (() => {
    const command = recipe.migrations.find(item => item.id === migrationsDetected[0])?.command
    if (command) return [command[0], ...command[1]].join(' ')
    const script = recipe.migrations.find(item => item.id === migrationsDetected[0])?.commandScripts?.find(name => pkg?.scripts?.[name])
    return script ? `${packageManager || 'npm'} run ${script}` : null
  })() : null
  const commandProject = { recipeId: recipe.id, framework, packageManager, packageScripts: pkg?.scripts || {}, preferredPort: Number(pkg?.stacker?.applicationPort) || recipe.defaultPort || 3000, apiPort: Number(pkg?.stacker?.apiPort) || null, path: root, documentRoot, dotnetProject }
  const commandDisplay = command => command ? [command[0], ...command[1]].join(' ') : null
  const resolvedCommands = {
    install: commandDisplay(commandForRecipe(commandProject, 'install')),
    start: commandDisplay(commandForRecipe(commandProject, 'start')),
    build: commandDisplay(commandForRecipe(commandProject, 'build')),
    test: commandDisplay(commandForRecipe(commandProject, 'test')),
    migrate: migrationCommand || commandDisplay(commandForRecipe({ ...commandProject, migrationsDetected }, 'migrate')),
  }

  const dependencySignature = crypto.createHash('sha256').update((dotnetProject ? dotnetContents : JSON.stringify(composer || pkg || {})) + (workspace?.fingerprint || '') + (await Promise.all((framework.language === 'PHP' ? ['composer.lock'] : ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']).map(file => text(path.join(root, file))))).join('')).digest('hex')
  const preparedDependencies = await json(path.join(root, '.frameui-dependencies.json'))
  const dependenciesChanged = !!preparedDependencies && preparedDependencies.signature !== dependencySignature
  return {
    dependencySignature,
    dependencyRoot: workspace?.root || root,
    id: crypto.createHash('sha256').update(root).digest('hex').slice(0, 16),
    // Starter manifests identify their upstream package, not the user's
    // project. CodeIgniter's official starter is always named
    // `codeigniter4/appstarter`, for example, so display the selected folder.
    name: path.basename(root),
    path: root,
    framework,
    recipeId: recipe.id,
    recipeVersion: 1,
    signals,
    packageManager,
    packageManagerSource: managerResolution.source,
    packageManagerConflict: managerResolution.conflict,
    lockfiles,
    packageScripts: pkg?.scripts || {},
    commands: resolvedCommands,
    packageType: pkg?.type || 'commonjs',
    dotnetProject,
    runtime: framework.language === 'C#' ? { type: '.NET', constraint: dotnetConstraint } : framework.language === 'PHP'
      ? { type: 'PHP', constraint: phpConstraint || (recipe.runtime?.minimum ? `>=${recipe.runtime.minimum}` : null), minimum: recipe.runtime?.minimum || null, recommended: recipe.runtime?.recommended || null, installedMinimum: installedPhpMinimum, detected: null, requiredExtensions: requiredPhpExtensions }
      : framework.language === 'JavaScript'
        ? { type: 'Node.js', constraint: nodeConstraint || (recipe.runtime?.minimum ? `>=${recipe.runtime.minimum}` : null), minimum: recipe.runtime?.minimum || null, recommended: recipe.runtime?.recommended || null, detected: process.version }
        : null,
    documentRoot,
    envFiles,
    environmentFile: activeFile,
    environmentSummary: environmentSummary(activeVariables),
    missingEnvironmentValues,
    dependenciesInstalled: dependenciesChanged ? false : framework.id === 'dotnet' ? await has('obj/project.assets.json') : framework.id === 'wordpress' ? true : framework.language === 'PHP' ? !composer || await has('vendor') : framework.language === 'JavaScript' ? (Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }).length === 0 && !recipe.composite) || (await has('node_modules') || !!workspace && (await workspace.exists('node_modules') || await workspace.exists('.pnp.cjs'))) : true,
    databaseHints,
    databaseTarget,
    migrationsDetected,
    migrationCommand,
    localDomain: `${slug(path.basename(root))}.localhost`,
    preferredPort: Number(pkg?.stacker?.applicationPort) || recipe.defaultPort || 3000,
    apiPort: Number(pkg?.stacker?.apiPort) || null,
    services: recipe.composite ? [
      { id: 'client', name: 'Frontend', role: `${recipe.composite.frontend} development server` },
      { id: 'api', name: 'Express API', role: recipe.composite.apiPath },
      ...(recipe.composite.database !== 'none' ? [{ id: 'database', name: recipe.composite.databaseName, role: 'Project database' }] : []),
    ] : [],
    healthCheck: recipe.healthCheck,
    expectedFiles: recipe.id === 'php' ? (composer ? ['composer.json'] : []) : recipe.create?.expectedFiles || recipe.expectedFiles || [],
    writableDirectories: recipe.writableDirectories || [],
    databasePolicy: recipe.database,
    serverRendering,
    migrationSystems: recipe.migrations || [],
    warnings: managerResolution.conflict ? [languageLockfiles.length > 1
      ? `Multiple lockfiles conflict: ${languageLockfiles.map(item => item.file).join(', ')}. Select a package manager before setup; Stacker will not create another lockfile.`
      : `packageManager declares ${packageManager}, but ${languageLockfiles[0]?.file || 'the detected lockfile'} belongs to ${languageLockfiles[0]?.manager || 'another manager'}. Confirm which manager Stacker should use.`] : [],
    nativeToolingRequired,
    detectedAt: new Date().toISOString(),
  }
}

module.exports = { detectProject, exists, repairedLegacyProjectName, installedComposerMinimum, phpVersionFromId }
