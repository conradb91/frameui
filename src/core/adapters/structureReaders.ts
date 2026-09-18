import type { PageStructureItem } from '@shared/types/pageStructure'

type StructureReader = (content: string, filePath: string, knownNames: Set<string>, includeRoot: boolean) => PageStructureItem[] | null
const readers = new Map<string, StructureReader>()
export function registerStructureReader(id: string, reader: StructureReader): () => void {
  if (readers.has(id)) throw new Error(`Duplicate structure reader: ${id}`)
  readers.set(id, reader)
  return () => { readers.delete(id) }
}
export function readAdapterStructure(content: string, filePath: string, knownNames: Set<string>, includeRoot: boolean): PageStructureItem[] | null {
  for (const reader of readers.values()) {
    const result = reader(content, filePath, knownNames, includeRoot)
    if (result !== null) return result
  }
  return null
}

const extensions = new Map<string, string[]>()
export function registerSourceExtensions(id: string, values: string[]): () => void {
  extensions.set(id, values)
  return () => { extensions.delete(id) }
}
export function isAdapterSourceFile(filePath: string): boolean {
  return [...extensions.values()].some((values) => values.some((extension) => filePath.toLowerCase().endsWith(extension.toLowerCase())))
}
