import { expect, test } from 'bun:test'
import { matchRoutePattern } from './matchRoutePattern'
import type { RoutePattern } from '@shared/types/model/projectModel'
const routes = (...paths: string[]) => paths.map(path => ({path, id:path, pageId:path,source:{filePath:'router.ts'}})) as RoutePattern[]
test('dynamic formats use supplied values and prefer literal routes', () => {
  for (const pattern of ['/users/:id','/users/[id]','/users/{id}']) expect(matchRoutePattern('/users/123',routes(pattern))?.params).toEqual({id:'123'})
  expect(matchRoutePattern('/users/settings',routes('/users/:id','/users/settings'))?.route.path).toBe('/users/settings')
})
test('Next catchall and optional catchall match real example addresses', () => {
  expect(matchRoutePattern('/docs/a/b',routes('/docs/[...slug]'))?.params).toEqual({slug:'a/b'})
  expect(matchRoutePattern('/docs',routes('/docs/[...slug]'))).toBeNull()
  expect(matchRoutePattern('/docs',routes('/docs/[[...slug]]'))?.params).toEqual({slug:''})
})
