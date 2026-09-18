const path = require('path')

function sameProjectPath(left, right) {
  if (!left || !right) return false
  return path.resolve(String(left)) === path.resolve(String(right))
}

function isStackerSourceManifest(manifest) {
  return manifest?.name === 'stacker'
    && manifest?.main === 'electron/main.cjs'
    && manifest?.build?.appId === 'com.stacker.localdev'
}

function assertNotApplicationSource(projectPath, applicationPath, manifest = null) {
  if (!sameProjectPath(projectPath, applicationPath) && !isStackerSourceManifest(manifest)) return
  throw new Error('You selected Stacker\'s own source folder. Choose the application project you want to run instead (for example, /Users/conrad/velyra/velora).')
}

module.exports = { sameProjectPath, isStackerSourceManifest, assertNotApplicationSource }
