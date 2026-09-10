import { expect, test } from 'bun:test'
import { useDesignStore, flushPendingDesignSaves } from '../../renderer/state/designStore'
import type { DesignNode } from '@shared/types/designNode'

test('switching screens flushes the original owner and preserves its last edit', async () => {
  const calls: { owner: string; operations: unknown[] }[] = []
  const trees: Record<string, DesignNode> = {
    a: { id: 'a-text', kind: 'text', content: 'Original A', children: [], editability: 'editable' },
    b: { id: 'b-text', kind: 'text', content: 'Original B', children: [], editability: 'editable' },
  }
  const original = globalThis.window
  Object.assign(globalThis, { window: { frameui: { workspace: {
    getDesignTree: async (_project: string, id: string) => ({ tree: trees[id] }),
    getDesignState: async () => ({ featureId: 'feature', pageRef: { kind: 'existing', pageId: 'page' } }),
    getDesignOperations: async () => [],
    saveDesignOperations: async (_project: string, _feature: string, owner: string, operations: unknown[]) => { calls.push({ owner, operations }) },
  } } } })
  try {
    await useDesignStore.getState().loadDesignState('project', 'a')
    useDesignStore.getState().dispatch({ type: 'SetText', nodeId: 'a-text', content: 'Edited A' })
    await useDesignStore.getState().loadDesignState('project', 'b')
    expect(calls.length).toBe(1)
    expect(calls[0].owner).toBe('a')
    expect(JSON.stringify(calls[0].operations)).toContain('Edited A')
    expect(useDesignStore.getState().tree).toEqual(trees.b)
    await flushPendingDesignSaves()
  } finally { Object.assign(globalThis, { window: original }) }
})
