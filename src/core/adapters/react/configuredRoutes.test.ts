import { expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configuredRoutes } from './configuredRoutes'
import { findPages } from './findPages'
import { createIgnoreRules } from '../../indexer/ignore'

function fixture(files: Record<string, string>, run: (root: string, files: string[]) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-routes-'))
  try {
    for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text) }
    run(root, Object.keys(files).map(file => path.join(root, file)))
  } finally { fs.rmSync(root, {recursive: true, force: true}) }
}
test('React declarations find nested account and admin views outside pages folders', () => fixture({
  'src/router.tsx': `import Profile from './features/Profile'; import Settings from './features/Settings'; export const app = <Routes><Route path="account"><Route path="profile" element={<Profile/>}/><Route path="settings" element={<Settings/>}/></Route><Route path="super-admin/users/:id" element={<Profile/>}/></Routes>`,
  'src/features/Profile.tsx': 'export default () => <h1>Profile</h1>', 'src/features/Settings.tsx': 'export default () => <h1>Settings</h1>',
}, (root, files) => {
  const routes = configuredRoutes(root, files)
  expect(routes.map(p => p.route)).toEqual(['/account/profile','/account/settings','/super-admin/users/:id'])
  expect(routes[0].filePath).toBe('src/features/Profile.tsx')
  expect(routes[0].name).toBe('Profile')
}))
test('Vue object routes retain parent paths and imported view sources', () => fixture({
  'router.ts': `import Profile from './Profile.vue'; const routes = [{path:'/account',children:[{path:'profile',component:Profile,title:'Your Profile'}]}]`,
  'Profile.vue': '<template><h1>Profile</h1></template>',
}, (root, files) => {
  expect(configuredRoutes(root, files)[0]).toMatchObject({route:'/account/profile',name:'Your Profile',filePath:'Profile.vue'})
}))
test('Next route groups, private folders and ignored routes do not invent URLs', () => fixture({
  'app/(main)/page.tsx': '', 'app/(main)/settings/page.tsx': '', 'app/_private/page.tsx': '', 'app/@modal/page.tsx': '',
  '.gitignore': 'app/ignored/\n', 'app/ignored/page.tsx': '',
}, root => {
  expect(findPages(root, 'next-app', path.join(root, 'app'), createIgnoreRules([], root)).map(p => [p.route,p.name])).toEqual([['/settings','Settings'],['/','Home']])
}))

test('computed routes resolve imported constants, object properties, templates and array spreads', () => fixture({
  'paths.ts': `export const ROOT='/account'; export const paths={profile: ROOT + '/profile'} as const;`,
  'router.tsx': "import {ROOT,paths} from './paths'; import Profile from './Profile'; const children=[{path:'settings',element:<Profile/>}]; const routes=[{path:ROOT,children:[...children]},{path:`${ROOT}/security`,element:<Profile/>},{path:paths.profile,element:<Profile/>}];",
  'Profile.tsx': 'export default () => <h1>Profile</h1>',
}, (root, files) => {
  const found = configuredRoutes(root,files).map(p=>p.route)
  expect(found).not.toContain('/settings')
  expect(found).toContain('/account/settings')
  expect(found).toContain('/account/security')
  expect(found).toContain('/account/profile')
}))
test('unknown runtime paths do not become invented root pages', () => fixture({
  'router.tsx': `const routes=[{path:readEnvironment(),component:Profile}]; const app=<Route path={window.location.pathname} element={<Profile/>}/>`,
}, (root,files) => expect(configuredRoutes(root,files)).toEqual([])))
test('cyclic constants terminate without executing source', () => fixture({
  'router.tsx': `const A=B; const B=A; const routes=[{path:A,component:Profile}]`,
}, (root,files) => expect(configuredRoutes(root,files)).toEqual([])))
test('function arguments do not resolve to shadowed module constants', () => fixture({
  'router.tsx': `const ROOT='/account'; function routes(ROOT) { return [{path:ROOT,component:Profile}] }`,
}, (root,files) => expect(configuredRoutes(root,files)).toEqual([])))
test('lazy view imports retain their source file', () => fixture({
  'router.tsx': `const Profile=lazy(()=>import('./Profile')); const routes=[{path:'/profile',element:<Profile/>}]`,
  'Profile.tsx': 'export default () => <h1>Profile</h1>',
}, (root,files) => expect(configuredRoutes(root,files)[0].filePath).toBe('Profile.tsx')))
