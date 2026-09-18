import { expect, test } from 'bun:test'
import { groupPages, viewportOf } from '../../renderer/components/ide/pageLibrary'
import type { VisualPage } from '@shared/types/visualDesign'
const page = (id:string,state:string,route='/bills') => ({id,name:'Bills',route,folder:'Application',state,width:1440,height:1000,objects:[],pinned:false}) as VisualPage
test('viewport captures group by route and state including dialog states',()=>{
 const groups=groupPages([page('a','Desktop'),page('b','Tablet'),page('c','Mobile'),page('d','Desktop · Add bill'),page('e','Mobile · Add bill'),page('f','Desktop','/household')])
 expect(groups).toHaveLength(2)
 expect(groups[0].pages).toHaveLength(5)
 expect(groups[1].pages).toHaveLength(1)
 expect(groups[0].group).toBe('Bills')
 expect(viewportOf(page('b','Mobile · Add bill'))).toBe('Mobile')
})
test('pages without route identity remain distinct and authentication routes group together',()=>{
 expect(groupPages([page('a','Desktop',''),page('b','Desktop','')])).toHaveLength(2)
 expect(groupPages([page('a','Desktop','/login')])[0].group).toBe('Authentication')
})
