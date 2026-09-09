import { useDesignStore } from '../state/designStore'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'
import type { Feature, PageRef } from '@shared/types/model/featureModel'
import type { Page } from '@shared/types/model/projectModel'

/**
 * Phase 9/17 — "Design This Page" glue. Every page (existing or Feature-
 * invented) now designs through a `DesignState` rather than a Flow screen
 * node — a page's "Default" state is found-or-created here, seeded from
 * the real page structure the first time (same `buildExistingPageDraftTree`
 * path the old Flow-based mechanism used, so nothing here duplicates
 * Phase 0-5's page/structure/route intelligence). The legacy Flow/
 * ScreenDraft path stays in place only for the standalone project-level
 * "Screens" browser outside any Feature.
 */
export async function openDesignThisPage(projectId: string, feature: Feature, page: Page): Promise<void> {
  const pageRef: PageRef = { kind: 'existing', pageId: page.id }
  const states = await window.frameui.workspace.listDesignStatesForPage(projectId, pageRef)
  let defaultState = states.find((s) => s.name === 'Default')

  if (!defaultState) {
    defaultState = await window.frameui.workspace.createDesignState(projectId, {
      featureId: feature.id,
      pageRef,
      pageSlugHint: page.name,
      name: 'Default',
      origin: 'design',
      provenance: 'existing',
    })
    const structure = await window.frameui.project.getPageStructure(page.source.filePath)
    const tree = buildExistingPageDraftTree(crypto.randomUUID(), structure, page.source.filePath)
    await window.frameui.workspace.saveDesignTree({ ownerId: defaultState.id, projectId, tree, updatedAt: new Date().toISOString() })
  }

  await useDesignStore.getState().loadDesignState(projectId, defaultState.id, null)
}
