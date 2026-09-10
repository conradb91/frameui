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
  starred: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

interface PersistedDesignFiles {
  folders: DesignFolder[]
  files: DesignFile[]
  activeFileId: string
}

interface DesignFilesState extends PersistedDesignFiles {
  projectId: string | null
  initialise: (projectId: string) => void
  selectFile: (fileId: string) => void
  createFile: (folderId?: string, name?: string) => DesignFile
  createFolder: (name?: string) => DesignFolder
  renameFile: (fileId: string, name: string) => void
  renameFolder: (folderId: string, name: string) => void
  duplicateFile: (fileId: string) => void
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
  } satisfies PersistedDesignFiles))
}

export const useDesignFilesStore = create<DesignFilesState>((set, get) => ({
  projectId: null,
  ...initialState(),
  initialise: (projectId) => {
    if (get().projectId === projectId) return
    set({ projectId, ...read(projectId) })
  },
  selectFile: (activeFileId) => {
    set({ activeFileId })
    persist(get())
  },
  createFile: (folderId, name = 'Untitled') => {
    const state = get()
    const now = new Date().toISOString()
    const file: DesignFile = {
      id: crypto.randomUUID(), name, folderId: folderId ?? state.folders[0]?.id ?? 'product',
      kind: 'design', starred: false, archived: false, createdAt: now, updatedAt: now,
    }
    set({ files: [...state.files, file], activeFileId: file.id })
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
  duplicateFile: (fileId) => {
    const original = get().files.find((file) => file.id === fileId)
    if (!original) return
    const copy = get().createFile(original.folderId, `${original.name} copy`)
    const projectId = get().projectId
    if (projectId) {
      const frames = localStorage.getItem(`frameui:visual-canvas:${projectId}:${fileId}:v2`)
      if (frames) localStorage.setItem(`frameui:visual-canvas:${projectId}:${copy.id}:v2`, frames)
    }
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
      return { files, activeFileId: target && !target.archived && state.activeFileId === fileId ? CURRENT_APPLICATION_ID : state.activeFileId }
    })
    persist(get())
  },
  deleteFile: (fileId) => {
    if (fileId === CURRENT_APPLICATION_ID) return
    const projectId = get().projectId
    set((state) => ({ files: state.files.filter((file) => file.id !== fileId), activeFileId: state.activeFileId === fileId ? CURRENT_APPLICATION_ID : state.activeFileId }))
    if (projectId) localStorage.removeItem(`frameui:visual-canvas:${projectId}:${fileId}:v2`)
    persist(get())
  },
}))
