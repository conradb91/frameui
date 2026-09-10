import { flushPendingDesignSaves } from './designStore'
import { create } from 'zustand'

export interface DesignFolder {
  id: string
  name: string
  order: number
}

export interface DesignFile {
  id: string
  name: string
  folderId: string
  kind: 'source' | 'design'
  flowPageIds?: string[]
  starred: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

interface PersistedDesignFiles {
  folders: DesignFolder[]
  files: DesignFile[]
  activeFileId: string
  openFileIds: string[]
}

interface DesignFilesState extends PersistedDesignFiles {
  projectId: string | null
  initialise: (projectId: string) => void
  closeTab: (fileId: string) => void
  selectFile: (fileId: string) => void
  createFile: (folderId?: string, name?: string, flowPageIds?: string[]) => DesignFile
  createFolder: (name?: string) => DesignFolder
  renameFile: (fileId: string, name: string) => void
  renameFolder: (folderId: string, name: string) => void
  duplicateFile: (fileId: string) => Promise<void>
  moveFile: (fileId: string, folderId: string) => void
  toggleStar: (fileId: string) => void
  archiveFile: (fileId: string) => void
  deleteFile: (fileId: string) => void
}

const CURRENT_APPLICATION_ID = 'current-application'

function storageKey(projectId: string) {
  return `frameui:design-files:${projectId}:v1`
}

function initialState(): PersistedDesignFiles {
  const now = new Date().toISOString()
  return {
    folders: [
      { id: 'product', name: 'Product', order: 0 },
      { id: 'features', name: 'Features', order: 1 },
      { id: 'concepts', name: 'Concepts', order: 2 },
    ],
    files: [{
      id: CURRENT_APPLICATION_ID,
      name: 'Current Application',
      folderId: 'product',
      kind: 'source',
      starred: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }],
    activeFileId: CURRENT_APPLICATION_ID,
    openFileIds: [CURRENT_APPLICATION_ID],
  }
}

function read(projectId: string): PersistedDesignFiles {
  try {
    const saved = localStorage.getItem(storageKey(projectId))
    if (!saved) return initialState()
    const parsed = JSON.parse(saved) as PersistedDesignFiles
    if (!parsed.files.some((file) => file.id === CURRENT_APPLICATION_ID)) {
      const source = initialState().files[0]
      parsed.files.unshift(source)
    }
    if (!Array.isArray(parsed.folders)) return initialState()
    const available = new Set(parsed.files.filter((file) => !file.archived).map((file) => file.id))
    parsed.openFileIds = [...new Set((Array.isArray(parsed.openFileIds) ? parsed.openFileIds : [parsed.activeFileId]).filter((id) => available.has(id)))]
    if (!parsed.openFileIds.length) parsed.openFileIds = [CURRENT_APPLICATION_ID]
    if (!available.has(parsed.activeFileId)) parsed.activeFileId = parsed.openFileIds.at(-1)!
    if (!parsed.openFileIds.includes(parsed.activeFileId)) parsed.openFileIds.push(parsed.activeFileId)
    return parsed
  } catch {
    return initialState()
  }
}

function persist(state: DesignFilesState) {
  if (!state.projectId) return
  localStorage.setItem(storageKey(state.projectId), JSON.stringify({
    folders: state.folders,
    files: state.files,
    activeFileId: state.activeFileId,
    openFileIds: state.openFileIds,
  } satisfies PersistedDesignFiles))
}

export const useDesignFilesStore = create<DesignFilesState>((set, get) => ({
  projectId: null,
  ...initialState(),
  initialise: (projectId) => {
    if (get().projectId === projectId) return
    set({ projectId, ...read(projectId) })
  },
  closeTab: (fileId) => {
    const remaining = get().openFileIds.filter((id) => id !== fileId)
    if (!remaining.length) remaining.push(CURRENT_APPLICATION_ID)
    set({ openFileIds: remaining, activeFileId: get().activeFileId === fileId ? remaining.at(-1) ?? CURRENT_APPLICATION_ID : get().activeFileId })
    persist(get())
  },
  selectFile: (activeFileId) => {
    if (!get().files.some((file) => file.id === activeFileId && !file.archived)) return
    set((state) => ({ activeFileId, openFileIds: [...new Set([...state.openFileIds, activeFileId])], files: state.files.map((file) => file.id === activeFileId ? { ...file, updatedAt: new Date().toISOString() } : file) }))
    persist(get())
  },
  createFile: (folderId, name = 'Untitled', flowPageIds) => {
    const state = get()
    const now = new Date().toISOString()
    const file: DesignFile = {
      id: crypto.randomUUID(), name, folderId: folderId ?? state.folders[0]?.id ?? 'product',
      kind: 'design', flowPageIds, starred: false, archived: false, createdAt: now, updatedAt: now,
    }
    set({ files: [...state.files, file], activeFileId: file.id, openFileIds: [...state.openFileIds, file.id] })
    persist(get())
    return file
  },
  createFolder: (name = 'New folder') => {
    const state = get()
    const folder = { id: crypto.randomUUID(), name, order: state.folders.length }
    set({ folders: [...state.folders, folder] })
    persist(get())
    return folder
  },
  renameFile: (fileId, name) => {
    if (!name.trim()) return
    set((state) => ({ files: state.files.map((file) => file.id === fileId ? { ...file, name: name.trim(), updatedAt: new Date().toISOString() } : file) }))
    persist(get())
  },
  renameFolder: (folderId, name) => {
    if (!name.trim()) return
    set((state) => ({ folders: state.folders.map((folder) => folder.id === folderId ? { ...folder, name: name.trim() } : folder) }))
    persist(get())
  },
  duplicateFile: async (fileId) => {
    const original = get().files.find((file) => file.id === fileId)
    const projectId = get().projectId
    if (!original || !projectId) return
    try {
      await flushPendingDesignSaves()
      const saved = localStorage.getItem(`frameui:visual-canvas:${projectId}:${fileId}:v2`)
      const frames = JSON.parse(saved ?? '[]') as { id: string; designStateId?: string; flowNextId?: string; [key: string]: unknown }[]
      const ids = new Map(frames.map((frame) => [frame.id, crypto.randomUUID()]))
      const copies = await Promise.all(frames.map(async (frame) => {
        const state = frame.designStateId ? await window.frameui.workspace.duplicateDesignState(projectId, frame.designStateId, `${original.name} copy`, 'design') : null
        return { ...frame, id: ids.get(frame.id), designStateId: state?.id, flowNextId: frame.flowNextId ? ids.get(frame.flowNextId) : undefined }
      }))
      if (get().projectId !== projectId) return
      const copy = get().createFile(original.folderId, `${original.name} copy`, original.flowPageIds)
      localStorage.setItem(`frameui:visual-canvas:${projectId}:${copy.id}:v2`, JSON.stringify(copies))
    } catch { window.alert('The design could not be duplicated. Your original is unchanged.') }
  },
  moveFile: (fileId, folderId) => {
    set((state) => ({ files: state.files.map((file) => file.id === fileId ? { ...file, folderId, updatedAt: new Date().toISOString() } : file) }))
    persist(get())
  },
  toggleStar: (fileId) => {
    set((state) => ({ files: state.files.map((file) => file.id === fileId ? { ...file, starred: !file.starred } : file) }))
    persist(get())
  },
  archiveFile: (fileId) => {
    if (fileId === CURRENT_APPLICATION_ID) return
    set((state) => {
      const target = state.files.find((file) => file.id === fileId)
      const files = state.files.map((file) => file.id === fileId ? { ...file, archived: !file.archived, updatedAt: new Date().toISOString() } : file)
      const openFileIds = target && !target.archived ? state.openFileIds.filter((id) => id !== fileId) : state.openFileIds
      if (!openFileIds.length) openFileIds.push(CURRENT_APPLICATION_ID)
      return { files, openFileIds, activeFileId: target && !target.archived && state.activeFileId === fileId ? openFileIds.at(-1)! : state.activeFileId }
    })
    persist(get())
  },
  deleteFile: (fileId) => {
    if (fileId === CURRENT_APPLICATION_ID) return
    const projectId = get().projectId
    set((state) => {
      const openFileIds = state.openFileIds.filter((id) => id !== fileId)
      if (!openFileIds.length) openFileIds.push(CURRENT_APPLICATION_ID)
      return { files: state.files.filter((file) => file.id !== fileId), openFileIds, activeFileId: state.activeFileId === fileId ? openFileIds.at(-1)! : state.activeFileId }
    })
    if (projectId) localStorage.removeItem(`frameui:visual-canvas:${projectId}:${fileId}:v2`)
    persist(get())
  },
}))
