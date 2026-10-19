import type Sketch from '@sketch-hq/sketch-file-format-ts'
import type { SketchExportRequest } from '@shared/types/sketchExport'
import { buildSketchDocument, validateSketchDocuments } from './sketchDocument'
import type { ExportFontFace } from './sketchFonts'
/** Each saved design stays a separate Sketch page, preserving its canvas coordinates. */
export function buildSketchProject(
  request: SketchExportRequest,
  progress: (stage: string) => void = () => {},
  fonts: ExportFontFace[] = [],
): ReturnType<typeof buildSketchDocument> {
  const sources =
    request.scope === 'project'
      ? [request.document, ...(request.documents ?? []).filter((d) => d.id !== request.document.id)]
      : [request.document]
  const builds = sources.map((document, i) =>
    buildSketchDocument(
      { ...request, document, documents: undefined },
      (stage) => progress(`${stage} · design ${i + 1} of ${sources.length}`),
      fonts,
    ),
  )
  if (builds.length === 1) return builds[0]
  const entries = new Map(builds[0].entries.map((e) => [e.path, e]))
  const report = structuredClone(builds[0].report)
  const read = <T>(index: number, name: string): T =>
    JSON.parse(builds[index].entries.find((e) => e.path === name)!.data.toString())
  const document = read<Sketch.Document>(0, 'document.json'),
    meta = read<Sketch.Meta>(0, 'meta.json'),
    user = read<Sketch.User>(0, 'user.json')
  for (let i = 1; i < builds.length; i++) {
    document.pages.push(...read<Sketch.Document>(i, 'document.json').pages)
    Object.assign(meta.pagesAndArtboards, read<Sketch.Meta>(i, 'meta.json').pagesAndArtboards)
    const r = builds[i].report
    for (const key of [
      'artboards',
      'layers',
      'editableText',
      'editableVectors',
      'images',
      'groups',
      'components',
      'fallbackEffects',
      'unconvertedInteractions',
      'unsupportedFeatures',
      'missingAssets',
      'failedElements',
    ] as const)
      report[key] += r[key]
    report.warnings.push(...r.warnings)
    report.missingFonts = [...new Set([...report.missingFonts, ...r.missingFonts])]
    report.fontsToCheck = [...new Set([...report.fontsToCheck, ...r.fontsToCheck])]
    for (const [key, value] of Object.entries(r.idMap))
      report.idMap[sources[i].id + ':' + key] = value
    for (const entry of builds[i].entries) {
      if (entry.path.startsWith('pages/') || entry.path.startsWith('images/'))
        entries.set(entry.path, entry)
      else if (entry.path.startsWith('frameui/'))
        entries.set('frameui/designs/' + i + '/' + entry.path.slice(8), {
          ...entry,
          path: 'frameui/designs/' + i + '/' + entry.path.slice(8),
        })
    }
  }
  for (const entry of entries.values())
    if (entry.path.startsWith('pages/'))
      validateSketchDocuments({ page: JSON.parse(entry.data.toString()), document, meta, user })
  for (const [name, value] of Object.entries({
    'document.json': document,
    'meta.json': meta,
    'frameui/compatibility.json': report,
  }))
    entries.set(name, { path: name, data: Buffer.from(JSON.stringify(value)) })
  return { entries: [...entries.values()], report }
}
