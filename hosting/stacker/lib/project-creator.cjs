const { spawn } = require('child_process')
const { executableEnvironment, nodeCommand } = require('./runtime-platform.cjs')
const fs = require('fs/promises')
const path = require('path')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const fssync = require('fs')
const { recipeByName, creationRecipeFor, creationCommand } = require('./project-recipe-engine.cjs')
const { writeFullStackSupportFiles } = require('./fullstack-project.cjs')

function validName(name) {
  return /^[a-z0-9][a-z0-9._-]{0,62}$/i.test(name) && !name.includes('..')
}

function creatorCommand(framework, name, packageManager = null) {
  if (!validName(name)) throw new Error('Use letters, numbers, dots, dashes, or underscores for the project name.')
  return creationCommand(framework, name, packageManager)
}

function runtimeTypeFor(framework) {
  const type = recipeByName(framework).runtime?.type
  return type === 'Node.js' ? 'node' : type === 'PHP' ? 'php' : null
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, ...options })
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000) })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${executable} exited with code ${code}.`)))
  })
}

async function createWordPressProject(root, target, onOutput) {
  const staging = path.join(root, `.stacker-wordpress-${process.pid}-${Date.now()}`)
  const archive = path.join(staging, 'wordpress.tar.gz')
  await fs.mkdir(staging, { mode: 0o700 })
  try {
    onOutput('info', 'Downloading the current WordPress release from wordpress.org…\n')
    const response = await fetch('https://wordpress.org/latest.tar.gz')
    if (!response.ok || !response.body) throw new Error(`WordPress download returned HTTP ${response.status}.`)
    await pipeline(Readable.fromWeb(response.body), fssync.createWriteStream(archive, { mode: 0o600 }))
    onOutput('info', 'Extracting WordPress core…\n')
    await run('/usr/bin/tar', ['-xzf', archive, '-C', staging])
    const extracted = path.join(staging, 'wordpress')
    for (const expected of ['index.php', 'wp-load.php', 'wp-settings.php', 'wp-config-sample.php']) {
      if (!await fs.access(path.join(extracted, expected)).then(() => true).catch(() => false)) throw new Error(`The official WordPress archive is missing ${expected}.`)
    }
    await fs.rename(extracted, target)
    onOutput('info', 'Downloaded and validated WordPress core.\n')
    return target
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

function spawnCreator(command, { cwd, env, framework, target, recipe, onOutput, signal }) {
  return new Promise((resolve, reject) => {
    let recentOutput = ''
    let cancelled = false
    const child = spawn(command[0], command[1], { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32' })
    const capture = (level, chunk) => {
      const value = chunk.toString()
      recentOutput = `${recentOutput}${value}`.slice(-4000)
      onOutput(level, value)
    }
    const cancel = () => {
      cancelled = true
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch { child.kill('SIGTERM') }
    }
    if (signal?.aborted) cancel()
    else signal?.addEventListener('abort', cancel, { once: true })
    child.stdout?.on('data', chunk => capture('info', chunk))
    child.stderr?.on('data', chunk => capture('error', chunk))
    child.once('error', error => reject(new Error(`Could not start ${command[0]}: ${error.message}`)))
    child.once('exit', async (code, exitSignal) => {
      signal?.removeEventListener('abort', cancel)
      if (cancelled) return reject(Object.assign(new Error('Project setup was cancelled. The incomplete folder was preserved.'), { code: 'CREATE_CANCELLED' }))
      if (code !== 0) return reject(new Error(`${framework} project creation failed ${exitSignal ? `after being terminated by ${exitSignal}` : `with exit code ${code}`}. The incomplete folder was preserved.${recentOutput.trim() ? `\n\nRecent output:\n${recentOutput.trim()}` : ''}`))
      const missing = []
      for (const file of recipe.create?.expectedFiles || []) if (!await fs.access(path.join(target, file)).then(() => true).catch(() => false)) missing.push(file)
      if (missing.length) return reject(new Error(`${framework} creator exited successfully but the generated project is invalid. Missing: ${missing.join(', ')}. The incomplete folder was preserved.`))
      resolve(target)
    })
  })
}

async function createProject({ framework, name, location, packageManager = null, applicationType = 'website', database = 'none' }, onOutput = () => {}, { managedBinDir = null, composerPharPath = null, signal = null } = {}) {
  const root = path.resolve(location)
  const target = path.join(root, name)
  const baseRecipe = recipeByName(framework)
  const recipe = creationRecipeFor(framework, applicationType, database)
  let command = recipe.create?.tool === 'stacker-fullstack'
    ? creationCommand(baseRecipe, 'client', packageManager)
    : creatorCommand(framework, name, packageManager)
  const rootStat = await fs.stat(root).catch(() => null)
  if (!rootStat?.isDirectory()) throw new Error('The selected project location does not exist.')
  if (await fs.access(target).then(() => true).catch(() => false)) throw new Error(`A folder named ${name} already exists in this location.`)
  if (managedBinDir && ['pnpm', 'yarn'].includes(packageManager) && !fssync.existsSync(path.join(managedBinDir, packageManager))) {
    const [corepack, corepackArgs] = nodeCommand('corepack', ['enable', '--install-directory', managedBinDir], managedBinDir)
    if (corepack === 'corepack') throw new Error(`The managed Node.js runtime cannot provide ${packageManager}. Select npm or install a runtime with Corepack.`)
    await run(corepack, corepackArgs, { env: executableEnvironment([managedBinDir]) })
  }
  if (command[0] === '__stacker_static__') {
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'index.html'), '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Stacker project</title></head>\n<body><main><h1>It works</h1></main></body>\n</html>\n')
    onOutput('info', 'Created a minimal static web project.\n')
    return target
  }
  if (command[0] === '__stacker_php__') {
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'composer.json'), `${JSON.stringify({ name: `stacker/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, type: 'project', require: { php: '>=8.2' } }, null, 2)}\n`)
    await fs.writeFile(path.join(target, 'index.php'), '<?php\ndeclare(strict_types=1);\n?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stacker PHP project</title></head><body><main><h1>It works</h1></main></body></html>\n')
    onOutput('info', 'Created a minimal Composer-backed PHP project.\n')
    return target
  }
  if (command[0] === '__stacker_wordpress__') return createWordPressProject(root, target, onOutput)
  if (command[0] === 'composer' && composerPharPath) command = ['php', [composerPharPath, ...command[1]]]
  const env = { ...executableEnvironment([managedBinDir]), FORCE_COLOR: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
  if (baseRecipe.runtime?.type === 'Node.js') command = nodeCommand(command[0],command[1],managedBinDir)
  if (managedBinDir && process.platform === 'win32' && command[0] === 'php') command[0] = path.join(managedBinDir,'php.exe')
  if (recipe.create?.tool === 'stacker-fullstack') {
    await fs.mkdir(target)
    await spawnCreator(command, { cwd: target, env, framework, target: path.join(target, 'client'), recipe: baseRecipe, onOutput, signal })
    if (signal?.aborted) throw Object.assign(new Error('Project setup was cancelled. The incomplete folder was preserved.'), { code: 'CREATE_CANCELLED' })
    await writeFullStackSupportFiles(target, { name, frontend: baseRecipe.id, database, packageManager, apiPort: (baseRecipe.defaultPort || 5173) + 1 })
    onOutput('info', `Created the Express API service and ${database === 'none' ? 'local API configuration' : `${database} database adapter`}.\n`)
    return target
  }
  await spawnCreator(command, { cwd: root, env, framework, target, recipe, onOutput, signal })
  if (recipe.id === 'laravel') {
    // Laravel's default post-create script migrates automatically. Composer
    // scripts are disabled above; perform only the required non-schema setup.
    await fs.copyFile(path.join(target, '.env.example'), path.join(target, '.env'), require('fs').constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error })
    for (const action of ['key:generate', 'package:discover']) {
      await spawnCreator(['php', ['artisan', action]], { cwd: target, env, framework, target, recipe, onOutput, signal })
    }
    onOutput('info', 'Laravel configured. Migrations are pending and must be run manually.\n')
  }
  return target
}

module.exports = { createProject, creatorCommand, validName, runtimeTypeFor }
