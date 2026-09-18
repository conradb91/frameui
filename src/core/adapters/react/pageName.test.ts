import { expect, test } from 'bun:test'
import { resolvePageName } from './pageName'
test('navigation labels beat generic document titles and filename fallbacks', () => {
  expect(resolvePageName({navigation:' Profile ',heading:'Your Profile',title:'Account · Product',fallback:'account-profile-page.tsx'})).toBe('Profile')
  expect(resolvePageName({title:'Loading…',heading:'Notifications',fallback:'index'})).toBe('Notifications')
  expect(resolvePageName({route:'/settings/security'})).toBe('Security')
})
