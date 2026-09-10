import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PreviewProcess, codeIgniterServeArgs, previewEnvironment, previewSearchPath, resolvePreviewExecutable } from '../../main/security/spawnPreview'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('preview executable resolution', () => {
  test('finds a project-local tool with a Finder-style minimal PATH', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-preview-'))
    temporaryDirectories.push(project)
    const bin = path.join(project, 'node_modules', '.bin')
    fs.mkdirSync(bin, { recursive: true })
    const executable = path.join(bin, 'project-dev')
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    fs.chmodSync(executable, 0o755)

    const result = resolvePreviewExecutable('project-dev', project, { PATH: '/usr/bin:/bin' })
    expect(result?.executable).toBe(executable)
    expect(result?.env.PATH?.split(path.delimiter)[0]).toBe(bin)
  })

  test('adds package-manager runtime locations without using a shell', () => {
    const paths = previewSearchPath('/tmp/example', { PATH: '/usr/bin:/bin' })
    expect(paths).toContain(path.join(os.homedir(), '.bun', 'bin'))
    expect(paths).toContain('/usr/local/bin')
    expect(new Set(paths).size).toBe(paths.length)
  })

  test('discovers PHP installed inside Stacker for Finder-launched builds', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-home-'))
    temporaryDirectories.push(home)
    const phpBin = path.join(home, 'Library', 'Application Support', 'stacker', 'Stacker', 'runtimes', 'php', '8.4.20', 'x64', 'bin')
    fs.mkdirSync(phpBin, { recursive: true })

    expect(previewSearchPath('/tmp/example', { PATH: '/usr/bin:/bin' }, home)).toContain(phpBin)
  })

  test('returns null for an unavailable command', () => {
    expect(resolvePreviewExecutable('definitely-not-a-frameui-command', '/tmp', { PATH: '/usr/bin:/bin' })).toBeNull()
  })

  test('keeps CodeIgniter redirects on the Spark preview origin', () => {
    const base = { PATH: '/usr/bin:/bin', 'app.baseURL': 'https://production.example/' }
    expect(previewEnvironment('php', ['spark', 'serve'], base)['app.baseURL']).toBe('http://localhost:8080/')
    expect(previewEnvironment('/opt/php84/bin/php', ['spark', 'serve', '--host=0.0.0.0', '--port', '9080'], base)['app.baseURL']).toBe('http://localhost:9080/')
    expect(previewEnvironment('npm', ['run', 'dev'], base)).toBe(base)
  })

  test('runs Spark on an explicit local app.baseURL from the project', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-ci-preview-'))
    temporaryDirectories.push(project)
    fs.writeFileSync(path.join(project, '.env'), 'app.baseURL=http://budget.localhost:4180/\n')

    expect(codeIgniterServeArgs('php', ['spark', 'serve'], project)).toEqual([
      'spark', 'serve', '--host', 'budget.localhost', '--port', '4180',
    ])
  })

  test('starts a real process and normalizes a wildcard development URL', async () => {
    const preview = new PreviewProcess()
    const detected = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('URL was not detected')), 3_000)
      const result = preview.start(process.execPath, ['-e', 'console.log("\\u001b[32mhttp://0.0.0.0:5173\\u001b[0m")'], process.cwd(), {
        onOutput: () => {},
        onStatus: () => {},
        onUrlDetected: (url) => { clearTimeout(timeout); resolve(url) },
      })
      if (!result.ok) { clearTimeout(timeout); reject(new Error(result.message)) }
    })
    expect(await detected).toBe('http://localhost:5173')
    preview.stop()
  })
})
