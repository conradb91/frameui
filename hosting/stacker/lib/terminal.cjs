const { spawn } = require('child_process')

function shellQuote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'` }

function terminalCommand(projectPath, runtimePath = null, environment = {}) {
  const parts = [`cd ${shellQuote(projectPath)}`]
  if (runtimePath) parts.push(`export PATH=${shellQuote(runtimePath)}:"$PATH"`)
  for (const [key, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid terminal environment variable name.')
    parts.push(`export ${key}=${shellQuote(value)}`)
  }
  parts.push('clear')
  return parts.join('; ')
}

function openPreparedTerminal(projectPath, runtimePath = null, environment = {}) {
  const script = [
    'on run argv',
    'tell application "Terminal"',
    'activate',
    'do script (item 1 of argv)',
    'end tell',
    'end run',
  ].join('\n')
  const child = spawn('/usr/bin/osascript', ['-e', script, '--', terminalCommand(projectPath, runtimePath, environment)], { detached: true, stdio: 'ignore' })
  child.unref()
  return true
}

module.exports = { shellQuote, terminalCommand, openPreparedTerminal }
