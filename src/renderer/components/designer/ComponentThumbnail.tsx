import { Box } from 'lucide-react'
import type { PageStructureItem } from '@shared/types/pageStructure'
import type { Component } from '@shared/types/model/projectModel'
import { StructurePreview } from '../project/StructurePreview'

/**
 * Small, reusable real-visual preview for a detected project component —
 * renders its actual parsed structure (via `StructurePreview`) inside a
 * fixed-aspect white "card", the same visual language `ComponentsSection`
 * already uses for its big detail preview. `structure` is owned by the
 * caller (fetched lazily, cached by file path) so this stays a pure
 * presentational piece:
 *  - `null` → still loading, show a subtle pulse placeholder.
 *  - `[]` (fetched but empty) → nothing detected, show a text label instead
 *    of a blank white box.
 *  - non-empty → render the real structure.
 */
export function ComponentThumbnail({
  component,
  structure,
  size = 'sm',
}: {
  component: Component
  structure: PageStructureItem[] | null
  size?: 'sm' | 'lg'
}) {
  const isLoading = structure === null
  const isEmpty = !isLoading && structure.length === 0
  const sizeClass = size === 'sm' ? 'aspect-[4/3] w-14' : 'aspect-[16/9] w-full'

  return (
    <div
      title={component.name}
      className={`shrink-0 overflow-hidden rounded-[4px] border border-border bg-panel ${sizeClass}`}
    >
      {isLoading ? (
        <div className="flex h-full w-full items-center justify-center bg-panel-2">
          <Box size={size === 'sm' ? 10 : 16} className="animate-pulse text-text-3" />
        </div>
      ) : isEmpty ? (
        <div className="flex h-full w-full items-center justify-center bg-panel-2 px-1 text-center leading-tight text-text-3" style={{ fontSize: 11 }}>
          No preview available
        </div>
      ) : (
        <StructurePreview structure={structure} compact />
      )}
    </div>
  )
}
