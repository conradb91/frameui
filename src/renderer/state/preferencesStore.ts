import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Appearance = 'light' | 'dark' | 'system'
export const usePreferencesStore = create<{
  appearance: Appearance; welcomed: boolean
  setAppearance: (appearance: Appearance) => void; finishWelcome: () => void
}>()(persist((set) => ({
  appearance: 'system', welcomed: false,
  setAppearance: (appearance) => set({ appearance }),
  finishWelcome: () => set({ welcomed: true }),
}), { name: 'frameui:preferences:v1', version: 1 }))

export function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : appearance
}
