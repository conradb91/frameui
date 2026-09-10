import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { affectedFiles, buildDependencyGraph, updateDependencyGraph } from './dependencyGraph'
import type { ProjectIndex } from '@shared/types/projectIndex'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-graph-')); dirs.push(dir); fs.mkdirSync(path.join(dir, 'src')); return dir }
const model = () => ({ projectModel: { pages: [{ id: 'page.home', source: { filePath: 'src/Page.tsx' } }], components: [{ id: 'component.button', source: { filePath: 'src/Button.tsx' } }] } } as unknown as Pick<ProjectIndex, 'projectModel'>)

describe('dependency graph', () => {
  test('tracks transitive dependents without invalidating unrelated files', () => {
    const root = fixture()
    fs.writeFileSync(path.join(root, 'src/Button.tsx'), 'export const Button = () => null')
    fs.writeFileSync(path.join(root, 'src/Form.tsx'), "import { Button } from './Button'; export const Form = Button")
    fs.writeFileSync(path.join(root, 'src/Page.tsx'), "import { Form } from './Form'; export default Form")
    fs.writeFileSync(path.join(root, 'src/Other.tsx'), 'export default null')
    const files = ['src/Button.tsx', 'src/Form.tsx', 'src/Page.tsx', 'src/Other.tsx']
    const graph = buildDependencyGraph(root, files, model())
    expect(new Set(affectedFiles(graph, ['src/Button.tsx']))).toEqual(new Set(['src/Button.tsx', 'src/Form.tsx', 'src/Page.tsx']))
    expect(affectedFiles(graph, ['src/Other.tsx'])).toEqual(['src/Other.tsx'])
  })

  test('updates only changed import edges', () => {
    const root = fixture(); const files = ['src/A.ts', 'src/B.ts', 'src/C.ts']
    for (const file of files) fs.writeFileSync(path.join(root, file), file.endsWith('C.ts') ? '' : "import './C'")
    const graph = buildDependencyGraph(root, files, model())
    fs.writeFileSync(path.join(root, 'src/A.ts'), '')
    const next = updateDependencyGraph(root, graph, files, ['src/A.ts'], model())
    expect(next.dependents['src/C.ts']).toEqual(['src/B.ts'])
  })
})
