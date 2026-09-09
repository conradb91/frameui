import path from 'node:path'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { extractPageStructure as extractJsxStructure } from '@core/adapters/react/extractPageStructure'
import { extractVueStructure } from '@core/adapters/vue/extractVueStructure'
import { extractSvelteStructure } from '@core/adapters/svelte/extractSvelteStructure'
import { extractMarkupStructure, extractPugStructure } from './extractMarkupStructure'

const JSX_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const PUG_EXTENSIONS = new Set(['.pug', '.jade'])
const VUE_EXTENSIONS = new Set(['.vue'])
const SVELTE_EXTENSIONS = new Set(['.svelte'])

/** Routes a source file to its non-executing static structure reader. */
export function extractPageStructureFromSource(
  content: string,
  filePath: string,
  knownComponentNames: Set<string>,
): PageStructureItem[] {
  const ext = path.extname(filePath).toLowerCase()
  if (JSX_EXTENSIONS.has(ext)) return extractJsxStructure(content, ext, knownComponentNames)
  if (PUG_EXTENSIONS.has(ext)) return extractPugStructure(content, knownComponentNames)
  if (VUE_EXTENSIONS.has(ext)) return extractVueStructure(content, filePath, knownComponentNames)
  if (SVELTE_EXTENSIONS.has(ext)) return extractSvelteStructure(content, filePath, knownComponentNames)
  return extractMarkupStructure(content, filePath, knownComponentNames)
}
