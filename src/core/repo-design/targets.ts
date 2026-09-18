import type { Page, ProjectModel } from '@shared/types/model/projectModel'
export function sourceTarget(model: ProjectModel, key: string): Page | undefined {
  const page = model.pages.find(p => p.id === key || p.route === key)
  if (page) return page
  const component = model.components.find(c => c.id === key.replace(/^component:/, ''))
  if (!component) return
  return { id: component.id, name: component.name, route: null, routeId: null, area: 'Shared UI', source: component.source, structure: model.designSystem?.components.find(c => c.componentId === component.id)?.sourceStructure ?? [], elementCount: 0, componentNames: [component.name], textContent: [], supportedViewports: ['desktop','tablet','mobile'], states: [], analysisStatus: 'ready' }
}
