import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { compileRepositoryPage, designIRMarkup } from './compiler'
import type { Page, ProjectModel } from '@shared/types/model/projectModel'

const page = (file: string): Page => ({ id: 'page', name: 'Users', route: '/users', routeId: null, area: 'App', source: { filePath: file }, structure: [], elementCount: 0, componentNames: [], textContent: [], supportedViewports: ['desktop'], states: [], analysisStatus: 'ready' })
const model = { components: [], styles: [], assets: [], tokens: [] } as unknown as ProjectModel
function fixture(files: Record<string, string>, run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-source-test-'))
  try { for (const [name, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content) } run(root) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
}
test('HTML keeps exact source content and CSS but cannot execute scripts or embed remote documents', () => fixture({
  'index.html': '<html><head><style>h1{color:#2563eb}button:hover{color:red}</style></head><body><h1>A complete source heading without truncation</h1><script>fetch("https://example.com")</script><iframe src="https://example.com"></iframe><button onclick="alert(1)">Save</button></body></html>',
}, root => {
  const ir = compileRepositoryPage(root, page('index.html'), model)
  const html = designIRMarkup(ir)
  expect(html).toContain('A complete source heading without truncation')
  expect(html).toContain('color:#2563eb')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('onclick')
  expect(ir.states).toContain('Hover')
  expect(html).toContain("connect-src 'none'")
}))
test('React resolves local components, props, lists and selectable loading/empty states without running code', () => fixture({
  'Users.tsx': `import Card from './Card'; export default function Users(){ if(loading) return <p>Loading users</p>; if(users.length === 0) return <p>No users</p>; return <main><h1>Users</h1>{users.map(user => <Card name={user.name} email={user.email} />)}</main> }`,
  'Card.tsx': 'export default function Card({name,email}) { return <article><h2>{name}</h2><p>{email}</p></article> }',
}, root => {
  const ir = compileRepositoryPage(root, page('Users.tsx'), model)
  const html = designIRMarkup(ir)
  expect(html).toContain('Sarah Mitchell')
  expect(html).toContain('nicole.adams@example.com')
  expect(ir.generatedData).toBe(true)
  expect(ir.states).toEqual(['Populated', 'Loading', 'Empty'])
  expect(designIRMarkup(compileRepositoryPage(root, page('Users.tsx'), model, 'Loading'))).toContain('Loading users')
  expect(designIRMarkup(compileRepositoryPage(root, page('Users.tsx'), model, 'Empty'))).toContain('No users')
  expect(ir.dependencies).toContain('Card.tsx')
}))
test('existing static arrays take priority over generated values', () => fixture({
  'Page.tsx': `const users=[{name:'Actual fixture name',email:'fixture@example.com'}]; export default () => <main>{users.map(user => <p>{user.name}</p>)}</main>`,
}, root => {
  const ir = compileRepositoryPage(root, page('Page.tsx'), model)
  expect(designIRMarkup(ir)).toContain('Actual fixture name')
  expect(ir.generatedData).toBe(false)
}))
test('repository scripts and config imports are not executed and unknown components stay partial', () => fixture({
  'Page.tsx': `import Map from 'remote-maps'; require('node:fs').writeFileSync('SHOULD_NOT_EXIST', 'bad'); export default () => <main><h1>Supported content</h1><Map /></main>`,
}, root => {
  const ir = compileRepositoryPage(root, page('Page.tsx'), model)
  expect(designIRMarkup(ir)).toContain('Supported content')
  expect(designIRMarkup(ir)).toContain('Map · component preview unavailable')
  expect(ir.status).toBe('partial')
  expect(fs.existsSync(path.join(root, 'SHOULD_NOT_EXIST'))).toBe(false)
}))
test('CSS and assets cannot escape the repository, including symlinks and environment secrets', () => fixture({
  'index.html': '<link href="styles.css" rel="stylesheet"><img src="outside.png"><img src=".env"><p>Safe</p>',
  'styles.css': '@import "https://example.com/app.css";p{background:url(https://example.com/pixel)}',
  '.env': 'SECRET_KEY=do-not-display',
}, root => {
  fs.symlinkSync('/etc/hosts', path.join(root, 'outside.png'))
  const ir = compileRepositoryPage(root, page('index.html'), model)
  const html = designIRMarkup(ir)
  expect(html).not.toContain('https://example.com')
  expect(html).not.toContain('do-not-display')
  expect(ir.dependencies).not.toContain('.env')
  expect(ir.dependencies).not.toContain('outside.png')
}))
test('source changes invalidate the page fingerprint', () => fixture({ 'index.html': '<h1>Before</h1>' }, root => {
  const before = compileRepositoryPage(root, page('index.html'), model).hash
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>After</h1>')
  expect(compileRepositoryPage(root, page('index.html'), model).hash).not.toBe(before)
}))
test('Vue static fixtures, generated loops and conditional states use template ASTs',()=>fixture({
  'Page.vue':'<script setup>const title="Team"</script><template><h1>{{ title }}</h1><p v-if="loading">Loading people</p><section v-else><p v-for="user in users">{{ user.name }}</p></section></template><style>h1{color:blue}</style>',
},root=>{
  const normal=compileRepositoryPage(root,page('Page.vue'),model)
  expect(designIRMarkup(normal)).toContain('Team')
  expect(designIRMarkup(normal)).toContain('Sarah Mitchell')
  expect(designIRMarkup(normal)).not.toContain('Loading people')
  const loading=designIRMarkup(compileRepositoryPage(root,page('Page.vue'),model,'Loading'))
  expect(loading).toContain('Loading people')
  expect(loading).not.toContain('Sarah Mitchell')
}))
test('PHP templates resolve includes and database-free populated lists without executing PHP',()=>fixture({
  'page.php':'<main><?php include "header.php"; foreach ($users as $user): ?><p><?= $user["name"] ?></p><?php endforeach; ?></main>',
  'header.php':'<h1>Our team</h1>',
},root=>{
  const ir=compileRepositoryPage(root,page('page.php'),model)
  expect(designIRMarkup(ir)).toContain('Our team')
  expect(designIRMarkup(ir)).toContain('Sarah Mitchell')
  expect(ir.generatedData).toBe(true)
  expect(ir.dependencies).toContain('header.php')
  expect(designIRMarkup(compileRepositoryPage(root,page('page.php'),model,'Empty'))).not.toContain('Sarah Mitchell')
}))
test('Next app layouts wrap the editable page from local source',()=>fixture({
  'app/page.tsx':'export default ()=> <h1>Dashboard</h1>',
  'app/layout.tsx':'export default function Layout({children}) { return <section><nav>Shared navigation</nav>{children}</section> }',
},root=>{
  const html=designIRMarkup(compileRepositoryPage(root,page('app/page.tsx'),model))
  expect(html).toContain('Shared navigation')
  expect(html).toContain('Dashboard')
}))
test('AI component variants use actual source props without changing repository files',()=>fixture({
 'Button.tsx':`export function Button({variant,children}){return <button className={variant==='quiet'?'quiet':'primary'}>{children}</button>}`,
 'style.css':'.primary{background:#14968b;border-radius:12px}.quiet{background:#eeeeff;border-radius:12px}'
},root=>{
 const component={id:'button',name:'Button',exportKind:'named',source:{filePath:'Button.tsx'}}
 const project={...model,components:[component],styles:[{id:'style',source:{filePath:'style.css'}}]} as unknown as ProjectModel
 const target={...page('Button.tsx'),id:'button'}
 const ir=compileRepositoryPage(root,target,project,'Populated',{variant:'quiet',children:'Continue securely'})
 const html=designIRMarkup(ir)
 expect(html).toContain('Continue securely');expect(html).toContain('class="quiet"')
 expect(fs.readFileSync(path.join(root,'Button.tsx'),'utf8')).toContain("variant==='quiet'")
}))
