const fs = require('fs/promises')
const path = require('path')
const { environmentTemplateFor, activeEnvironmentFiles } = require('./environment.cjs')

const CONFIGURATION_PATHS = [
  ['.', 'Project root'],
  ['package.json', 'Manifest'], ['composer.json', 'Manifest'],
  ['package-lock.json', 'Lockfile'], ['pnpm-lock.yaml', 'Lockfile'], ['yarn.lock', 'Lockfile'], ['composer.lock', 'Lockfile'],
  ['.nvmrc', 'Runtime'], ['.node-version', 'Runtime'], ['.tool-versions', 'Runtime'],
  ['next.config.js', 'Framework'], ['next.config.mjs', 'Framework'], ['next.config.ts', 'Framework'],
  ['vite.config.js', 'Framework'], ['vite.config.ts', 'Framework'], ['astro.config.mjs', 'Framework'],
  ['artisan', 'Application entry'], ['spark', 'Application entry'], ['index.html', 'Application entry'], ['server.js', 'Application entry'], ['index.js', 'Application entry'],
  ['prisma/schema.prisma', 'Database'], ['database/database.sqlite', 'Database'], ['prisma/dev.db', 'Database'], ['data/database.sqlite', 'Database'], ['database.sqlite', 'Database'], ['db.sqlite', 'Database'], ['dev.db', 'Database'],
  ['database/migrations', 'Migrations'], ['prisma/migrations', 'Migrations'], ['routes', 'Application'], ['src', 'Application'], ['app', 'Application'], ['public', 'Document root'],
  ['writable', 'Writable data'], ['storage', 'Writable data'], ['storage/framework/cache', 'Cache'], ['bootstrap/cache', 'Cache'],
]

function projectPath(project, relativePath) {
  const root = path.resolve(project.path)
  const target = path.resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('The requested path is outside the project folder.')
  return target
}

async function listProjectFiles(project) {
  const candidates = [...CONFIGURATION_PATHS]
  const adapterRepairPaths = new Set(project.writableDirectories || (project.framework?.id === 'laravel' ? ['storage', 'bootstrap/cache'] : project.framework?.id === 'codeigniter' ? ['writable'] : []))
  const environmentTemplate = environmentTemplateFor(project)
  for (const file of project.expectedFiles || []) candidates.push([file, 'Recipe structure'])
  for (const file of project.envFiles || []) candidates.push([file, file === environmentTemplate ? 'Environment template' : 'Environment'])
  if (environmentTemplate && !activeEnvironmentFiles(project).length) candidates.push(['.env', 'Environment (not created)'])
  for (const relative of project.writableDirectories || []) candidates.push([relative, 'Framework writable directory (not created)'])
  if (project.documentRoot && path.resolve(project.documentRoot) !== path.resolve(project.path)) candidates.push([path.relative(project.path, project.documentRoot), 'Document root'])
  const seen = new Set()
  const items = []
  for (const [relativePath, role] of candidates) {
    if (!relativePath || seen.has(relativePath)) continue
    seen.add(relativePath)
    const absolutePath = projectPath(project, relativePath)
    const stat = await fs.stat(absolutePath).catch(() => null)
    const repairable = !stat && (role.endsWith('(not created)') || adapterRepairPaths.has(relativePath))
    if (!stat && !repairable) continue
    items.push({
      name: relativePath === '.' ? path.basename(project.path) : path.basename(relativePath),
      relativePath,
      absolutePath,
      role,
      exists: Boolean(stat),
      kind: stat ? (stat.isDirectory() ? 'Folder' : 'File') : relativePath === '.env' ? 'File' : 'Folder',
      size: stat?.isFile() ? stat.size : null,
      updatedAt: stat ? stat.mtime.toISOString() : null,
      repairable,
    })
  }
  return items.sort((left, right) => left.role.localeCompare(right.role) || left.relativePath.localeCompare(right.relativePath))
}

async function repairPreview(project, relativePath) {
  const item = (await listProjectFiles(project)).find(entry => entry.relativePath === relativePath)
  if (!item?.repairable) throw new Error('No safe automatic repair is available for this path.')
  if (relativePath === '.env') return {
    relativePath, title: 'Create private environment file',
    summary: `Copy ${environmentTemplateFor(project)} to .env without modifying the template.`,
    operations: [{ action: 'copy', source: environmentTemplateFor(project), destination: '.env', mode: '600' }],
  }
  return {
    relativePath, title: `Create ${relativePath}`,
    summary: 'Create the adapter-required writable directory inside the project.',
    operations: [{ action: 'mkdir', destination: relativePath, mode: '755' }],
  }
}

async function repairProjectItem(project, relativePath) {
  const preview = await repairPreview(project, relativePath)
  if (relativePath === '.env') {
    const source = projectPath(project, environmentTemplateFor(project))
    const destination = projectPath(project, '.env')
    const contents = await fs.readFile(source)
    const handle = await fs.open(destination, 'wx', 0o600).catch(error => {
      if (error.code === 'EEXIST') throw new Error('.env already exists; Stacker did not overwrite it.')
      throw error
    })
    try { await handle.writeFile(contents) } finally { await handle.close() }
  } else {
    await fs.mkdir(projectPath(project, relativePath), { recursive: true, mode: 0o755 })
  }
  return { ...preview, applied: true }
}

async function resolveProjectItem(project, relativePath) {
  const allowed = await listProjectFiles(project)
  const item = allowed.find(entry => entry.relativePath === relativePath && entry.exists)
  if (!item) throw new Error('This path is not part of the detected project configuration.')
  return item
}

module.exports = { listProjectFiles, resolveProjectItem, repairPreview, repairProjectItem, projectPath, CONFIGURATION_PATHS }
