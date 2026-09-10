import { pendingWorkspaceSaves, reportSaveError } from './pendingSaves'
import { create } from 'zustand'
import type { Feature, FeatureStatus } from '@shared/types/model/featureModel'

interface FeatureState {
  features: Feature[]
  loading: boolean

  loadFeatures: (projectId: string) => Promise<void>
  createFeature: (projectId: string, name: string, description?: string) => Promise<Feature>
  saveFeature: (feature: Feature) => Promise<Feature>
  deleteFeature: (projectId: string, featureId: string) => Promise<void>
  setStatus: (feature: Feature, status: FeatureStatus) => Promise<void>
}

let loadGeneration = 0

export const useFeatureStore = create<FeatureState>((set, get) => ({
  features: [],
  loading: false,

  loadFeatures: async (projectId) => {
    const generation = ++loadGeneration
    set({ loading: true })
    try {
      const features = await window.frameui.workspace.listFeatures(projectId)
      if (generation === loadGeneration) set({ features })
    } catch (error) { reportSaveError(error) } finally {
      if (generation === loadGeneration) set({ loading: false })
    }
  },

  createFeature: async (projectId, name, description) => {
    const feature = await window.frameui.workspace.createFeature(projectId, name, description)
    set((s) => ({ features: [feature, ...s.features] }))
    return feature
  },

  saveFeature: async (feature) => {
    const saved = await window.frameui.workspace.saveFeature(feature)
    set((s) => ({ features: s.features.map((item) => (item.id === saved.id ? saved : item)) }))
    return saved
  },

  deleteFeature: async (projectId, featureId) => {
    await pendingWorkspaceSaves.flush()
    await window.frameui.workspace.deleteFeature(projectId, featureId)
    set((s) => ({ features: s.features.filter((item) => item.id !== featureId) }))
  },

  setStatus: async (feature, status) => {
    await get().saveFeature({ ...feature, status })
  },
}))
