const VALID_PROJECT_STATES = Object.freeze(['New', 'Detecting', 'Needs Setup', 'Installing', 'Configuring', 'Migrating', 'Starting', 'Running', 'Stopped', 'Warning', 'Failed'])

function assertState(state) {
  if (!VALID_PROJECT_STATES.includes(state)) throw new Error(`Invalid project setup state: ${state}`)
  return state
}

function bounded(value, limit = 200_000) {
  const text = String(value || '')
  return text.length > limit ? `[Earlier output truncated]\n${text.slice(-limit)}` : text
}

function normalizeSetupSteps(steps) {
  return steps.map(step => typeof step === 'string'
    ? { id: step, required: true }
    : { required: true, ...step })
}

function beginSetup(project, mode, steps) {
  const previous = project.setup || {}
  const definitions = normalizeSetupSteps(steps)
  const stepIds = definitions.map(step => step.id)
  const completed = new Set(previous.completedSteps || [])
  const previousRequirements = previous.requirements || {}
  return {
    ...project,
    status: assertState(mode === 'create' ? 'New' : 'Detecting'),
    setup: {
      mode,
      status: 'running',
      startedAt: previous.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentStep: null,
      nextRequiredStep: definitions.find(step => step.required && !completed.has(step.id))?.id || null,
      completedSteps: [...completed].filter(id => stepIds.includes(id)),
      requirements: Object.fromEntries(definitions.map(step => [step.id, {
        id: step.id,
        ...(previousRequirements[step.id] || {}),
        required: Boolean(step.required),
        status: completed.has(step.id) ? 'completed' : 'pending',
      }])),
      steps: Object.fromEntries(stepIds.map(id => [id, previous.steps?.[id] || { id, status: completed.has(id) ? 'completed' : 'pending', startedAt: null, finishedAt: null, durationMs: null, command: null, stdout: '', stderr: '', exitCode: null }])),
    },
  }
}

function startSetupStep(project, id, { state = 'Configuring', command = null } = {}) {
  const now = new Date().toISOString()
  return {
    ...project, status: assertState(state),
    setup: { ...project.setup, status: 'running', currentStep: id, nextRequiredStep: id, updatedAt: now, requirements: { ...(project.setup.requirements || {}), [id]: { ...(project.setup.requirements?.[id] || { id, required: true }), status: 'running' } }, steps: { ...project.setup.steps, [id]: { ...(project.setup.steps[id] || { id }), status: 'running', startedAt: now, finishedAt: null, durationMs: null, command, stdout: '', stderr: '', exitCode: null } } },
  }
}

function finishSetupStep(project, id, result = {}) {
  const now = new Date().toISOString()
  const step = project.setup.steps[id] || { id }
  const startedAt = result.startedAt || step.startedAt
  const completedSteps = [...new Set([...(project.setup.completedSteps || []), id])]
  return {
    ...project,
    setup: { ...project.setup, currentStep: null, updatedAt: now, completedSteps, requirements: { ...(project.setup.requirements || {}), [id]: { ...(project.setup.requirements?.[id] || { id, required: true }), status: 'completed' } }, steps: { ...project.setup.steps, [id]: { ...step, ...result, startedAt: startedAt || now, stdout: bounded(result.stdout), stderr: bounded(result.stderr), status: 'completed', finishedAt: now, durationMs: startedAt ? Date.now() - new Date(startedAt).getTime() : 0, exitCode: result.exitCode ?? 0 } } },
  }
}

function failSetupStep(project, id, error, result = {}) {
  const now = new Date().toISOString()
  const step = project.setup.steps[id] || { id }
  return {
    ...project, status: 'Failed',
    setup: { ...project.setup, status: 'failed', currentStep: id, nextRequiredStep: id, updatedAt: now, failure: { step: id, message: error.message || String(error), code: error.code || null }, requirements: { ...(project.setup.requirements || {}), [id]: { ...(project.setup.requirements?.[id] || { id, required: true }), status: 'failed', message: error.message || String(error) } }, steps: { ...project.setup.steps, [id]: { ...step, ...result, stdout: bounded(result.stdout), status: 'failed', finishedAt: now, durationMs: step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : 0, stderr: bounded(result.stderr || error.message || String(error)), exitCode: result.exitCode ?? error.exitCode ?? null } } },
  }
}

function finishSetup(project, status = 'Stopped') {
  const incomplete = Object.values(project.setup?.requirements || {}).find(requirement => requirement.required && requirement.status !== 'completed')
  const now = new Date().toISOString()
  return { ...project, status: assertState(incomplete ? 'Needs Setup' : status), setup: { ...project.setup, status: incomplete ? 'incomplete' : 'completed', currentStep: null, nextRequiredStep: incomplete?.id || null, completedAt: incomplete ? null : now, updatedAt: now, failure: incomplete ? project.setup?.failure || null : null } }
}

function setupIncompleteStep(project) {
  const requirements = Object.values(project.setup?.requirements || {})
  return requirements.find(requirement => requirement.required && requirement.status !== 'completed')?.id
    || (project.setup?.status && project.setup.status !== 'completed' ? project.setup.currentStep || project.setup.failure?.step || null : null)
}

function nextSetupStep(project, orderedIds) {
  const completed = new Set(project.setup?.completedSteps || [])
  return orderedIds.find(id => !completed.has(id)) || null
}

function reconcileSetupHealth(project, health) {
  if (!project.setup || project.setup.status === 'running') return project
  const checks = new Map((health?.checks || []).map(check => [check.id, check]))
  const groups = { runtime: ['runtime', 'php-extensions'], dependencies: ['dependencies'], environment: ['environment', 'environment-values', 'project-environment-values'], database: ['database-service', 'database-connectivity'] }
  let current = project
  for (const requirement of Object.values(project.setup.requirements || {})) {
    if (requirement.status === 'completed') continue
    const relevant = (groups[requirement.id] || []).map(id => checks.get(id)).filter(Boolean)
    const healthy = requirement.id === 'health'
      ? checks.size > 0 && [...checks.values()].every(check => check.status !== 'failed')
      : relevant.length > 0 && relevant.every(check => check.status === 'healthy')
    if (healthy) current = finishSetupStep(current, requirement.id, { stdout: 'Confirmed by current health checks.' })
  }
  return current === project ? project : finishSetup(current)
}

module.exports = { reconcileSetupHealth, VALID_PROJECT_STATES, beginSetup, startSetupStep, finishSetupStep, failSetupStep, finishSetup, nextSetupStep, setupIncompleteStep, assertState }
