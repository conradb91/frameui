import fs from 'node:fs'
import path from 'node:path'
import type { DependencyGraph, ProjectIndex } from '@shared/types/projectIndex'

const IMPORT_PATTERN = /(?:\bimport\s*(?:[\s\S]{0,180}?\bfrom\s*)?|\bexport\b[\s\S]{0,180}?\bfrom\s*|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g
const STYLE_PATTERN = /@(?:use|forward|import)\s+(?:url\()?['"]([^'"]+)['"]/g
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.astro', '.css', '.scss', '.sass', '.less', '.php', '.html', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.otf']

function normalize(value: string): string { return value.split(path.sep).join('/') }

function resolveReference(fromFile: string, specifier: string, known: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null
  const base = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)))
  for (const suffix of EXTENSIONS) {
    const candidate = `${base}${suffix}`
    if (known.has(candidate)) return candidate
    for (const indexName of ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.vue', 'index.svelte']) {
      const indexed = `${candidate}/${indexName}`
      if (known.has(indexed)) return indexed
    }
  }
  return null
}

function referencesFor(rootPath: string, file: string, known: Set<string>): string[] {
  if (/\.(?:png|jpe?g|gif|webp|avif|woff2?|ttf|otf)$/i.test(file)) return []
  let content: string
  try { content = fs.readFileSync(path.join(rootPath, file), 'utf-8') } catch { return [] }
  const resolved = new Set<string>()
  for (const pattern of [IMPORT_PATTERN, STYLE_PATTERN]) {
    pattern.lastIndex = 0
    for (const match of content.matchAll(pattern)) {
      const target = resolveReference(file, match[1], known)
      if (target) resolved.add(target)
    }
  }
  return [...resolved]
}

export function buildDependencyGraph(rootPath: string, files: string[], index: Pick<ProjectIndex, 'projectModel'>): DependencyGraph {
  const known = new Set(files.map(normalize))
  const fileObjects: Record<string, string[]> = {}
  for (const page of index.projectModel.pages) (fileObjects[normalize(page.source.filePath)] ??= []).push(page.id)
  for (const component of index.projectModel.components) (fileObjects[normalize(component.source.filePath)] ??= []).push(component.id)
  const dependencies: Record<string, string[]> = {}
  for (const file of known) dependencies[file] = referencesFor(rootPath, file, known)
  return finishGraph({ fileObjects, dependencies, dependents: {}, objectConsumers: {} })
}

function finishGraph(graph: DependencyGraph): DependencyGraph {
  const dependents: Record<string, string[]> = {}
  for (const [consumer, dependencies] of Object.entries(graph.dependencies)) {
    for (const dependency of dependencies) (dependents[dependency] ??= []).push(consumer)
  }
  const objectConsumers: Record<string, string[]> = {}
  for (const [declaringFile, objectIds] of Object.entries(graph.fileObjects)) {
    const consumers = dependents[declaringFile] ?? []
    for (const objectId of objectIds) objectConsumers[objectId] = consumers
  }
  return { ...graph, dependents, objectConsumers }
}

export function updateDependencyGraph(rootPath: string, graph: DependencyGraph, allFiles: string[], changedFiles: string[], index: Pick<ProjectIndex, 'projectModel'>): DependencyGraph {
  const known = new Set(allFiles.map(normalize))
  const dependencies = { ...graph.dependencies }
  const fileObjects = { ...graph.fileObjects }
  for (const file of changedFiles.map(normalize)) {
    if (known.has(file)) dependencies[file] = referencesFor(rootPath, file, known)
    else delete dependencies[file]
    delete fileObjects[file]
  }
  for (const page of index.projectModel.pages) (fileObjects[normalize(page.source.filePath)] ??= []).push(page.id)
  for (const component of index.projectModel.components) (fileObjects[normalize(component.source.filePath)] ??= []).push(component.id)
  for (const key of Object.keys(fileObjects)) fileObjects[key] = [...new Set(fileObjects[key])]
  return finishGraph({ fileObjects, dependencies, dependents: {}, objectConsumers: {} })
}

/** Transitive reverse lookup, bounded by visited files. */
export function affectedFiles(graph: DependencyGraph, changedFiles: string[]): string[] {
  const queue = [...changedFiles.map(normalize)]
  const visited = new Set(queue)
  while (queue.length) {
    for (const dependent of graph.dependents[queue.shift()!] ?? []) {
      if (!visited.has(dependent)) { visited.add(dependent); queue.push(dependent) }
    }
  }
  return [...visited]
}
