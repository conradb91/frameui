const { matchesConstraint } = require('./runtime-manager.cjs')
const { compatiblePhpRuntime, KNOWN_MISSING_EXTENSIONS } = require('./php-manager.cjs')
const { environmentTemplateFor, activeEnvironmentFiles } = require('./environment.cjs')
const { recipeById, databaseRecommendation, commandForRecipe } = require('./project-recipe-engine.cjs')

function operation(step) {
  return { startedAt: null, durationMs: null, command: null, stdout: '', stderr: '', exitCode: null, ...step }
}

async function planProjectSetup(project, runtimeManager, phpManager = null) {
  const steps = []
  let blocking = false
  const recipe = recipeById(project.recipeId || project.framework?.id)
  if (project.packageManager === 'bun') {
    blocking = true
    steps.push(operation({ id: 'bun-runtime', label: 'Bun runtime required', status: 'blocked', required: true, detail: 'A Bun lockfile was detected, but this Stacker build does not yet provide a managed Bun runtime. Select npm, pnpm, or Yarn only if the project supports changing package managers.' }))
  }
  if (project.packageManagerConflict && !project.packageManagerConfirmed) {
    blocking = true
    steps.push(operation({ id: 'package-manager', label: 'Choose a package manager', status: 'blocked', required: true, detail: `Conflicting lockfiles were found (${(project.lockfiles || []).map(item => item.file).join(', ')}). Select one manager before Stacker runs any install or start command.` }))
  } else if (project.packageManager) {
    steps.push(operation({ id: 'package-manager', label: 'Package manager', status: 'ready', required: true, detail: `${project.packageManager} selected from ${project.packageManagerSource || 'saved project configuration'}.` }))
  }
  if (project.runtime?.type === '.NET') {
    const ready = runtimeManager.dotnet.cachedPath(project)
    const release = ready ? null : (await runtimeManager.dotnet.catalog(project)).at(0)
    steps.push(operation({ id: 'runtime', label: '.NET SDK', required: true, status: ready ? 'ready' : release ? 'permission' : 'blocked', version: release?.version, detail: ready ? 'Compatible SDK is available.' : release ? 'An isolated SDK will be prepared.' : 'No SDK matches this application.' }))
    if (!ready && !release) blocking = true
  } else if (project.runtime?.type === 'Node.js') {
    const managedPath = await runtimeManager.executablePath(project)
    const inventory = managedPath && runtimeManager.listAll ? await runtimeManager.listAll() : []
    const resolved = inventory.find(item => item.path === managedPath && matchesConstraint(item.version, project.runtime?.constraint)) || (managedPath ? { managed: true, version: project.runtimeSelection || 'compatible' } : null)
    if (resolved) steps.push(operation({ id: 'runtime', label: 'Node.js', status: 'ready', required: true, source: resolved.managed ? 'managed' : 'system', version: resolved.version, requirement: project.runtime?.constraint, systemVersion: resolved.managed ? inventory.find(item => !item.managed)?.version || null : resolved.version, detail: resolved.managed ? `Stacker-managed ${resolved.version} is selected at ${managedPath}.` : `System Node.js ${resolved.version} meets this project's requirement of ${project.runtime?.constraint || 'any version'} and can be used without modification.` }))
    else {
      const catalog = await runtimeManager.catalog().catch(() => [])
      const release = catalog.find(item => matchesConstraint(item.version, project.runtime?.constraint))
      const system = runtimeManager.listAll ? (await runtimeManager.listAll().catch(() => [])).find(item => !item.managed) : null
      if (release) steps.push(operation({ id: 'runtime', label: 'Node.js', status: 'permission', required: true, requirement: project.runtime?.constraint, systemVersion: system?.version || null, recommendedVersion: release.version, detail: system ? `Node.js ${system.version} is installed on your system but does not meet this project's requirement of ${project.runtime?.constraint}. Recommended: ${release.version}.` : `Node.js ${project.runtime?.constraint || ''} is required and no compatible runtime was detected. Recommended: ${release.version}.`, version: release.version, architecture: release.architecture }))
      else { blocking = true; steps.push(operation({ id: 'runtime', label: 'Managed Node.js runtime', status: 'blocked', required: true, detail: `No trusted catalogue release matches ${project.runtime?.constraint || 'the project requirement'}.` })) }
    }
  } else if (project.runtime?.type === 'PHP') {
    const managedPath = phpManager ? await phpManager.executablePath(project) : null
    const inventory = managedPath && phpManager.listAll ? await phpManager.listAll() : []
    const resolved = inventory.find(item => item.type === 'PHP' && item.path === managedPath && compatiblePhpRuntime(item.version, project)) || (managedPath ? { managed: true, version: project.runtimeSelection || 'compatible' } : null)
    const requiredExtensions = project.runtime?.requiredExtensions || []
    const unsupportedExtensions = requiredExtensions.filter(name => KNOWN_MISSING_EXTENSIONS.includes(String(name).toLowerCase()))
    if (resolved) steps.push(operation({ id: 'runtime', label: 'PHP', status: 'ready', required: true, source: resolved.managed ? 'managed' : 'system', version: resolved.version, requirement: project.runtime?.constraint, detail: `${resolved.managed ? 'Stacker-managed' : 'System'} PHP ${resolved.version} meets this project's requirement and is available at ${managedPath}.${unsupportedExtensions.length ? ` Note: ${unsupportedExtensions.join(', ')} is not bundled - check Health after setup.` : ''}` }))
    else {
      const catalog = phpManager ? await phpManager.catalog().catch(() => []) : []
      const release = catalog.find(item => compatiblePhpRuntime(item.version, project))
      if (release) steps.push(operation({ id: 'runtime', label: `Install PHP ${release.version}`, status: 'permission', required: true, detail: `Download and verify the ${release.architecture} static build.${unsupportedExtensions.length ? ` Note: ${unsupportedExtensions.join(', ')} is not bundled in this build.` : ''}`, version: release.version }))
      else { blocking = true; steps.push(operation({ id: 'runtime', label: 'Managed PHP runtime', status: 'blocked', required: true, detail: `No trusted catalogue release matches ${project.runtime?.constraint || 'the project requirement'}.` })) }
    }
  }
  const environmentTemplate = environmentTemplateFor(project)
  if (environmentTemplate && !activeEnvironmentFiles(project).length) steps.push(operation({ id: 'environment', label: 'Create active environment', status: 'recommended', required: true, detail: `Create .env from ${environmentTemplate} without changing the template.` }))
  else steps.push(operation({ id: 'environment', label: 'Environment file', status: project.missingEnvironmentValues?.length ? 'manual' : 'ready', required: Boolean(project.missingEnvironmentValues?.length), detail: project.missingEnvironmentValues?.length ? `${project.missingEnvironmentValues.length} environment value${project.missingEnvironmentValues.length === 1 ? '' : 's'} still need input: ${project.missingEnvironmentValues.join(', ')}. You can continue setup and add these credentials afterward.` : project.envFiles?.length ? `${project.envFiles.join(', ')} detected.` : 'The recipe does not require an environment file.' }))
  if (!project.dependenciesInstalled) steps.push(operation({ id: 'dependencies', label: 'Install dependencies', status: 'recommended', required: true, detail: `Use the detected ${project.packageManager || 'package manager'} without creating a second lockfile and stream output to Operations.`, command: commandForRecipe(project, 'install')?.flat().join(' ') || null }))
  else steps.push(operation({ id: 'dependencies', label: 'Dependencies', status: 'ready', required: true, detail: 'The dependency directory is present.' }))
  const databaseEngines = recipe.id === 'astro' && !project.serverRendering ? [] : recipe.database?.supported?.length
    ? recipe.database.supported.map(engine => engine === 'postgres' ? 'PostgreSQL' : engine === 'mariadb' ? 'MariaDB/MySQL' : 'SQLite')
    : recipe.id === 'unknown' ? (project.databaseHints || []) : []
  if (!project.database?.engine && databaseEngines.length) {
    const recommended = databaseRecommendation(recipe, project.applicationType || 'website')
    const detected = project.databaseHints?.length ? `Detected ${project.databaseHints.join(' or ')} configuration.` : 'No database configuration was detected.'
    const remote = project.databaseTarget?.classification === 'remote'
    const hintToId = { PostgreSQL: 'postgres', 'MariaDB/MySQL': 'mariadb', SQLite: 'sqlite' }
    const detectedIds = [...new Set((project.databaseHints || []).map(hint => hintToId[hint]).filter(Boolean))]
    const detectedEngine = detectedIds.length === 1 ? detectedIds[0] : databaseEngines.length === 1 ? hintToId[databaseEngines[0]] : null
    const required = Boolean(recipe.database?.required || detectedIds.length)
    steps.push(operation({ id: 'database', label: 'Database Setup', status: required ? 'required' : 'optional', required, detail: remote ? `This project uses ${project.databaseHints?.[0] || 'an external database'} at ${project.databaseTarget.host}. Choose which database the local project should connect to. Migrations will not run automatically.` : `${detected} Choose which database the local project should connect to. Migrations will not run automatically.`, engines: detectedEngine ? [databaseEngines.find(name => hintToId[name] === detectedEngine)].filter(Boolean) : databaseEngines, detectedEngine, recommended, remote, host: project.databaseTarget?.host || null }))
  }
  if (project.migrationsDetected?.length) steps.push(operation({ id: 'migrations', label: 'Review migrations', status: 'manual', required: false, detail: `${project.migrationsDetected.length} migration system${project.migrationsDetected.length === 1 ? '' : 's'} detected. Migrations are listed after setup and are never run automatically.`, command: project.migrationCommand || null }))
  steps.push(operation({ id: 'start', label: 'Start application', status: 'automatic', required: false, detail: 'Optionally start the development server as a managed long-running service.', command: commandForRecipe(project, 'start')?.flat().join(' ') || null }))
  steps.push(operation({ id: 'health', label: 'Validate project', status: 'automatic', required: true, detail: 'Validate the required runtime, dependencies, environment, database connection, project files, and local paths.' }))
  const completed = new Set(project.setup?.completedSteps || [])
  const nextStep = steps.find(step => step.required && !completed.has(step.id) && step.status !== 'ready')?.id || null
  const localHostChoiceRequired = Boolean(project.environmentSummary?.localOverrideKeys?.length && !project.environmentMode)
  const requiresSetup = localHostChoiceRequired || steps.some(step => step.required && !completed.has(step.id) && step.status !== 'ready')
  return { recipeId: recipe.id, environmentSummary: project.environmentSummary || null, environmentFile: project.environmentFile || null, blocking, requiresSetup, resumable: Boolean(project.setup && nextStep), nextStep, steps }
}

module.exports = { planProjectSetup }
