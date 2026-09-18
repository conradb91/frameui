const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const semver = require('semver')
const { nodeCommand, executableEnvironment } = require('./runtime-platform.cjs')
const command = (file,args,env,timeout=15000) => new Promise((resolve,reject)=>execFile(file,args,{env,timeout,maxBuffer:4*1024*1024,windowsHide:true},(error,stdout,stderr)=>error?reject(new Error(stderr.trim()||error.message)):resolve(stdout.trim())))
async function ensurePackageManager(project,runtimeManager) {
  if (!['pnpm','yarn'].includes(project.packageManager)) return null
  const bin = runtimeManager.cachedPath(project)
  if (!bin) throw new Error('A compatible JavaScript runtime is required for this package workspace.')
  const [node] = nodeCommand('node',[],bin)
  const env = executableEnvironment([bin])
  const version = (await command(node,['--version'],env)).replace(/^v/,'')
  const target = path.join(runtimeManager.root,'package-tools',version)
  const cli = path.join(target,'node_modules/corepack/dist/corepack.js')
  if (await command(node,[cli,'--version'],env).then(()=>true).catch(()=>false)) return target
  const response = await fetch('https://registry.npmjs.org/corepack',{signal:AbortSignal.timeout(20000)})
  if (!response.ok) throw new Error('The package manager could not be downloaded. Check your connection and retry.')
  const metadata = await response.json()
  const release = Object.values(metadata.versions || {}).filter(item=>semver.valid(item.version)&&!semver.prerelease(item.version)&&semver.satisfies(version,item.engines?.node||'*')).sort((a,b)=>semver.rcompare(a.version,b.version))[0]
  if (!release) throw new Error('No supported package manager matches this JavaScript runtime.')
  const staging=target+'.installing-'+require('node:crypto').randomUUID()
  try {
    await fs.mkdir(staging,{recursive:true})
    const [npm,args] = nodeCommand('npm',['install','--prefix',staging,'--ignore-scripts','--engine-strict','--no-audit','--no-fund',`corepack@${release.version}`],bin)
    await command(npm,args,env,240000)
    await command(node,[path.join(staging,'node_modules/corepack/dist/corepack.js'),'--version'],env)
    await require('./database-runtime-manager.cjs').publishRuntime(staging,target)
  } finally { await fs.rm(staging,{recursive:true,force:true,maxRetries:3}) }
  return target
}
module.exports={ensurePackageManager}
