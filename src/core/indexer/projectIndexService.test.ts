import { afterEach, describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectIndexService } from './projectIndexService'
import { getFeaturePageInputSchema } from '../../main/ipc/schemas/workspace.schema'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-project-')); dirs.push(root)
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-data-')); dirs.push(data)
  fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true }); fs.mkdirSync(path.join(root, 'src/components'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' }, scripts: { dev: 'vite' } }))
  fs.writeFileSync(path.join(root, 'src/components/Button.tsx'), 'export const Button = () => <button>Save</button>')
  fs.writeFileSync(path.join(root, 'src/pages/Home.tsx'), "import { Button } from '../components/Button'; export default function Home(){ return <main><Button /></main> }")
  fs.writeFileSync(path.join(root, 'src/unrelated.ts'), 'export const answer = 42')
  return { root, data }
}
function digest(root: string) { return crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'src/pages/Home.tsx'))).digest('hex') }

describe('persistent incremental project index', () => {
  test('reopens from cache and reparses only affected dependency paths', () => {
    const { root, data } = setup(); const before = digest(root)
    const first = new ProjectIndexService(data, 'project', root).load()
    expect(first.lastUpdate?.mode).toBe('initial')
    const reopened = new ProjectIndexService(data, 'project', root).load()
    expect(reopened.lastUpdate?.mode).toBe('cache-hit')
    expect(digest(root)).toBe(before)

    fs.writeFileSync(path.join(root, 'src/components/Button.tsx'), 'export const Button = () => <button>Continue</button>')
    const updated = new ProjectIndexService(data, 'project', root).load()
    expect(updated.lastUpdate?.mode).toBe('incremental')
    expect(updated.lastUpdate?.updatedComponents).toBe(1)
    expect(updated.lastUpdate?.affectedPages).toBe(1)

    fs.writeFileSync(path.join(root, 'src/unrelated.ts'), 'export const answer = 43')
    const unrelated = new ProjectIndexService(data, 'project', root).load()
    expect(unrelated.lastUpdate?.affectedPages).toBe(0)
    expect(unrelated.lastUpdate?.invalidatedObjectIds).toHaveLength(0)
  })
})

test('large static repositories ignore generated files and symlink loops, and reopen from cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui large ü-')); dirs.push(root)
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-large-data-')); dirs.push(data)
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.mkdirSync(path.join(root, 'views'))
  for (let i = 0; i < 400; i++) {
    fs.writeFileSync(path.join(root, 'views', `screen-${i}.html`), `<main><h1>Screen ${i}</h1><button>Continue</button></main>`)
    fs.writeFileSync(path.join(root, 'node_modules', `generated-${i}.html`), '<main>Ignored</main>')
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{ malformed JSON')
  fs.symlinkSync(root, path.join(root, 'loop'), 'dir')
  const started = performance.now()
  const first = new ProjectIndexService(data, 'large', root).load()
  expect(first.projectModel.pages.length).toBe(400)
  expect(Object.keys(first.files).some((file) => file.includes('node_modules') || file.startsWith('loop/'))).toBe(false)
  const reopened = new ProjectIndexService(data, 'large', root).load()
  expect(reopened.lastUpdate?.mode).toBe('cache-hit')
  console.log(`Large repository: 400 pages plus 400 ignored files, initial scan and reopen ${Math.round(performance.now() - started)}ms`)
})

test('mixed repositories default to their runnable frontend and retain explicit application selection', () => {
  const { root, data } = setup()
  fs.rmSync(path.join(root, 'src'), { recursive: true })
  fs.rmSync(path.join(root, 'package.json'))
  for (const name of ['backend', 'frontend']) fs.mkdirSync(path.join(root, name))
  fs.writeFileSync(path.join(root, 'backend/package.json'), JSON.stringify({ scripts: { start: 'node server.cjs' } }))
  fs.writeFileSync(path.join(root, 'backend/server.cjs'), 'require("http").createServer().listen(3000)')
  fs.writeFileSync(path.join(root, 'frontend/package.json'), JSON.stringify({ dependencies: { react: '^18.0.0', vite: '^5.0.0' }, scripts: { dev: 'vite' } }))
  fs.writeFileSync(path.join(root, 'frontend/index.html'), '<div id="root"></div>')
  fs.writeFileSync(path.join(root, 'frontend/App.jsx'), 'export default function App(){return <h1>Frontend</h1>}')
  const service = new ProjectIndexService(data, 'mixed', root)
  const index = service.load()
  expect(index.framework).toBe('react')
  expect(index.projectModel.pages.length).toBeGreaterThan(0)
  expect(getFeaturePageInputSchema.safeParse({ projectId: crypto.randomUUID(), pageId: index.projectModel.pages[0].id }).success).toBe(true)
  expect(getFeaturePageInputSchema.safeParse({ projectId: crypto.randomUUID(), pageId: 'app:../../page.index' }).success).toBe(false)
  const backend = index.applications?.find(application => application.rootPath === 'backend')
  expect(backend).toBeDefined()
  service.selectApplication(backend!.id)
  expect(new ProjectIndexService(data, 'mixed', root).load().framework).toBe('node')
})

test('root application namespaces are accepted without permitting path traversal', () => {
  const projectId = crypto.randomUUID()
  expect(getFeaturePageInputSchema.safeParse({projectId,pageId:'app:./page.index'}).success).toBe(true)
  expect(getFeaturePageInputSchema.safeParse({projectId,pageId:'app:../../page.index'}).success).toBe(false)
})
