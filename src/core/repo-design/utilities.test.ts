import {test,expect} from 'bun:test'
import {utilityRule} from './utilities'
test('utility resolution uses project values and responsive rules',()=>{
  expect(utilityRule('flex',[],'Populated')).toContain('display:flex')
  expect(utilityRule('md:grid-cols-3',[{id:'bp',category:'breakpoint',name:'md',value:'900px',confidence:'full'}],'Populated')).toContain('min-width:900px')
  expect(utilityRule('p-4',[{id:'space',category:'spacing',name:'4',value:'20px',confidence:'full'}],'Populated')).toContain('padding:20px')
  expect(utilityRule('hover:bg-white',[],'Hover')).not.toContain(':hover{')
  expect(utilityRule('unsupported-plugin',[],'Populated')).toBeNull()
})
