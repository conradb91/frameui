const path = require('node:path')
const fs = require('node:fs')
function nodePlatform(platform = process.platform, architecture = process.arch) {
  if (!['darwin','linux','win32'].includes(platform) || !['x64','arm64'].includes(architecture)) throw new Error('No approved Node.js build is available for this operating system and architecture.')
  const windows = platform === 'win32'
  return {platform,architecture,catalogFile:platform === 'darwin' ? `osx-${architecture}-tar` : windows ? `win-${architecture}-zip` : `linux-${architecture}`, distribution:windows ? 'win' : platform, extension:windows ? 'zip' : 'tar.gz', bin:windows ? '' : 'bin', executable:windows ? 'node.exe' : 'node'}
}
function executableEnvironment(extra = [], source = process.env, platform = process.platform) {
  const env = {...source}
  const old = Object.keys(source).find(key => key.toLowerCase() === 'path')
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
  env.PATH = [...extra, ...(platform === 'win32' ? [] : ['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin']), old ? source[old] : ''].filter(Boolean).join(platform === 'win32' ? ';' : ':')
  return env
}
function findExecutable(command, source = process.env, platform = process.platform) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(command)) return null
  const env = executableEnvironment([],source,platform)
  const extensions = platform === 'win32' ? ['', '.exe','.cmd','.bat'] : ['']
  for (const directory of env.PATH.split(platform === 'win32' ? ';' : ':').filter(Boolean)) for (const extension of extensions) {
    const file = path.join(directory.replace(/^"|"$/g,''),command + extension)
    try { if (fs.statSync(file).isFile()) { fs.accessSync(file,platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return file } } catch {}
  }
  return null
}
function nodeCommand(command,args,bin,platform = process.platform) {
  if (!bin) return [command,args]
  const windows = platform === 'win32'
  const node = path.join(bin,windows ? 'node.exe' : 'node')
  if (command === 'node') return [node,args]
  const base = windows ? path.join(bin,'node_modules') : path.resolve(bin,'../lib/node_modules')
  const scripts = {npm:['npm','bin/npm-cli.js'],npx:['npm','bin/npx-cli.js'],corepack:['corepack','dist/corepack.js'],pnpm:['corepack','dist/pnpm.js'],yarn:['corepack','dist/yarn.js']}
  if (scripts[command]) {
    const script = path.join(base,...scripts[command])
    if (fs.existsSync(script)) return [node,[script,...args]]
  }
  return [command,args]
}
module.exports = {nodePlatform,executableEnvironment,findExecutable,nodeCommand}
