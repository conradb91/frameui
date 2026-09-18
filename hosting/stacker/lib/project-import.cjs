// Detection describes files; saved settings describe the user's workspace choices.
function mergeDetectedProject(existing, detected) {
  const merged = { ...existing, ...detected }
  for (const key of ['name', 'database', 'setup', 'localDomain', 'preferredPort', 'apiPort', 'documentRoot', 'runtimeSelection', 'phpConfig', 'migrationFolder']) {
    if (existing?.[key] !== undefined) merged[key] = existing[key]
  }
  if (existing?.packageManagerConfirmed) merged.packageManager = existing.packageManager
  return merged
}

function initialImportSetup(existing, initialPlan, now = new Date().toISOString()) {
  if (existing?.setup) return existing.setup
  return {
    mode: 'import',
    status: initialPlan.requiresSetup ? 'incomplete' : 'completed',
    startedAt: null,
    updatedAt: now,
    completedAt: initialPlan.requiresSetup ? null : now,
    currentStep: null,
    nextRequiredStep: initialPlan.nextStep,
    completedSteps: initialPlan.steps.filter(step => step.status === 'ready').map(step => step.id),
    requirements: Object.fromEntries(initialPlan.steps.map(step => [step.id, { id: step.id, required: Boolean(step.required), status: step.status === 'ready' ? 'completed' : 'pending' }])),
    steps: {},
    failure: null,
  }
}

function importedProjectRecord(existing, detected, initialPlan, now = new Date().toISOString()) {
  return {
    ...mergeDetectedProject(existing, detected),
    name: existing?.name || detected.name,
    database: existing?.database || detected.database,
    runtimeSelection: existing?.runtimeSelection || detected.runtimeSelection,
    phpConfig: existing?.phpConfig || detected.phpConfig,
    packageManagerConfirmed: existing?.packageManagerConfirmed || detected.packageManagerConfirmed,
    status: initialPlan.requiresSetup ? 'Needs Setup' : (existing?.status || 'Stopped'),
    pinned: existing?.pinned || false,
    createdAt: existing?.createdAt || now,
    lastActivity: now,
    setup: initialImportSetup(existing, initialPlan, now),
  }
}

module.exports = { mergeDetectedProject, initialImportSetup, importedProjectRecord }
