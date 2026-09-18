const PROJECT_STATUSES = Object.freeze({
  UNKNOWN: 'unknown',
  STARTING: 'starting',
  RUNNING: 'running',
  DEGRADED: 'degraded',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
})

const SERVICE_STATUSES = Object.freeze({
  UNKNOWN: 'unknown',
  STARTING: 'starting',
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  STOPPED: 'stopped',
  ERROR: 'error',
})

const ISSUE_STATUSES = Object.freeze({ ACTIVE: 'active', RESOLVED: 'resolved' })

const DISPLAY_STATUS = Object.freeze({
  unknown: 'Unknown',
  starting: 'Starting',
  running: 'Running',
  degraded: 'Degraded',
  stopping: 'Stopping',
  stopped: 'Stopped',
  error: 'Error',
})

function normalizedProcess(state = {}) {
  const rawStatus = String(state.status || '').toLowerCase()
  const running = Boolean(state.running)
  const status = running
    ? SERVICE_STATUSES.HEALTHY
    : rawStatus === 'starting'
      ? SERVICE_STATUSES.STARTING
      : ['failed', 'error'].includes(rawStatus)
        ? SERVICE_STATUSES.ERROR
        : SERVICE_STATUSES.STOPPED
  return {
    running,
    status,
    pid: state.pid || null,
    port: state.port || null,
    apiPort: state.apiPort || null,
    startedAt: state.startedAt || null,
    readyAt: state.readyAt || null,
    adopted: Boolean(state.adopted),
    reason: state.reason || null,
    code: state.code ?? null,
    signal: state.signal || null,
  }
}

function healthServices(health, processState) {
  const checks = new Map((health?.checks || []).map(check => [check.id, check]))
  const serviceStatus = check => !check
    ? SERVICE_STATUSES.UNKNOWN
    : check.status === 'healthy'
      ? SERVICE_STATUSES.HEALTHY
      : check.status === 'idle'
        ? SERVICE_STATUSES.STOPPED
        : check.status === 'warning'
          ? SERVICE_STATUSES.DEGRADED
          : SERVICE_STATUSES.ERROR
  const aggregateStatus = items => {
    const statuses = items.filter(Boolean).map(serviceStatus)
    if (!statuses.length) return SERVICE_STATUSES.UNKNOWN
    if (statuses.includes(SERVICE_STATUSES.ERROR)) return SERVICE_STATUSES.ERROR
    if (statuses.includes(SERVICE_STATUSES.DEGRADED)) return SERVICE_STATUSES.DEGRADED
    if (statuses.includes(SERVICE_STATUSES.STOPPED)) return SERVICE_STATUSES.STOPPED
    return SERVICE_STATUSES.HEALTHY
  }
  return {
    process: { id: 'process', status: processState.status, running: processState.running },
    web: { id: 'web', status: serviceStatus(checks.get('route')), checkId: 'route' },
    api: checks.has('api-route') ? { id: 'api', status: serviceStatus(checks.get('api-route')), checkId: 'api-route' } : null,
    database: checks.has('database-service') || checks.has('database-connectivity')
      ? { id: 'database', status: aggregateStatus([checks.get('database-service'), checks.get('database-connectivity')]), checkId: checks.has('database-service') ? 'database-service' : 'database-connectivity' }
      : null,
  }
}

function deriveProjectStatus({ phase, process, health, activeIssues, expectedRunning }) {
  if (phase === PROJECT_STATUSES.STARTING || phase === PROJECT_STATUSES.STOPPING) return phase
  const processIssue = activeIssues.some(issue => issue.issueType === 'process')
  if (!process.running) return processIssue && expectedRunning ? PROJECT_STATUSES.ERROR : PROJECT_STATUSES.STOPPED
  if (!health) return PROJECT_STATUSES.STARTING
  return activeIssues.length ? PROJECT_STATUSES.DEGRADED : PROJECT_STATUSES.RUNNING
}

class ProjectRuntimeStateService {
  constructor({
    listProjects,
    getProject,
    processManager,
    checkHealth,
    getMigrationSummary = () => null,
    emit = () => {},
    now = () => new Date(),
    pollIntervalMs = 5_000,
  }) {
    this.listProjects = listProjects
    this.getProject = getProject
    this.processManager = processManager
    this.checkHealth = checkHealth
    this.getMigrationSummary = getMigrationSummary
    this.emit = emit
    this.now = now
    this.pollIntervalMs = pollIntervalMs
    this.snapshots = new Map()
    this.requestSequences = new Map()
    this.expectedRunning = new Map()
    this.timer = null
    this.polling = false
  }

  timestamp() { return this.now().toISOString() }

  emptySnapshot(projectId) {
    return {
      projectId,
      sequence: 0,
      status: PROJECT_STATUSES.UNKNOWN,
      displayStatus: DISPLAY_STATUS.unknown,
      phase: null,
      process: normalizedProcess(),
      services: healthServices(null, normalizedProcess()),
      health: null,
      issues: [],
      activeIssues: [],
      activeIssueCount: 0,
      updatedAt: this.timestamp(),
      reason: 'initial',
    }
  }

  get(projectId) { return this.snapshots.get(projectId) || this.emptySnapshot(projectId) }

  ensure(projectId) {
    if (this.snapshots.has(projectId)) return this.snapshots.get(projectId)
    const process = normalizedProcess(this.processManager.state(projectId))
    this.expectedRunning.set(projectId, process.running)
    return this.publish(projectId, {
      status: process.running ? PROJECT_STATUSES.STARTING : PROJECT_STATUSES.STOPPED,
      process,
      services: healthServices(null, process),
    }, 'seed')
  }

  list() { return this.listProjects().map(project => this.get(project.id)) }

  nextRequest(projectId) {
    const sequence = (this.requestSequences.get(projectId) || 0) + 1
    this.requestSequences.set(projectId, sequence)
    return sequence
  }

  publish(projectId, patch, reason) {
    const previous = this.get(projectId)
    const next = {
      ...previous,
      ...patch,
      projectId,
      sequence: previous.sequence + 1,
      updatedAt: this.timestamp(),
      reason,
    }
    next.displayStatus = DISPLAY_STATUS[next.status] || DISPLAY_STATUS.unknown
    next.activeIssues = (next.issues || []).filter(issue => issue.status === ISSUE_STATUSES.ACTIVE)
    next.activeIssueCount = next.activeIssues.length
    if (next.health) {
      const checks = next.health.checks.filter(check => !check.runtimeIssue)
      for (const issue of next.activeIssues.filter(issue => issue.issueType === 'process')) {
        checks.push({ id: issue.id, runtimeIssue: true, label: issue.label, detail: issue.detail, status: 'failed', fix: issue.fix })
      }
      const summary = { total: checks.length, healthy: checks.filter(check => check.status === 'healthy').length, warnings: checks.filter(check => check.status === 'warning').length, failed: checks.filter(check => check.status === 'failed').length }
      next.health = { ...next.health, checks, summary, status: summary.failed ? 'Failed' : summary.warnings ? 'Warning' : 'Healthy' }
    }
    this.snapshots.set(projectId, next)
    this.emit(next)
    return next
  }

  issueIdentity(projectId, checkId, issueType = 'health') {
    return `${projectId}:${checkId}:${issueType}`
  }

  reconcileHealthIssues(projectId, health, previousIssues) {
    const checkedAt = health.checkedAt || this.timestamp()
    const previous = new Map((previousIssues || []).map(issue => [issue.id, issue]))
    const activeIds = new Set()
    for (const check of health.checks || []) {
      if (check.runtimeIssue || !['failed', 'warning'].includes(check.status)) continue
      const id = this.issueIdentity(projectId, check.id)
      activeIds.add(id)
      const existing = previous.get(id)
      previous.set(id, {
        id,
        projectId,
        serviceId: check.id,
        issueType: 'health',
        status: ISSUE_STATUSES.ACTIVE,
        severity: check.status === 'failed' ? 'error' : 'warning',
        label: check.label,
        detail: check.detail,
        fix: check.fix || null,
        firstSeenAt: existing?.firstSeenAt || checkedAt,
        lastSeenAt: checkedAt,
        resolvedAt: null,
      })
    }
    for (const [id, issue] of previous) {
      if (issue.issueType !== 'health' || activeIds.has(id) || issue.status !== ISSUE_STATUSES.ACTIVE) continue
      previous.set(id, { ...issue, status: ISSUE_STATUSES.RESOLVED, resolvedAt: checkedAt })
    }
    return [...previous.values()]
  }

  resolveProcessIssues(projectId, issues) {
    const resolvedAt = this.timestamp()
    return (issues || []).map(issue => issue.issueType === 'process' && issue.status === ISSUE_STATUSES.ACTIVE
      ? { ...issue, status: ISSUE_STATUSES.RESOLVED, resolvedAt }
      : issue)
  }

  beginTransition(projectId, status) {
    if (![PROJECT_STATUSES.STARTING, PROJECT_STATUSES.STOPPING].includes(status)) throw new Error(`Invalid runtime transition: ${status}`)
    this.nextRequest(projectId)
    this.expectedRunning.set(projectId, status === PROJECT_STATUSES.STARTING)
    const previous = this.get(projectId)
    const process = status === PROJECT_STATUSES.STARTING
      ? { ...previous.process, status: SERVICE_STATUSES.STARTING, reason: null }
      : previous.process
    return this.publish(projectId, { phase: status, status, process }, `project-${status}`)
  }

  recordError(projectId, error, serviceId = 'process') {
    this.nextRequest(projectId)
    const previous = this.get(projectId)
    const id = this.issueIdentity(projectId, serviceId, 'process')
    const existing = previous.issues.find(issue => issue.id === id)
    const seenAt = this.timestamp()
    const issue = {
      id,
      projectId,
      serviceId,
      issueType: serviceId === 'health-check' ? 'health' : 'process',
      status: ISSUE_STATUSES.ACTIVE,
      severity: 'error',
      label: serviceId === 'process' ? 'Application process' : serviceId,
      detail: error?.message || String(error || 'The required process stopped unexpectedly.'),
      fix: 'restart',
      firstSeenAt: existing?.firstSeenAt || seenAt,
      lastSeenAt: seenAt,
      resolvedAt: null,
    }
    const issues = [...previous.issues.filter(item => item.id !== id), issue]
    const process = normalizedProcess(this.processManager.state(projectId))
    return this.publish(projectId, { phase: null, status: process.running ? PROJECT_STATUSES.DEGRADED : PROJECT_STATUSES.ERROR, process, services: healthServices(previous.health, process), issues }, 'process-error')
  }

  handleProcessState(event) {
    if (!event?.projectId) return null
    const projectId = event.projectId
    const rawStatus = String(event.status || '').toLowerCase()
    if (rawStatus === 'starting') {
      this.nextRequest(projectId)
      this.expectedRunning.set(projectId, true)
      const previous = this.get(projectId)
      return this.publish(projectId, { phase: PROJECT_STATUSES.STARTING, status: PROJECT_STATUSES.STARTING, process: normalizedProcess(event), issues: this.resolveProcessIssues(projectId, previous.issues) }, 'process-starting')
    }
    if (event.running) {
      this.nextRequest(projectId)
      this.expectedRunning.set(projectId, true)
      const previous = this.get(projectId)
      const process = normalizedProcess(event)
      const issues = this.resolveProcessIssues(projectId, previous.issues)
      const activeIssues = issues.filter(issue => issue.status === ISSUE_STATUSES.ACTIVE)
      const status = previous.health ? deriveProjectStatus({ phase: null, process, health: previous.health, activeIssues, expectedRunning: true }) : PROJECT_STATUSES.STARTING
      const snapshot = this.publish(projectId, { phase: null, status, process, issues }, 'process-running')
      void this.refresh(projectId, { reason: 'process-running' }).catch(() => null)
      return snapshot
    }
    if (event.reason === 'user' || rawStatus === 'stopped') {
      this.expectedRunning.set(projectId, false)
      this.nextRequest(projectId)
      const previous = this.get(projectId)
      return this.publish(projectId, { phase: null, status: PROJECT_STATUSES.STOPPED, process: normalizedProcess(event), issues: this.resolveProcessIssues(projectId, previous.issues) }, 'process-stopped')
    }
    if (['failed', 'error'].includes(rawStatus)) return this.recordError(projectId, new Error('The application process stopped unexpectedly.'))
    return null
  }

  async refresh(projectId, { reason = 'refresh' } = {}) {
    const project = this.getProject(projectId)
    if (!project) return null
    const requestSequence = this.nextRequest(projectId)
    const previous = this.get(projectId)
    const process = normalizedProcess(this.processManager.state(projectId))
    const expectedRunning = this.expectedRunning.get(projectId) ?? process.running
    this.expectedRunning.set(projectId, expectedRunning)
    if ([PROJECT_STATUSES.STARTING, PROJECT_STATUSES.STOPPING].includes(previous.phase)) {
      return this.publish(projectId, { status: previous.phase, process }, reason)
    }
    let health
    try {
      health = await this.checkHealth(project, process, this.getMigrationSummary(projectId))
    } catch (error) {
      if (this.requestSequences.get(projectId) !== requestSequence) return this.get(projectId)
      return this.recordError(projectId, error, 'health-check')
    }
    if (this.requestSequences.get(projectId) !== requestSequence) return this.get(projectId)
    let issues = this.reconcileHealthIssues(projectId, health, previous.issues)
    if (process.running) issues = this.resolveProcessIssues(projectId, issues)
    if (!process.running && expectedRunning && previous.process.running && previous.phase !== PROJECT_STATUSES.STOPPING) {
      const id = this.issueIdentity(projectId, 'process', 'process')
      const existing = issues.find(issue => issue.id === id)
      const seenAt = this.timestamp()
      issues = [...issues.filter(issue => issue.id !== id), {
        id,
        projectId,
        serviceId: 'process',
        issueType: 'process',
        status: ISSUE_STATUSES.ACTIVE,
        severity: 'error',
        label: 'Application process',
        detail: 'The application process stopped unexpectedly.',
        fix: 'restart',
        firstSeenAt: existing?.firstSeenAt || seenAt,
        lastSeenAt: seenAt,
        resolvedAt: null,
      }]
    }
    const activeIssues = issues.filter(issue => issue.status === ISSUE_STATUSES.ACTIVE)
    const phase = previous.phase
    const status = deriveProjectStatus({ phase, process, health, activeIssues, expectedRunning })
    return this.publish(projectId, { status, phase: [PROJECT_STATUSES.STARTING, PROJECT_STATUSES.STOPPING].includes(status) ? phase : null, process, health, services: healthServices(health, process), issues }, reason)
  }

  async reconcileAll(reason = 'reconcile') {
    return Promise.all(this.listProjects().map(project => this.refresh(project.id, { reason })))
  }

  startPolling() {
    if (this.timer || this.pollIntervalMs <= 0) return
    this.timer = setInterval(() => {
      if (this.polling) return
      this.polling = true
      void this.reconcileAll('poll').catch(() => null).finally(() => { this.polling = false })
    }, this.pollIntervalMs)
    this.timer.unref?.()
  }

  stopPolling() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  remove(projectId) {
    this.nextRequest(projectId)
    this.snapshots.delete(projectId)
    this.expectedRunning.delete(projectId)
  }
}

module.exports = {
  ProjectRuntimeStateService,
  PROJECT_STATUSES,
  SERVICE_STATUSES,
  ISSUE_STATUSES,
  DISPLAY_STATUS,
  normalizedProcess,
  deriveProjectStatus,
}
