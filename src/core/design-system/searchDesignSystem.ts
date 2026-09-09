import type { ComponentIntelligence, DesignPattern, DesignValueObservation } from '@shared/types/designSystem'
import type { Component } from '@shared/types/model/projectModel'

export type DesignSystemSearchResult = { kind: 'Component' | 'Value' | 'Pattern'; id: string; title: string; detail: string; pageId?: string }

export function searchDesignSystem(query: string, components: Component[], intelligence: ComponentIntelligence[], observations: DesignValueObservation[], patterns: DesignPattern[]): DesignSystemSearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return [
    ...intelligence.filter((item) => item.searchText.includes(q) || item.props.some((prop) => `${prop.name} ${prop.type} ${prop.values.join(' ')}`.toLowerCase().includes(q))).map((item) => ({ kind: 'Component' as const, id: item.componentId, title: components.find((component) => component.id === item.componentId)?.name ?? item.componentId, detail: `${item.category} · ${item.usages.length} pages` })),
    ...observations.filter((item) => `${item.name} ${item.value} ${item.category} ${item.sources.map((source) => source.filePath).join(' ')}`.toLowerCase().includes(q)).map((item) => ({ kind: 'Value' as const, id: item.id, title: item.value, detail: `${item.category} · ${item.usageCount} uses`, pageId: item.pageIds[0] })),
    ...patterns.filter((item) => `${item.name} ${item.description} ${item.evidence.join(' ')}`.toLowerCase().includes(q)).map((item) => ({ kind: 'Pattern' as const, id: item.id, title: item.name, detail: `${item.pageIds.length} pages`, pageId: item.pageIds[0] })),
  ]
}
