const fs = require('node:fs/promises')
const path = require('node:path')
const { resolvePackageManager, commandForRecipe } = require('./project-recipe-engine.cjs')
const { matchesConstraint } = require('./runtime-manager.cjs')
async function preparePhpAssets(project,runtimeManager,manager,progress=()=>{}) {
  if (project.runtime?.type !== 'PHP') return false
  const pkg = await fs.readFile(path.join(project.path,'package.json'),'utf8').then(JSON.parse).catch(()=>null)
  if (!pkg?.scripts?.build) return false
  const exists = async file => !!(await fs.stat(path.join(project.path,file)).catch(()=>null))
  const resolution = await resolvePackageManager({packageJson:pkg,exists,recipe:{packageManagers:{recommended:'npm'}}})
  if (resolution.conflict || resolution.manager === 'bun') throw new Error('Choose a supported, unambiguous package manager for the application’s frontend assets.')
  const nodeProject = {...project,framework:{id:'node',language:'JavaScript'},recipeId:'node',runtime:{type:'Node.js',constraint:pkg.engines?.node||'>=20'},runtimeSelection:null,packageManager:resolution.manager,packageScripts:pkg.scripts}
  progress('assets-runtime','Preparing the frontend build tools…')
  if (!(await runtimeManager.executablePath(nodeProject))) {
    const release=(await runtimeManager.catalog()).find(item=>matchesConstraint(item.version,nodeProject.runtime.constraint))
    if (!release) throw new Error('No compatible runtime is available to build the frontend assets.')
    await runtimeManager.install(release.version)
    nodeProject.runtimeSelection=release.version
  }
  nodeProject.packageTools=await require('./package-manager-bootstrap.cjs').ensurePackageManager(nodeProject,runtimeManager)
  progress('assets-dependencies','Preparing frontend dependencies…')
  const install=await manager.runCommand(nodeProject,'assets-install',commandForRecipe(nodeProject,'install'))
  if (install.task.status !== 'Completed') throw new Error('Frontend dependency preparation failed. Review the technical details and retry.')
  progress('assets-build','Building the application’s styles and browser code…')
  const build=await manager.runCommand(nodeProject,'assets-build',commandForRecipe(nodeProject,'build'))
  if (build.task.status !== 'Completed') throw new Error('The application’s frontend build failed. Review the technical details and retry.')
  // A source checkout can contain a stale Vite development-server marker.
  // The private application must use the assets just built by FrameUI.
  if (project.framework.id === 'laravel') await fs.rm(path.join(project.path,'public/hot'),{force:true})
  return true
}
module.exports={preparePhpAssets}
