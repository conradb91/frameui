const fs = require('node:fs/promises')
const path = require('node:path')
const { detectProject } = require('./detector.cjs')
const { commandForRecipe } = require('./project-recipe-engine.cjs')
const ignored = new Set(['.git', '.frameui', 'node_modules', 'vendor', 'bin', 'obj', 'dist', 'build', 'coverage', '.next', '.astro'])
/** Repository-level adapter discovery complements each service's recipe.
 * Never follows symlinks or runs project code. Work yields through async I/O.
 */
async function discoverServices(root, { signal, onProgress = () => {} } = {}) {
  const candidates = []
  let visited = 0
  async function visit(directory, depth) {
    if (signal?.aborted) throw new Error('Project analysis was cancelled.')
    const entries = await fs.readdir(directory, { withFileTypes: true })
    visited += entries.length
    if (visited > 100000) throw new Error('The repository has too many files to inspect in one pass.')
    const names = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name))
    if (directory === root || names.has('package.json') || names.has('composer.json') || names.has('spark') || names.has('artisan') || [...names].some(name => /\.csproj$/i.test(name))) candidates.push(directory)
    onProgress({ directory: path.relative(root, directory), visited })
    if (depth >= 8) return
    for (const entry of entries) if (entry.isDirectory() && !ignored.has(entry.name) && !entry.name.startsWith('.')) await visit(path.join(directory, entry.name), depth + 1)
  }
  await visit(root, 0)
  const projects = []
  for (const directory of candidates) {
    if (signal?.aborted) throw new Error('Project analysis was cancelled.')
    const project = await detectProject(directory)
    if (project.framework.id !== 'unknown' && commandForRecipe(project, 'start') || project.framework.id === 'static') projects.push(project)
  }
  if (signal?.aborted) throw new Error('Project analysis was cancelled.')
  // Workspace aggregators delegate to their member applications. Starting both duplicates services.
  for (let i=projects.length-1;i>=0;i--) {
    const pkg = await fs.readFile(path.join(projects[i].path,'package.json'),'utf8').then(JSON.parse).catch(()=>null)
    if (pkg?.workspaces && projects.some(other=>other!==projects[i] && other.path.startsWith(projects[i].path+path.sep))) projects.splice(i,1)
  }
  // A frontend is the normal design surface; sibling APIs are supporting services.
  const rank = project => ['react', 'vue', 'vite', 'next', 'astro', 'nuxt', 'sveltekit'].includes(project.framework.id) ? 0 : ['dotnet', 'laravel', 'codeigniter', 'php'].includes(project.framework.id) ? 1 : project.framework.id === 'static' ? 2 : 3
  return projects.sort((a,b) => rank(a) - rank(b) || a.path.length - b.path.length).map((project, index) => ({ ...project, serviceRole: index === 0 ? 'application' : 'supporting', relativeRoot: path.relative(root, project.path) }))
}
module.exports = { discoverServices }
