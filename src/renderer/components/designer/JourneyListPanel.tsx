import { useEffect, useState } from 'react'
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useJourneyStore } from '../../state/journeyStore'

export function JourneyListPanel({ projectId, featureId, selectedJourneyId, onSelectJourney }: {
  projectId: string
  featureId: string
  selectedJourneyId: string | null
  onSelectJourney: (id: string | null) => void
}) {
  const journeys = useJourneyStore((state) => state.summaries)
  const loading = useJourneyStore((state) => state.loadingSummaries)
  const activeJourney = useJourneyStore((state) => state.activeJourney)
  const loadJourneys = useJourneyStore((state) => state.loadJourneys)
  const createJourney = useJourneyStore((state) => state.createJourney)
  const openJourney = useJourneyStore((state) => state.openJourney)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => { void loadJourneys(projectId, featureId) }, [featureId, loadJourneys, projectId])

  async function select(id: string) {
    onSelectJourney(id)
    await openJourney(projectId, id)
  }

  async function create() {
    const nextName = name.trim()
    if (!nextName) return
    const journey = await createJourney(projectId, featureId, nextName)
    setName('')
    setCreating(false)
    onSelectJourney(journey.id)
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this Journey? Its steps and interactions will be removed.')) return
    await window.frameui.workspace.deleteJourney(projectId, id)
    if (selectedJourneyId === id) {
      useJourneyStore.getState().closeJourney()
      onSelectJourney(null)
    }
    await loadJourneys(projectId, featureId)
  }

  async function finishRename(id: string) {
    const nextName = renameValue.trim()
    if (!nextName) return
    if (activeJourney?.id !== id) await openJourney(projectId, id)
    useJourneyStore.getState().renameJourney(nextName)
    setRenamingId(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center justify-between px-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-3">Journeys</span>
        <button type="button" onClick={() => setCreating(true)} className="rounded p-1 text-text-3 hover:bg-white/5 hover:text-text" title="New Journey"><Plus size={14} /></button>
      </div>
      {creating && (
        <div className="mx-2 mb-2 flex gap-1">
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void create(); if (event.key === 'Escape') setCreating(false) }} placeholder="Journey name" className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent" />
          <button type="button" onClick={() => void create()} className="rounded bg-accent px-2 text-white"><Check size={12} /></button>
          <button type="button" onClick={() => setCreating(false)} className="rounded border border-border px-2 text-text-3"><X size={12} /></button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {loading && <div className="flex justify-center py-5 text-text-3"><Loader2 size={14} className="animate-spin" /></div>}
        {!loading && journeys.length === 0 && <div className="px-2 py-3 text-[11px] text-text-3">No Journeys yet. Create one to connect the Feature's pages and states.</div>}
        {journeys.map((journey) => (
          <div key={journey.id} className={`group mb-1 rounded-md ${selectedJourneyId === journey.id ? 'bg-accent/12' : 'hover:bg-white/[0.04]'}`}>
            {renamingId === journey.id ? (
              <div className="flex gap-1 p-1.5"><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void finishRename(journey.id); if (event.key === 'Escape') setRenamingId(null) }} className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 text-[11px] text-text outline-none" /><button type="button" onClick={() => void finishRename(journey.id)}><Check size={12} /></button></div>
            ) : (
              <div className="flex items-center">
                <button type="button" onClick={() => void select(journey.id)} className="min-w-0 flex-1 px-2 py-2 text-left">
                  <div className="truncate text-[11.5px] font-medium text-text">{journey.name}</div>
                  <div className="text-[9.5px] text-text-3">{journey.steps.length} steps · {journey.connections.length} interactions</div>
                </button>
                <button type="button" onClick={() => { setRenamingId(journey.id); setRenameValue(journey.name) }} className="hidden p-1 text-text-3 group-hover:block"><Pencil size={11} /></button>
                <button type="button" onClick={() => void remove(journey.id)} className="hidden p-1.5 text-text-3 hover:text-red-400 group-hover:block"><Trash2 size={11} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
