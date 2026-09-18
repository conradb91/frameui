const fs = require('node:fs/promises')
const path = require('node:path')
const { minimatch } = require('minimatch')
const YAML = require('yaml')
const read = file => fs.readFile(file,'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
async function workspaceContext(directory) {
  let parent = path.dirname(directory)
  for (let depth=0;depth<8 && parent!==path.dirname(parent);depth++,parent=path.dirname(parent)) {
    const manifest = await read(path.join(parent,'package.json'))
    let pkg; try { pkg = JSON.parse(manifest || '{}') } catch { pkg = {} }
    const yamlText = await read(path.join(parent,'pnpm-workspace.yaml'))
    let pnpm; try { pnpm = YAML.parse(yamlText) } catch { throw new Error('The package workspace file could not be read.') }
    const patterns = pnpm?.packages || (Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages) || []
    const relative = path.relative(parent,directory).split(path.sep).join('/')
    if (Array.isArray(patterns) && patterns.some(pattern=>typeof pattern==='string' && !pattern.startsWith('!') && minimatch(relative,pattern)) && !patterns.some(pattern=>typeof pattern==='string' && pattern.startsWith('!') && minimatch(relative,pattern.slice(1)))) {
      return { root:parent, packageJson:pkg, fingerprint:manifest+yamlText+(await Promise.all(['package-lock.json','pnpm-lock.yaml','yarn.lock'].map(name=>read(path.join(parent,name))))).join(''), exists:async name=>!!(await fs.stat(path.join(parent,name)).catch(()=>null)) }
    }
    if (await fs.stat(path.join(parent,'.git')).catch(()=>null) || await fs.stat(path.join(parent,'.frameui-copy.json')).catch(()=>null)) break
  }
  return null
}
module.exports = { workspaceContext }
