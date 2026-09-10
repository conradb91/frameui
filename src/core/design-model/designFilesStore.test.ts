import { expect, test } from 'bun:test'
import { useDesignFilesStore } from '../../renderer/state/designFilesStore'

test('deleted and archived tabs cannot be restored by closing another tab', () => {
  const original = globalThis.localStorage
  const values = new Map<string, string>()
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
  try {
    const store = useDesignFilesStore.getState()
    store.initialise('tabs-test')
    const first = store.createFile(undefined, 'First')
    const second = store.createFile(undefined, 'Second')
    store.deleteFile(first.id)
    store.closeTab(second.id)
    expect(useDesignFilesStore.getState().activeFileId).toBe('current-application')
    expect(useDesignFilesStore.getState().openFileIds).not.toContain(first.id)
    store.selectFile(second.id)
    store.archiveFile(second.id)
    expect(useDesignFilesStore.getState().openFileIds).not.toContain(second.id)
    store.selectFile(second.id)
    expect(useDesignFilesStore.getState().activeFileId).toBe('current-application')
  } finally { Object.assign(globalThis, { localStorage: original }) }
})
