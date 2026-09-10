import { expect, test } from 'bun:test'
import { useFlowStore } from '../../renderer/state/flowStore'
import { useJourneyStore } from '../../renderer/state/journeyStore'
import { pendingWorkspaceSaves } from '../../renderer/state/pendingSaves'
import type { Flow } from '@shared/types/flow'
import type { Journey } from '@shared/types/model/featureModel'

test('closing a flow and switching journeys saves their original owners', async () => {
  const original = globalThis.window
  const writes: string[] = []
  Object.assign(globalThis, { window: { frameui: { workspace: {
    saveFlow: async (flow: Flow) => { writes.push(flow.name); return flow },
    saveJourney: async (_project: string, journey: Journey) => { writes.push(journey.name); return journey },
    getJourney: async (_project: string, id: string) => ({ id, name: 'Other journey' }),
  } } } })
  try {
    useFlowStore.setState({ activeFlow: { id: 'flow', projectId: 'project', name: 'Flow', nodes: [], edges: [] } as unknown as Flow })
    useFlowStore.getState().renameFlow('Saved flow')
    useFlowStore.getState().closeFlow()
    await pendingWorkspaceSaves.flush()
    expect(writes).toContain('Saved flow')
    expect(useFlowStore.getState().activeFlow).toBeNull()
    useJourneyStore.setState({ projectId: 'project', activeJourney: { id: 'journey', name: 'Journey' } as Journey })
    useJourneyStore.getState().renameJourney('Saved journey')
    await useJourneyStore.getState().openJourney('project', 'other')
    expect(writes).toContain('Saved journey')
    expect(useJourneyStore.getState().activeJourney?.id).toBe('other')
  } finally { Object.assign(globalThis, { window: original }) }
})
