import type { Editability } from '@shared/types/designNode'

export type NodeOrigin =
  | 'primitive' // one of our own editor-native building blocks
  | 'project-component-full' // a detected component we understood completely
  | 'project-component-partial' // outer shape known, internals opaque
  | 'unresolvable' // couldn't be safely mapped at all

/**
 * The single place editability is decided — gates what the Inspector,
 * Insert panel, and Existing-Page draft creation are allowed to do to a
 * node (spec §26). Only 'project-component-partial'/'unresolvable' show up
 * once existing-page drafts (a later phase) import real detected
 * components; every primitive we insert ourselves is 'editable' by
 * construction.
 */
export function classifyEditability(origin: NodeOrigin): Editability {
  switch (origin) {
    case 'primitive':
    case 'project-component-full':
      return 'editable'
    case 'project-component-partial':
      return 'limited'
    case 'unresolvable':
      return 'locked'
  }
}
