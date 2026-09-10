import { expect, test } from 'bun:test'
import { useProjectStore } from '../../renderer/state/projectStore'
import type { RecentProject } from '@shared/types/project'
import type { ProjectIndex } from '@shared/types/projectIndex'

test('late indexing replies and file notices cannot replace another project', async () => {
  const original = globalThis.window
  let resolve!: (index: ProjectIndex) => void
  const response = new Promise<ProjectIndex>((done) => { resolve = done })
  Object.assign(globalThis, { window: { frameui: { project: { getIndex: () => response } } } })
  try {
    useProjectStore.getState().setActiveProject({ id: 'a' } as RecentProject)
    const pending = useProjectStore.getState().fetchIndex()
    useProjectStore.getState().setActiveProject({ id: 'b' } as RecentProject)
    resolve({ projectId: 'a' } as ProjectIndex)
    await pending
    await useProjectStore.getState().handleFileChange({ projectId: 'a', changedPaths: [], status: 'up-to-date' })
    expect(useProjectStore.getState().activeIndex).toBeNull()
    expect(useProjectStore.getState().sourceStatus).toBe('idle')
    expect(useProjectStore.getState().indexing).toBe(false)
  } finally { Object.assign(globalThis, { window: original }) }
})

test('duplicate opening requests share indexing and failures remain visible for retry', async () => {
  const original = globalThis.window
  let reject!: (error: Error) => void
  let calls = 0
  const response = new Promise<ProjectIndex>((_, fail) => { reject = fail })
  Object.assign(globalThis, { window: { frameui: { project: { getIndex: () => { calls++; return response } } } } })
  try {
    useProjectStore.getState().setActiveProject({ id: 'a' } as RecentProject)
    const first = useProjectStore.getState().fetchIndex()
    await useProjectStore.getState().fetchIndex()
    expect(calls).toBe(1)
    reject(new Error('Cannot read project'))
    await first
    expect(useProjectStore.getState().indexError).toBe('Cannot read project')
    expect(useProjectStore.getState().indexing).toBe(false)
    window.frameui.project.getIndex = async () => ({ projectId: 'a' } as ProjectIndex)
    await useProjectStore.getState().fetchIndex()
    expect(useProjectStore.getState().indexError).toBeNull()
    expect(useProjectStore.getState().activeIndex?.projectId).toBe('a')
  } finally { Object.assign(globalThis, { window: original }) }
})
