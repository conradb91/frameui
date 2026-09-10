import path from 'node:path'
import crypto from 'node:crypto'
import type { DetectedComponent } from '@shared/types/projectIndex'

const COMPONENT_EXTENSIONS = /\.(?:php|phtml|twig|ejs|hbs|handlebars|mustache|njk|nunjucks|pug|jade|vue|svelte|astro|erb|liquid|eta|tpl|latte|html?)$/i
const COMPONENT_PATH = /(?:^|\/)(?:components?|partials?|includes?|fragments?|layouts?|shells?|ui)(?:\/|$)/i

function componentName(filePath: string): string {
  const base = path.basename(filePath).replace(/\.blade\.php$/i, '').replace(COMPONENT_EXTENSIONS, '')
  return base
    .replace(/^_+/, '')
    .replace(/[-_.]+(.)/g, (_, char: string) => char.toUpperCase())
    .replace(/^./, (char) => char.toUpperCase())
}

export function findMarkupComponents(rootPath: string, candidateFiles: string[], pageAbsolutePaths: Set<string>): DetectedComponent[] {
  return candidateFiles
    .filter((filePath) => !pageAbsolutePaths.has(filePath) && COMPONENT_EXTENSIONS.test(filePath) && (COMPONENT_PATH.test(filePath.split(path.sep).join('/')) || path.basename(filePath).toLowerCase() === '+layout.svelte'))
    .slice(0, 3000)
    .map((filePath) => ({
      id: crypto.randomUUID(),
      name: componentName(filePath),
      filePath: path.relative(rootPath, filePath).split(path.sep).join('/'),
      exportKind: 'template' as const,
    }))
}
