import { startingPage } from '../../renderer/lib/startingPage'
import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { privateProjectCopy } from '../../main/hosting/privateCopy'
import { sanitizeDiagnostics, preparationFailure } from '../../shared/diagnostics'
import { zoomAt, wheelCamera } from '../../renderer/lib/canvasCamera'
test('zoom preserves pointer position at all zoom levels', () => {
  const camera = { x: -125, y: 76, zoom: .42 }
  for (const zoom of [.01, .1, 1, 8, 100]) {
    const result = zoomAt(camera, zoom, 345, 215)
    expect((345 - result.x) / result.zoom).toBeCloseTo((345 - camera.x) / camera.zoom)
    expect((215 - result.y) / result.zoom).toBeCloseTo((215 - camera.y) / camera.zoom)
    expect(result.zoom).toBeGreaterThanOrEqual(.1); expect(result.zoom).toBeLessThanOrEqual(8)
  }
})
test('copy synchronization cannot delete through a generated external directory link', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-copy-link-'))
  try {
    const source = path.join(root, 'source'), outside = path.join(root, 'outside')
    await fs.mkdir(path.join(source, 'assets'), { recursive: true }); await fs.mkdir(outside)
    await fs.writeFile(path.join(source, 'assets', 'keep.txt'), 'source')
    await fs.writeFile(path.join(outside, 'keep.txt'), 'untouched')
    const copy = await privateProjectCopy(source, path.join(root, 'storage'), 'project')
    await fs.rm(path.join(copy, 'assets'), { recursive: true })
    await fs.symlink(outside, path.join(copy, 'assets'))
    await fs.unlink(path.join(source, 'assets', 'keep.txt'))
    await expect(privateProjectCopy(source, path.join(root, 'storage'), 'project')).rejects.toThrow('unsafe parent folder')
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('untouched')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('wheel normalizes line and pixel devices', () => {
  const camera = { x: 0, y: 0, zoom: 1 }, input = { deltaX: 0, deltaY: 16, deltaMode: 0, zoom: false, x: 0, y: 0, height: 720 }
  expect(wheelCamera(camera, input)).toEqual(wheelCamera(camera, { ...input, deltaY: 1, deltaMode: 1 }))
})
test('diagnostics redact secrets in strings and objects', () => {
  const output = JSON.stringify(sanitizeDiagnostics({ API_KEY: 'hidden1', PRIVATE_KEY: 'hidden2', APP_KEY: 'hidden7', text: 'DB_PASSWORD="hidden3 value"\nDATABASE_URL=postgres://u:hidden4@host/db\nAuthorization: Bearer hidden5\nhttps://u:hidden6@host' }))
  for (let i = 1; i <= 7; i++) expect(output).not.toContain(`hidden${i}`)
  expect(preparationFailure(new Error("Error invoking remote method 'hosting:prepare': gzip failed")).message).not.toContain('hosting:prepare')
})
test('preparation uses a resumable copy and never writes original settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-copy-test-'))
  try {
    const source = path.join(root, 'source'); await fs.mkdir(source)
    await fs.writeFile(path.join(source, '.env'), 'DB_PASSWORD=original')
    await fs.writeFile(path.join(source, 'index.html'), 'before')
    await fs.writeFile(path.join(source, 'removed.html'), 'removed')
    await fs.mkdir(path.join(source, 'shared'))
    await fs.writeFile(path.join(source, 'shared', 'style.css'), 'body {}')
    await fs.symlink(path.join(source, 'shared'), path.join(source, 'linked'))
    await fs.symlink(source, path.join(source, 'shared', 'loop'))
    await fs.writeFile(path.join(root, 'outside'), 'private')
    await fs.symlink(path.join(root, 'outside'), path.join(source, 'outside-link'))
    const copy = await privateProjectCopy(source, path.join(root, 'storage'), 'project-id')
    await fs.writeFile(path.join(copy, '.env'), 'DB_PASSWORD=local')
    await fs.writeFile(path.join(source, 'index.html'), 'updated source')
    await fs.unlink(path.join(source, 'removed.html'))
    await fs.mkdir(path.join(copy, 'node_modules'))
    await fs.writeFile(path.join(copy, 'node_modules', 'installed'), 'retained')
    expect(await fs.readFile(path.join(source, '.env'), 'utf8')).toBe('DB_PASSWORD=original')
    expect(await privateProjectCopy(source, path.join(root, 'storage'), 'project-id')).toBe(copy)
    expect(await fs.readFile(path.join(copy, '.env'), 'utf8')).toBe('DB_PASSWORD=local')
    expect(await fs.readFile(path.join(copy, 'index.html'), 'utf8')).toBe('updated source')
    expect(await fs.readFile(path.join(copy, 'linked', 'style.css'), 'utf8')).toBe('body {}')
    expect(await fs.readFile(path.join(copy, 'node_modules', 'installed'), 'utf8')).toBe('retained')
    expect(await fs.stat(path.join(copy, 'removed.html')).catch(() => null)).toBeNull()
    expect(await fs.stat(path.join(copy, 'outside-link')).catch(() => null)).toBeNull()
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('the first artboard prefers the home route over error templates', () => {
  const error = { name: 'Error 400', route: null }, home = {name: 'Home', route: '/'}
  expect(startingPage([error, home])).toBe(home)
  expect(startingPage([error, {name:'Customer',route:'/customers/:id'}, {name:'Dashboard',route:'/dashboard'}])?.route).toBe('/dashboard')
  expect(startingPage([])).toBeUndefined()
})
