import { matchRoutePattern, extractPathname } from '@core/design-model/matchRoutePattern'
import type { Journey, JourneyConnection, JourneyInteractionTrigger, JourneyStep } from '@shared/types/model/featureModel'
import type { ProjectModel } from '@shared/types/model/projectModel'
import { useJourneyStore } from '../state/journeyStore'
import { useUiStore } from '../state/uiStore'

export type RecordedJourneyEventType = 'navigate' | 'click' | 'submit' | 'back' | 'open-modal' | 'close-modal' | 'open-drawer' | 'close-drawer'
export interface RecordedJourneyEvent { type: RecordedJourneyEventType; url: string; at: number; elementLabel?: string }
export interface JourneyRecordingRequest { projectId: string; featureId: string; journeyId: string | null }

let activeRequest: JourneyRecordingRequest | null = null

export function startJourneyRecording(projectId: string, featureId: string, journeyId: string | null): void {
  activeRequest = { projectId, featureId, journeyId }
  useUiStore.getState().setActiveFeatureId(featureId)
  useUiStore.getState().setView('capture-session')
}

export function getJourneyRecordingRequest(): JourneyRecordingRequest | null { return activeRequest }
export function cancelJourneyRecording(): void { activeRequest = null }

function runtimePageId(url: string): string {
  const slug = extractPathname(url).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root'
  return `page.runtime_${slug}`
}

function triggerFor(event: RecordedJourneyEvent | null): JourneyInteractionTrigger {
  if (!event) return 'navigate'
  if (event.type === 'close-modal' || event.type === 'close-drawer') return 'close'
  return event.type
}

/** Converts privacy-safe runtime events into semantic Journey operations.
 * URLs are matched against the indexed route model; an unmatched runtime
 * URL receives a stable `page.runtime_*` reference so the transition is
 * preserved and can be repaired in the Journey editor later. */
export async function saveRecordedJourney(request: JourneyRecordingRequest, events: RecordedJourneyEvent[], model: ProjectModel): Promise<Journey> {
  const ordered = [...events].sort((a, b) => a.at - b.at)
  let journey = request.journeyId ? await window.frameui.workspace.getJourney(request.projectId, request.journeyId) : null
  if (!journey) journey = await window.frameui.workspace.createJourney(request.projectId, request.featureId, `Recorded Journey ${new Date().toLocaleDateString()}`)

  const steps: JourneyStep[] = [...journey.steps]
  const connections: JourneyConnection[] = [...journey.connections]
  const stepByPage = new Map(steps.map((step) => [step.pageRef.pageId, step]))
  let current: JourneyStep | null = null
  let pendingAction: RecordedJourneyEvent | null = null

  function pageIdFor(url: string): string { return matchRoutePattern(url, model.routes)?.route.pageId ?? runtimePageId(url) }
  function ensureStep(url: string): JourneyStep {
    const pageId = pageIdFor(url)
    const existing = stepByPage.get(pageId)
    if (existing) return existing
    const index = steps.length
    const step: JourneyStep = { id: crypto.randomUUID(), pageRef: { kind: 'existing', pageId }, designStateId: null, alternativeId: null, referenceOnly: false, provenance: 'existing', position: { x: 80 + (index % 4) * 290, y: 80 + Math.floor(index / 4) * 220 } }
    steps.push(step)
    stepByPage.set(pageId, step)
    return step
  }
  function connect(from: JourneyStep, to: JourneyStep, cause: RecordedJourneyEvent | null) {
    connections.push({ id: crypto.randomUUID(), fromStepId: from.id, toStepId: to.id, trigger: triggerFor(cause), elementId: null, elementLabel: cause?.elementLabel ?? null, label: cause?.elementLabel || (cause?.type === 'submit' ? 'Submit' : 'Continue'), transitionMeta: {} })
  }

  for (const event of ordered) {
    if (event.type === 'click' || event.type === 'submit' || event.type === 'back') { pendingAction = event; continue }
    if (event.type === 'open-modal' || event.type === 'close-modal' || event.type === 'open-drawer' || event.type === 'close-drawer') {
      if (current) connect(current, current, event)
      continue
    }
    if (event.type === 'navigate') {
      const next = ensureStep(event.url)
      if (current && (current.id !== next.id || pendingAction)) connect(current, next, pendingAction)
      current = next
      pendingAction = null
    }
  }

  journey = await window.frameui.workspace.saveJourney(request.projectId, { ...journey, steps, connections })
  activeRequest = null
  await useJourneyStore.getState().openJourney(request.projectId, journey.id)
  return journey
}
