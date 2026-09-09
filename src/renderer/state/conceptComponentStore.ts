import { create } from 'zustand'
import type { ConceptComponent } from '@shared/types/model/featureModel'

/**
 * Feature-scoped Concept Components (spec Phase 14) — designer-invented
 * components that don't exist in the codebase yet, authored/inserted from
 * `ConceptComponentPanel` and rendered on the canvas as `ConceptNode`s by
 * the Design Model layer (owned elsewhere). Follows the exact async-action
 * pattern of `featureStore.ts`.
 */
interface ConceptComponentState {
  components: ConceptComponent[]
  loading: boolean

  loadForFeature: (projectId: string, featureId: string) => Promise<void>
  create: (projectId: string, featureId: string, name: string, description?: string) => Promise<ConceptComponent>
  save: (projectId: string, component: ConceptComponent) => Promise<ConceptComponent>
  remove: (projectId: string, componentId: string) => Promise<void>
}

export const useConceptComponentStore = create<ConceptComponentState>((set) => ({
  components: [],
  loading: false,

  loadForFeature: async (projectId, featureId) => {
    set({ loading: true })
    const components = await window.frameui.workspace.listConceptComponents(projectId, featureId)
    set({ components, loading: false })
  },

  create: async (projectId, featureId, name, description) => {
    const now = new Date().toISOString()
    const draft: ConceptComponent = {
      id: crypto.randomUUID(),
      featureId,
      name,
      description: description ?? '',
      variants: [],
      properties: [],
      createdAt: now,
      updatedAt: now,
    }
    const saved = await window.frameui.workspace.saveConceptComponent(projectId, draft)
    set((s) => ({ components: [saved, ...s.components] }))
    return saved
  },

  save: async (projectId, component) => {
    const saved = await window.frameui.workspace.saveConceptComponent(projectId, component)
    set((s) => ({ components: s.components.map((item) => (item.id === saved.id ? saved : item)) }))
    return saved
  },

  remove: async (projectId, componentId) => {
    await window.frameui.workspace.deleteConceptComponent(projectId, componentId)
    set((s) => ({ components: s.components.filter((item) => item.id !== componentId) }))
  },
}))
