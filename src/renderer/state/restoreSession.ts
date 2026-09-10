import { useProjectStore } from './projectStore'
import { useUiStore, type ShellSection } from './uiStore'
import { useDesignFilesStore } from './designFilesStore'
import { usePreferencesStore } from './preferencesStore'

let restoration: Promise<void> | undefined
/** A single restoration across React StrictMode's effect replay. */
export function restoreSession() {
  if (restoration) return restoration
  restoration = (async () => {
    if (!usePreferencesStore.getState().welcomed) return
    try {
      const saved = JSON.parse(localStorage.getItem('frameui:last-session:v1') ?? 'null') as { path?: string; section?: ShellSection } | null
      if (!saved?.path || saved.section === 'start') return
      const result = await window.frameui.project.openPath(saved.path)
      if (!result.ok) return
      useDesignFilesStore.getState().initialise(result.project.id)
      useProjectStore.getState().setActiveProject(result.project)
      const sections: ShellSection[] = ['project-home', 'canvas', 'features', 'overview', 'screens', 'flows', 'components', 'design-system', 'captures', 'review', 'changes', 'settings', 'environment']
      useUiStore.setState({ view: 'workspace', section: sections.includes(saved.section!) ? saved.section! : 'project-home', sectionHistory: [], sectionFuture: [] })
    } catch { /* Missing or unavailable projects leave the project library usable. */ }
  })()
  return restoration
}
