import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Alternative, DesignState, JourneyConnection, JourneyInteractionTrigger } from '@shared/types/model/featureModel'
import { useProjectStore } from '../../state/projectStore'
import { useJourneyStore } from '../../state/journeyStore'
import { ProvenanceBadge } from './ProvenanceBadge'

const TRIGGERS: JourneyInteractionTrigger[] = ['click', 'hover', 'submit', 'back', 'close', 'open-modal', 'open-drawer', 'change-tab', 'change-state', 'navigate', 'external-link']

export function JourneyInspector({ projectId, featureId: _featureId, journeyId }: { projectId: string; featureId: string; journeyId: string | null }) {
  const journey = useJourneyStore((state) => state.activeJourney)
  const selectedStepId = useJourneyStore((state) => state.selectedStepId)
  const selectedConnectionId = useJourneyStore((state) => state.selectedConnectionId)
  const setSteps = useJourneyStore((state) => state.setSteps)
  const setConnections = useJourneyStore((state) => state.setConnections)
  const model = useProjectStore((state) => state.activeIndex?.projectModel)
  const step = journey?.steps.find((item) => item.id === selectedStepId) ?? null
  const connection = journey?.connections.find((item) => item.id === selectedConnectionId) ?? null
  const [states, setStates] = useState<DesignState[]>([])
  const [alternatives, setAlternatives] = useState<Alternative[]>([])
  const [newMetaKey, setNewMetaKey] = useState('')

  useEffect(() => {
    if (!step) { setStates([]); return }
    void window.frameui.workspace.listDesignStatesForPage(projectId, step.pageRef).then(setStates)
  }, [projectId, step])

  useEffect(() => {
    if (!step?.designStateId) { setAlternatives([]); return }
    void window.frameui.workspace.listAlternativesForState(projectId, step.designStateId).then(setAlternatives)
  }, [projectId, step?.designStateId])

  const pageName = useMemo(() => {
    if (!step) return ''
    if (step.pageRef.kind === 'existing') return model?.pages.find((page) => page.id === step.pageRef.pageId)?.name ?? step.pageRef.pageId
    return step.pageRef.pageId
  }, [model?.pages, step])

  function updateStep(patch: Partial<NonNullable<typeof step>>) {
    if (!journey || !step) return
    setSteps(journey.steps.map((item) => item.id === step.id ? { ...item, ...patch } : item))
  }

  function updateConnection(patch: Partial<JourneyConnection>) {
    if (!journey || !connection) return
    setConnections(journey.connections.map((item) => item.id === connection.id ? { ...item, ...patch } : item))
  }

  if (!journeyId || !journey) return <div className="text-[11.5px] text-text-3">Select a Journey to inspect it.</div>
  if (step) return (
    <div className="flex flex-col gap-3">
      <InspectorHeading>Journey Step</InspectorHeading>
      <Field label="Page"><div className="text-[12px] font-medium text-text">{pageName}</div></Field>
      <Field label="Provenance"><ProvenanceBadge provenance={step.provenance} /></Field>
      <Field label="Viewport"><div className="text-[11.5px] text-text-2">Desktop</div></Field>
      <Field label="State">
        <select value={step.designStateId ?? ''} disabled={step.referenceOnly} onChange={(event) => updateStep({ designStateId: event.target.value || null, alternativeId: null })} className="input-dark">
          <option value="">Page default</option>{states.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}
        </select>
      </Field>
      <Field label="Alternative">
        <select value={step.alternativeId ?? ''} disabled={!step.designStateId || step.referenceOnly} onChange={(event) => updateStep({ alternativeId: event.target.value || null })} className="input-dark">
          <option value="">Current state design</option>{alternatives.map((alternative) => <option key={alternative.id} value={alternative.id}>{alternative.name}</option>)}
        </select>
      </Field>
      <label className="flex items-center justify-between rounded-md border border-border bg-panel-2 px-2.5 py-2 text-[11px] text-text-2"><span>Reference Only</span><input type="checkbox" checked={step.referenceOnly} onChange={(event) => updateStep({ referenceOnly: event.target.checked, provenance: event.target.checked ? 'reference-only' : step.pageRef.kind === 'new' ? 'new' : 'existing' })} /></label>
      <div className="text-[10px] leading-relaxed text-text-3">Double-click the card to open this page/state in Design. Reference-only steps remain read-only.</div>
    </div>
  )

  if (connection) return (
    <div className="flex flex-col gap-3">
      <InspectorHeading>Interaction</InspectorHeading>
      <Field label="Trigger"><select value={connection.trigger} onChange={(event) => updateConnection({ trigger: event.target.value as JourneyInteractionTrigger })} className="input-dark">{TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{labelTrigger(trigger)}</option>)}</select></Field>
      <Field label="Element"><input value={connection.elementLabel ?? ''} onChange={(event) => updateConnection({ elementLabel: event.target.value || null })} placeholder="Save button, close icon…" className="input-dark" /></Field>
      <Field label="Label"><input value={connection.label} onChange={(event) => updateConnection({ label: event.target.value })} placeholder="Continue" className="input-dark" /></Field>
      <Field label="Destination"><div className="truncate font-mono text-[10px] text-text-2">{journey.steps.find((item) => item.id === connection.toStepId)?.pageRef.pageId ?? connection.toStepId}</div></Field>
      <Field label="Transition metadata">
        <div className="flex flex-col gap-1.5">
          {Object.entries(connection.transitionMeta).map(([key, value]) => <div key={key} className="flex gap-1"><input value={key} readOnly className="input-dark min-w-0 flex-1 opacity-70" /><input value={value} onChange={(event) => updateConnection({ transitionMeta: { ...connection.transitionMeta, [key]: event.target.value } })} className="input-dark min-w-0 flex-1" /><button type="button" onClick={() => { const next = { ...connection.transitionMeta }; delete next[key]; updateConnection({ transitionMeta: next }) }} className="text-text-3 hover:text-red-400"><Trash2 size={12} /></button></div>)}
          <div className="flex gap-1"><input value={newMetaKey} onChange={(event) => setNewMetaKey(event.target.value)} placeholder="duration, easing…" className="input-dark min-w-0 flex-1" /><button type="button" onClick={() => { const key = newMetaKey.trim(); if (key && !(key in connection.transitionMeta)) { updateConnection({ transitionMeta: { ...connection.transitionMeta, [key]: '' } }); setNewMetaKey('') } }} className="rounded border border-border px-2 text-text-3"><Plus size={12} /></button></div>
        </div>
      </Field>
      <div className="text-[10px] text-text-3">Delete: select this connection on the canvas and press Backspace.</div>
    </div>
  )

  return <div className="text-[11.5px] text-text-3">Select a Journey step or interaction to edit it.</div>
}

function InspectorHeading({ children }: { children: string }) { return <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">{children}</div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><div className="mb-1 text-[10px] text-text-3">{label}</div>{children}</div> }
function labelTrigger(value: string) { return value.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') }
