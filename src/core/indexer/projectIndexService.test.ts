import { afterEach, describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectIndexService } from './projectIndexService'

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
